// Attendance service — business logic for attendance_logs.
// All functions take `db` as the first argument (testable, no hidden global).
// All queries use prepared statements.
// Alternation validation is shared across clockIn/clockOut/createManualLog.

import type Database from 'better-sqlite3'
import type {
  AttendanceLog,
  Shift,
  LeaveRecord,
  LeaveBalance,
  LeaveEntitlement,
  LateReportRow,
  ClockValidationResult,
  AttendanceMonthlyCalendar,
  AttendanceSummaryDay,
  DeviceSyncResult,
} from '../../src/shared/types/entities'
import type {
  CreateAttendanceLogInput,
  UpdateAttendanceLogInput,
  CreateShiftInput,
  UpdateShiftInput,
  CreateLeaveRequestInput,
  AttendanceLogPurgeSource,
} from '../../src/shared/types/inputs'

// ── Phase 6: Period Lock Guard ───────────────────────────

/**
 * Throws if the given date falls within a closed payroll period.
 * Attendance logs in closed periods are immutable — admins must
 * re-open the period to edit them.
 */
function guardClosedPeriod(db: Database.Database, date: string): void {
  const closed = db.prepare(`
    SELECT COUNT(*) AS cnt FROM payroll_periods
    WHERE status = 'closed' AND start_date <= ? AND end_date >= ?
  `).get(date, date) as { cnt: number }
  if (closed.cnt > 0) {
    throw new Error(
      `Cannot modify attendance logs on ${date}: this date is within a closed payroll period. ` +
      'Go to Payroll → Payroll Periods and re-open the period first.',
    )
  }
}

/**
 * Range variant of guardClosedPeriod — throws if any closed payroll period
 * overlaps [dateFrom, dateTo]. Used by the bulk purge below, which acts on a
 * range rather than a single log's date.
 */
function guardClosedPeriodRange(db: Database.Database, dateFrom: string, dateTo: string): void {
  const closed = db.prepare(`
    SELECT COUNT(*) AS cnt FROM payroll_periods
    WHERE status = 'closed' AND start_date <= ? AND end_date >= ?
  `).get(dateTo, dateFrom) as { cnt: number }
  if (closed.cnt > 0) {
    throw new Error(
      `Cannot delete attendance logs between ${dateFrom} and ${dateTo}: this range overlaps a closed payroll period. ` +
      'Go to Payroll → Payroll Periods and re-open the period first.',
    )
  }
}

// ── Shared helpers ───────────────────────────────────────

/**
 * Returns the current local time as a naive ISO 8601 string (no timezone suffix).
 * SQLite's date() interprets these as-is, matching how datetime-local form inputs
 * produce timestamps. Using new Date().toISOString() would produce a UTC "Z" string,
 * which causes date-bucket errors for users in non-UTC timezones (e.g. MYT = UTC+8).
 */
function nowLocalISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Queries a single AttendanceLog, joining employees + shifts for display fields. */
function queryById(db: Database.Database, id: number): AttendanceLog | null {
  const row = db.prepare(`
    SELECT
      a.id, a.employee_id, e.name AS employee_name,
      a.type, a.timestamp, a.source, a.device_id, a.note,
      a.shift_id, s.name AS shift_name, a.status,
      a.created_at, a.updated_at
    FROM attendance_logs a
    LEFT JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.id = ?
  `).get(id) as AttendanceLog | undefined
  return row ?? null
}

/**
 * Shared alternation check: an employee's punches must strictly alternate.
 * Throws if the new type would break the IN → OUT → IN chain.
 */
function assertAlternation(
  db: Database.Database,
  employeeId: number,
  newType: 'in' | 'out',
): void {
  const lastLog = getLastLogForEmployee(db, employeeId)

  if (newType === 'in') {
    if (lastLog && lastLog.type === 'in') {
      throw new Error(
        `Employee ${employeeId} is already clocked in (last punch at ${lastLog.timestamp}). ` +
        'Clock out before clocking in again.',
      )
    }
    // No last log → first punch can be IN (valid, employee just joined)
  }

  if (newType === 'out') {
    if (!lastLog) {
      throw new Error(
        `Employee ${employeeId} has no prior attendance log. Clock in before clocking out.`,
      )
    }
    if (lastLog.type === 'out') {
      throw new Error(
        `Employee ${employeeId} is already clocked out (last punch at ${lastLog.timestamp}). ` +
        'Clock in before clocking out again.',
      )
    }
  }
}

// ── Phase C: Shift + late-detection helpers ──────────────

/**
 * Returns the shift assigned to an employee, or null if none.
 * Used to snapshot shift_id onto clock-in rows and to evaluate lateness.
 */
function getEmployeeShift(db: Database.Database, employeeId: number): Shift | null {
  const row = db.prepare(`
    SELECT s.*
    FROM shifts s
    JOIN employees e ON e.shift_id = s.id
    WHERE e.id = ?
  `).get(employeeId) as Shift | undefined
  return row ?? null
}

/**
 * Returns the configured late-tolerance grace period (minutes) from payroll_settings.
 * Falls back to 15 if the row is somehow missing — the migration seeds 15.
 */
function getGracePeriodMinutes(db: Database.Database): number {
  const row = db.prepare('SELECT grace_period_minutes FROM payroll_settings WHERE id = 1').get() as
    | { grace_period_minutes: number }
    | undefined
  const grace = row?.grace_period_minutes ?? 15
  return grace
}

/**
 * Computes how many minutes after shift start a clock-in timestamp falls.
 * Handles night shifts that cross midnight (e.g. 22:00→06:00) by treating the
 * shift start as belonging to the punch's calendar day, then comparing times.
 * Returns 0 if the punch is on or before the shift start + grace period.
 */
function computeMinutesLate(shift: Shift, punchTimestamp: string, graceMinutes: number): number {
  // punchTimestamp is "YYYY-MM-DDTHH:MM:SS" (naive local). Extract the time portion.
  const punchTime = punchTimestamp.slice(11, 16) // "HH:MM"
  const shiftStart = shift.start_time // "HH:MM"

  // For night shifts (start > end, e.g. 22:00→06:00), a punch at 22:30 is 30 min late,
  // a punch at 21:50 is "early" (before shift) → 0 minutes late.
  // For day shifts (start < end), straightforward comparison.
  const minutesLateRaw = minutesBetween(shiftStart, punchTime)
  // Negative = punched before shift start (early) → not late
  return Math.max(0, minutesLateRaw - graceMinutes)
}

/** Returns minutes between two "HH:MM" strings (b - a), can be negative. */
function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  return (bh * 60 + bm) - (ah * 60 + am)
}

/**
 * Determines the attendance status for a clock-in punch.
 * Only meaningful for 'in' punches (clock-out doesn't have a lateness concept).
 * Returns 'on-time' or 'late'. 'absent' is set by the summary/report layer for
 * whole days with no IN punch; 'excused-late' is set by the excuseLate admin action.
 */
function computeClockInStatus(
  db: Database.Database,
  shift: Shift | null,
  punchTimestamp: string,
): 'on-time' | 'late' {
  if (!shift) {
    return 'on-time' // no assigned shift → no lateness rule
  }
  const grace = getGracePeriodMinutes(db)
  const minutesLate = computeMinutesLate(shift, punchTimestamp, grace)
  return minutesLate > 0 ? 'late' : 'on-time'
}

/**
 * Public validation used by the Quick Clock panel to warn the admin *before* committing
 * a clock-in. Returns whether the punch would be on-time, the minutes late, and a
 * human-readable alert message (null when on-time).
 */
export function validateClockAgainstShift(
  db: Database.Database,
  employeeId: number,
  timestamp: string,
): ClockValidationResult {
  const shift = getEmployeeShift(db, employeeId)
  if (!shift) {
    return { onTime: true, minutesLate: 0, alertMessage: null }
  }
  const grace = getGracePeriodMinutes(db)
  const minutesLate = computeMinutesLate(shift, timestamp, grace)
  if (minutesLate <= 0) {
    return { onTime: true, minutesLate: 0, alertMessage: null }
  }
  return {
    onTime: false,
    minutesLate,
    alertMessage: `Late by ${minutesLate} min (shift ${shift.name} starts at ${shift.start_time}, grace ${grace} min).`,
  }
}

// ── Query functions ──────────────────────────────────────

export function listAttendanceLogs(
  db: Database.Database,
  filters?: { employeeId?: number; dateFrom?: string; dateTo?: string },
): AttendanceLog[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filters?.employeeId) {
    conditions.push('a.employee_id = @employeeId')
    params.employeeId = filters.employeeId
  }
  if (filters?.dateFrom) {
    conditions.push('date(a.timestamp) >= @dateFrom')
    params.dateFrom = filters.dateFrom
  }
  if (filters?.dateTo) {
    conditions.push('date(a.timestamp) <= @dateTo')
    params.dateTo = filters.dateTo
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db.prepare(`
    SELECT
      a.id, a.employee_id, e.name AS employee_name,
      a.type, a.timestamp, a.source, a.device_id, a.note,
      a.shift_id, s.name AS shift_name, a.status,
      a.created_at, a.updated_at
    FROM attendance_logs a
    LEFT JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    ${where}
    ORDER BY a.timestamp DESC
  `).all(params) as AttendanceLog[]
}

export function getAttendanceLogById(db: Database.Database, id: number): AttendanceLog | null {
  return queryById(db, id)
}

export function getLastLogForEmployee(
  db: Database.Database,
  employeeId: number,
): AttendanceLog | null {
  const row = db.prepare(`
    SELECT
      a.id, a.employee_id, e.name AS employee_name,
      a.type, a.timestamp, a.source, a.device_id, a.note,
      a.shift_id, s.name AS shift_name, a.status,
      a.created_at, a.updated_at
    FROM attendance_logs a
    LEFT JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.employee_id = ?
    ORDER BY a.timestamp DESC
    LIMIT 1
  `).get(employeeId) as AttendanceLog | undefined
  return row ?? null
}

// ── Clock In / Clock Out ─────────────────────────────────

export function clockIn(
  db: Database.Database,
  employeeId: number,
  timestamp?: string,
): AttendanceLog {
  assertAlternation(db, employeeId, 'in')

  const ts = timestamp ?? nowLocalISO()
  const now = new Date().toISOString()

  // Phase C: snapshot the employee's assigned shift and compute lateness at clock-in.
  const shift = getEmployeeShift(db, employeeId)
  const status = computeClockInStatus(db, shift, ts)

  const result = db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
    VALUES (@employee_id, 'in', @timestamp, 'manual', @shift_id, @status, @created_at, @updated_at)
  `).run({
    employee_id: employeeId,
    timestamp: ts,
    shift_id: shift?.id ?? null,
    status,
    created_at: now,
    updated_at: now,
  })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return queryById(db, result.lastInsertRowid as number)!
}

export function clockOut(
  db: Database.Database,
  employeeId: number,
  timestamp?: string,
): AttendanceLog {
  assertAlternation(db, employeeId, 'out')

  const ts = timestamp ?? nowLocalISO()
  const now = new Date().toISOString()

  // Phase C: snapshot the shift_id on clock-out too (for audit parity with clock-in).
  // Status stays 'on-time' for OUT punches — lateness is an IN-only concept.
  const shift = getEmployeeShift(db, employeeId)

  const result = db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
    VALUES (@employee_id, 'out', @timestamp, 'manual', @shift_id, 'on-time', @created_at, @updated_at)
  `).run({
    employee_id: employeeId,
    timestamp: ts,
    shift_id: shift?.id ?? null,
    created_at: now,
    updated_at: now,
  })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return queryById(db, result.lastInsertRowid as number)!
}

// ── Manual CRUD (admin backfill / edit / delete) ─────────

export function createManualLog(
  db: Database.Database,
  input: CreateAttendanceLogInput,
): AttendanceLog {
  // Alternation check applies to manual inserts too — same invariant
  assertAlternation(db, input.employee_id, input.type)

  const now = new Date().toISOString()

  // Phase C: snapshot shift + compute status for manual IN punches (admin backfill).
  const shift = getEmployeeShift(db, input.employee_id)
  const status: 'on-time' | 'late' =
    input.type === 'in' ? computeClockInStatus(db, shift, input.timestamp) : 'on-time'

  const result = db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, note, shift_id, status, created_at, updated_at)
    VALUES (@employee_id, @type, @timestamp, 'manual', @note, @shift_id, @status, @created_at, @updated_at)
  `).run({
    employee_id: input.employee_id,
    type: input.type,
    timestamp: input.timestamp,
    note: input.note ?? null,
    shift_id: shift?.id ?? null,
    status,
    created_at: now,
    updated_at: now,
  })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return queryById(db, result.lastInsertRowid as number)!
}

export function updateAttendanceLog(
  db: Database.Database,
  id: number,
  input: UpdateAttendanceLogInput,
): AttendanceLog {
  const existing = queryById(db, id)
  if (!existing) {
    throw new Error(`Attendance log with id ${id} not found`)
  }

  // Phase 6: Block edits to logs in closed payroll periods
  guardClosedPeriod(db, existing.timestamp.slice(0, 10))

  const newType = input.type ?? existing.type
  const newEmployeeId = input.employee_id ?? existing.employee_id

  // If the employee or type changed, re-check alternation against the latest log
  // (excluding this row so it doesn't check against itself)
  if (input.type !== undefined || input.employee_id !== undefined) {
    const lastBeforeThis = db.prepare(`
      SELECT type FROM attendance_logs
      WHERE employee_id = ? AND id != ? AND timestamp < (SELECT timestamp FROM attendance_logs WHERE id = ?)
      ORDER BY timestamp DESC LIMIT 1
    `).get(newEmployeeId, id, id) as { type: 'in' | 'out' } | undefined

    // Check against the log that immediately precedes this one chronologically
    // (since we're editing, the log after this one might need its own alternation fix,
    // but that's not part of this operation — admins must fix cascading issues manually)
    if (lastBeforeThis && lastBeforeThis.type === newType) {
      throw new Error(
        `Cannot set type to '${newType}': the preceding log is also '${lastBeforeThis.type}'. ` +
        'Punches must strictly alternate.',
      )
    }
  }

  const now = new Date().toISOString()
  const newTimestamp = input.timestamp ?? existing.timestamp

  // Phase C: re-snapshot shift_id and recompute status if the employee or timestamp
  // changed. If only the note is being edited, leave shift_id/status untouched.
  let newShiftId = existing.shift_id
  let newStatus = existing.status
  if (input.employee_id !== undefined || input.timestamp !== undefined) {
    const shift = getEmployeeShift(db, newEmployeeId)
    newShiftId = shift?.id ?? null
    newStatus = newType === 'in' ? computeClockInStatus(db, shift, newTimestamp) : 'on-time'
  }

  const merged = {
    employee_id: newEmployeeId,
    type: newType,
    timestamp: newTimestamp,
    note: input.note !== undefined ? input.note : existing.note,
    shift_id: newShiftId,
    status: newStatus,
  }

  db.prepare(`
    UPDATE attendance_logs
    SET employee_id = @employee_id,
        type = @type,
        timestamp = @timestamp,
        note = @note,
        shift_id = @shift_id,
        status = @status,
        updated_at = @updated_at
    WHERE id = @id
  `).run({ ...merged, updated_at: now, id })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return queryById(db, id)!
}

export function deleteAttendanceLog(db: Database.Database, id: number): void {
  // Phase 6: Block deletes of logs in closed payroll periods
  const log = queryById(db, id)
  if (!log) throw new Error(`Attendance log with id ${id} not found`)
  guardClosedPeriod(db, log.timestamp.slice(0, 10))

  const result = db.prepare('DELETE FROM attendance_logs WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Attendance log with id ${id} not found`)
  }
}

// ── Device Sync (ZKTeco K40 Pro / V1000) ─────────────────
// Redesigned per DEVICE_SYNC_AUDIT.md C2 findings (2026-07-08):
//   OLD: position-based IN/OUT per download batch → type flips on re-sync;
//        dedup key included derived type → same punch re-inserted with opposite type
//        after any sequence shift (device purge, manual backfill, duplicate punches)
//   NEW (Flow 2): debounce → per-day type assignment → ±60s dedup ignoring type
//
// D2 (locked): device `state` field is permanently ignored. Staff are not trained
// on OT/break state keys. Raw punch timestamps are all that matters.

/**
 * Reads sync-related device settings from payroll_settings row 1.
 * Returns safe defaults if the row or columns are missing.
 */
function getDeviceSyncSettings(db: Database.Database): {
  deviceIp: string | null
  devicePort: number
  debounceMinutes: number
  lastSyncedAt: string | null
} {
  const row = db.prepare(`
    SELECT device_ip, device_port, punch_debounce_minutes, device_last_synced_at
    FROM payroll_settings WHERE id = 1
  `).get() as {
    device_ip: string | null
    device_port: number
    punch_debounce_minutes?: number
    device_last_synced_at?: string | null
  } | undefined
  return {
    deviceIp: row?.device_ip ?? null,
    devicePort: row?.device_port ?? 4370,
    debounceMinutes: row?.punch_debounce_minutes ?? 2,
    lastSyncedAt: row?.device_last_synced_at ?? null,
  }
}

/**
 * Converts a device timestamp string to a naive local ISO string
 * ("YYYY-MM-DDTHH:MM:SS" with no timezone suffix), matching EZOffice's
 * convention. Returns null if the string cannot be parsed (M4 validation).
 */
function parseDeviceTimestamp(raw: unknown): string | null {
  if (!raw) return null
  const d = new Date(String(raw))
  if (isNaN(d.getTime())) return null // M4: explicit validation, not silent NaN
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Persists a sync run result to device_sync_log. Returns the row id.
 */
function persistSyncLog(
  db: Database.Database,
  deviceIp: string,
  startedAt: string,
  inserted: number,
  skipped: number,
  errors: string[],
): number {
  const result = db.prepare(`
    INSERT INTO device_sync_log (device_ip, started_at, inserted, skipped, errors_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(deviceIp, startedAt, inserted, skipped, errors.length > 0 ? JSON.stringify(errors) : null)
  return result.lastInsertRowid as number
}

/**
 * Pulls attendance logs from a ZKTeco device and inserts new ones into the DB.
 *
 * Flow (per DEVICE_SYNC_AUDIT.md Flow 2):
 *  a. Pull all logs; drop any older than the watermark (H1 optimisation).
 *  b. Map device user_id → employee via device_user_id; collect unmapped users.
 *  c. Debounce: collapse same-employee punches < punch_debounce_minutes apart (keep first).
 *  d. Per-day type assignment: for each employee+day, sort by time;
 *     odd position in the day = IN, even = OUT.
 *  e. Dedup: skip if a punch exists for (employee, timestamp ±60 s) — type-independent.
 *  f. Insert with source='device', device_id=deviceIp; snapshot shift + status.
 *  g. Update watermark; persist sync log.
 */
export async function syncFromDeviceEthernet(
  db: Database.Database,
  deviceIp: string,
  devicePort: number,
): Promise<DeviceSyncResult> {
  const startedAt = nowLocalISO()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let device: any // zkteco-js types are loose; type boundary isolated here
  const errors: string[] = []
  let inserted = 0
  let skipped = 0

  const { debounceMinutes, lastSyncedAt } = getDeviceSyncSettings(db)

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Zkteco = require('zkteco-js')
    device = new Zkteco(deviceIp, devicePort, 5200, 5000)

    await device.createSocket()
    const response = await device.getAttendances()
    await device.disconnect()

    // zkteco-js getAttendances() returns { data: records }
    const rawLogs: unknown[] = Array.isArray(response) ? response : (response?.data ?? [])
    if (!Array.isArray(rawLogs) || rawLogs.length === 0) {
      const logId = persistSyncLog(db, deviceIp, startedAt, 0, 0, [])
      return { inserted: 0, skipped: 0, errors: [], syncLogId: logId, completedAt: nowLocalISO() }
    }

    // ── a. Parse + timestamp-validate + watermark filter ─────────────────────
    type RawPunch = { deviceUserId: number; timestamp: string }
    const parsed: RawPunch[] = []
    for (const log of rawLogs) {
      const rec = log as Record<string, unknown>
      const deviceUserId = rec.user_id ?? rec.employeeId
      if (deviceUserId == null) { skipped++; continue }

      const rawTimestamp = rec.record_time ?? rec.punch_time
      const timestamp = parseDeviceTimestamp(rawTimestamp) // M4
      if (!timestamp) {
        errors.push(`Skipped: Could not parse timestamp '${String(rawTimestamp)}' for device user ${String(deviceUserId)}`)
        skipped++
        continue
      }

      // H1 watermark: skip logs at or before the last synced timestamp (optimisation)
      if (lastSyncedAt && timestamp <= lastSyncedAt) { skipped++; continue }

      // D2: device `state` field intentionally discarded
      parsed.push({ deviceUserId: Number(deviceUserId), timestamp })
    }

    // ── b. Map device user_id → employee; collect unmapped (deduplicated) ────
    const employeeLookupStmt = db.prepare('SELECT id FROM employees WHERE device_user_id = ?')
    const unmappedUserIds = new Set<number>()

    type MappedPunch = { employeeId: number; timestamp: string }
    const mapped: MappedPunch[] = []
    for (const punch of parsed) {
      const empRow = employeeLookupStmt.get(punch.deviceUserId) as { id: number } | undefined
      if (!empRow) {
        unmappedUserIds.add(punch.deviceUserId)
        skipped++
        continue
      }
      mapped.push({ employeeId: empRow.id, timestamp: punch.timestamp })
    }
    // One error message per unmapped user (not one per punch)
    for (const uid of unmappedUserIds) {
      errors.push(`Device user ${uid}: punches skipped — set the employee's device_user_id in Master Data to map them`)
    }

    // ── c. Debounce: per employee, collapse punches < debounceMinutes apart ──
    const byEmployee = new Map<number, string[]>()
    for (const p of mapped) {
      const arr = byEmployee.get(p.employeeId) ?? []
      arr.push(p.timestamp)
      byEmployee.set(p.employeeId, arr)
    }
    // Sort each employee's punches chronologically, then apply debounce
    type DebouncedPunch = { employeeId: number; timestamp: string }
    const debounced: DebouncedPunch[] = []
    const debounceMs = debounceMinutes * 60 * 1000

    for (const [employeeId, timestamps] of byEmployee) {
      timestamps.sort()
      let prevTime = -Infinity
      for (const ts of timestamps) {
        const t = new Date(ts).getTime()
        if (t - prevTime >= debounceMs) {
          debounced.push({ employeeId, timestamp: ts })
          prevTime = t
        } else {
          skipped++ // debounced away (bounce/double-tap)
        }
      }
    }

    // ── d. Per-day type assignment: group by employee+day, assign IN/OUT ─────
    // Odd position within the day = IN, even = OUT. This is deterministic across
    // syncs: the same punch always gets the same type regardless of what was in
    // a previous sync batch or what was added manually in EZOffice.
    type TypedPunch = { employeeId: number; timestamp: string; type: 'in' | 'out' }
    const typed: TypedPunch[] = []
    const byEmployeeDay = new Map<string, { employeeId: number; timestamps: string[] }>()

    for (const p of debounced) {
      const day = p.timestamp.slice(0, 10) // YYYY-MM-DD
      const key = `${p.employeeId}:${day}`
      const entry = byEmployeeDay.get(key) ?? { employeeId: p.employeeId, timestamps: [] }
      entry.timestamps.push(p.timestamp)
      byEmployeeDay.set(key, entry)
    }
    for (const { employeeId, timestamps } of byEmployeeDay.values()) {
      timestamps.sort()
      timestamps.forEach((ts, idx) => {
        typed.push({ employeeId, timestamp: ts, type: idx % 2 === 0 ? 'in' : 'out' })
      })
    }
    // Sort globally by timestamp for the insert transaction
    typed.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    // ── e+f. Dedup (±60 s, type-independent) + insert ────────────────────────
    // Dedup ignores the derived type — a physical punch at a moment in time is
    // unique regardless of what we label it. The ±60s window absorbs manual-vs-
    // device double capture where timestamps differ by seconds.
    const dedupStmt = db.prepare(`
      SELECT COUNT(*) AS cnt FROM attendance_logs
      WHERE employee_id = @employeeId
        AND timestamp >= @tsMin AND timestamp <= @tsMax
    `)
    const insertStmt = db.prepare(`
      INSERT INTO attendance_logs
        (employee_id, type, timestamp, source, device_id, shift_id, status, created_at, updated_at)
      VALUES
        (@employee_id, @type, @timestamp, 'device', @device_id, @shift_id, @status, @now, @now)
    `)

    const today = new Date().toISOString().slice(0, 10)
    let newestInsertedTimestamp: string | null = null

    db.transaction(() => {
      for (const p of typed) {
        // ±60 s window
        const pMs = new Date(p.timestamp).getTime()
        const tsMin = parseDeviceTimestamp(new Date(pMs - 60000).toString())!
        const tsMax = parseDeviceTimestamp(new Date(pMs + 60000).toString())!

        const dup = dedupStmt.get({ employeeId: p.employeeId, tsMin, tsMax }) as { cnt: number }
        if (dup.cnt > 0) { skipped++; continue }

        const shift = getEmployeeShift(db, p.employeeId)

        // M2: don't evaluate lateness for historical punches (> 1 day before today)
        // — synced old data was stamped with the drifted/old device clock; marking it
        // 'late' retroactively would silently corrupt the late report with stale data.
        const punchDate = p.timestamp.slice(0, 10)
        const isHistorical = punchDate < today
        const status: 'on-time' | 'late' =
          p.type === 'in' && !isHistorical
            ? computeClockInStatus(db, shift, p.timestamp)
            : 'on-time'

        const now = new Date().toISOString()
        insertStmt.run({
          employee_id: p.employeeId,
          type: p.type,
          timestamp: p.timestamp,
          device_id: deviceIp, // M3: stamp with device IP (serial available after H3)
          shift_id: shift?.id ?? null,
          status,
          now,
        })

        if (newestInsertedTimestamp === null || p.timestamp > newestInsertedTimestamp) {
          newestInsertedTimestamp = p.timestamp
        }
        inserted++
      }
    })()

    // ── g. Advance watermark (H1) ─────────────────────────────────────────────
    // Only advance if there were no unmapped users — we must be able to re-fetch
    // their punches on the next sync after the admin maps them.
    if (unmappedUserIds.size === 0 && newestInsertedTimestamp !== null) {
      db.prepare(
        'UPDATE payroll_settings SET device_last_synced_at = ? WHERE id = 1',
      ).run(newestInsertedTimestamp)
    }

    const logId = persistSyncLog(db, deviceIp, startedAt, inserted, skipped, errors)
    return { inserted, skipped, errors, syncLogId: logId, completedAt: nowLocalISO() }
  } catch (err) {
    throw new Error(`Device sync failed: ${String(err)}`)
  }
}

/**
 * Counts attendance_logs matching a date range + source filter, without
 * deleting anything. Used by the UI to show the admin what a bulk purge
 * would affect before they confirm it.
 */
export function countAttendanceLogsForPurge(
  db: Database.Database,
  dateFrom: string,
  dateTo: string,
  source: AttendanceLogPurgeSource,
): number {
  const sourceClause = source === 'all' ? '' : 'AND source = @source'
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM attendance_logs
    WHERE date(timestamp) >= @dateFrom AND date(timestamp) <= @dateTo
    ${sourceClause}
  `).get({ dateFrom, dateTo, source }) as { cnt: number }
  return row.cnt
}

/**
 * Permanently deletes attendance_logs in a date range, optionally scoped to
 * a single source ('manual' or 'device') or both ('all'). Generalizes the
 * original device-only sync cleanup tool into a general admin escape hatch
 * for correcting test data or bad batches, on either source.
 *
 * Blocked for any date range overlapping a closed payroll period — same
 * immutability rule as single-row edit/delete (guardClosedPeriod). Bulk
 * purge is not an exception to period locking; the admin must re-open the
 * period first, same as they would to fix a single log.
 *
 * When source is 'device' or 'all', the device sync watermark is reset so
 * the next sync re-pulls the purged range instead of treating it as
 * already-synced.
 */
export function purgeAttendanceLogs(
  db: Database.Database,
  dateFrom: string,
  dateTo: string,
  source: AttendanceLogPurgeSource,
): { deleted: number } {
  if (dateFrom > dateTo) {
    throw new Error('dateFrom must not be after dateTo')
  }
  guardClosedPeriodRange(db, dateFrom, dateTo)

  return db.transaction(() => {
    const sourceClause = source === 'all' ? '' : 'AND source = @source'
    const result = db.prepare(`
      DELETE FROM attendance_logs
      WHERE date(timestamp) >= @dateFrom AND date(timestamp) <= @dateTo
      ${sourceClause}
    `).run({ dateFrom, dateTo, source })

    if (source !== 'manual') {
      db.prepare(
        'UPDATE payroll_settings SET device_last_synced_at = NULL WHERE id = 1',
      ).run()
    }

    return { deleted: result.changes }
  })()
}

// ── Phase C (C2): Shifts ─────────────────────────────────

export function listShifts(db: Database.Database): Shift[] {
  return db.prepare('SELECT * FROM shifts ORDER BY name ASC').all() as Shift[]
}

export function getShiftById(db: Database.Database, id: number): Shift | null {
  const row = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id) as Shift | undefined
  return row ?? null
}

export function createShift(db: Database.Database, input: CreateShiftInput): Shift {
  const now = new Date().toISOString()
  try {
    const result = db.prepare(`
      INSERT INTO shifts (name, start_time, end_time, standard_hours, created_at, updated_at)
      VALUES (@name, @start_time, @end_time, @standard_hours, @created_at, @updated_at)
    `).run({
      name: input.name,
      start_time: input.start_time,
      end_time: input.end_time,
      standard_hours: input.standard_hours,
      created_at: now,
      updated_at: now,
    })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return getShiftById(db, result.lastInsertRowid as number)!
  } catch (err) {
    throw new Error(`Failed to create shift: ${String(err)}`)
  }
}

export function updateShift(db: Database.Database, id: number, input: UpdateShiftInput): Shift {
  const existing = getShiftById(db, id)
  if (!existing) {
    throw new Error(`Shift with id ${id} not found`)
  }
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE shifts
    SET name = @name,
        start_time = @start_time,
        end_time = @end_time,
        standard_hours = @standard_hours,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    name: input.name ?? existing.name,
    start_time: input.start_time ?? existing.start_time,
    end_time: input.end_time ?? existing.end_time,
    standard_hours: input.standard_hours ?? existing.standard_hours,
    updated_at: now,
    id,
  })
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getShiftById(db, id)!
}

export function deleteShift(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM shifts WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Shift with id ${id} not found`)
  }
  // employees.shift_id and attendance_logs.shift_id are ON DELETE SET NULL,
  // so removing a shift definition doesn't lose employee/punch records.
}

/**
 * Assigns a shift to an employee (their default shift). Pass null to clear.
 * Returns the updated employee row (with shift_name joined).
 */
export function assignShiftToEmployee(
  db: Database.Database,
  employeeId: number,
  shiftId: number | null,
): { id: number; name: string; shift_id: number | null; shift_name: string | null } {
  const emp = db.prepare('SELECT id, name FROM employees WHERE id = ?').get(employeeId) as
    | { id: number; name: string }
    | undefined
  if (!emp) {
    throw new Error(`Employee with id ${employeeId} not found`)
  }
  if (shiftId !== null) {
    const shift = getShiftById(db, shiftId)
    if (!shift) {
      throw new Error(`Shift with id ${shiftId} not found`)
    }
  }
  const now = new Date().toISOString()
  db.prepare('UPDATE employees SET shift_id = ?, updated_at = ? WHERE id = ?').run(
    shiftId,
    now,
    employeeId,
  )
  const row = db.prepare(`
    SELECT e.id, e.name, e.shift_id, s.name AS shift_name
    FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
    WHERE e.id = ?
  `).get(employeeId) as { id: number; name: string; shift_id: number | null; shift_name: string | null }
  return row
}

// ── Phase C (C1): Leave ──────────────────────────────────

/**
 * Returns the leave balance for an employee in a given year.
 * Missing entitlement rows are treated as 0 (the admin hasn't allocated yet).
 * Unpaid leave is reported as 0 balance (no cap — informational only).
 */
export function getEmployeeLeaveBalance(
  db: Database.Database,
  employeeId: number,
  year: number,
): LeaveBalance {
  const rows = db.prepare(`
    SELECT leave_type, balance FROM employee_leave_entitlements
    WHERE employee_id = ? AND year = ?
  `).all(employeeId, year) as Array<{ leave_type: string; balance: number }>

  const balance: LeaveBalance = { annual: 0, sick: 0, unpaid: 0 }
  for (const row of rows) {
    if (row.leave_type === 'annual') balance.annual = row.balance
    else if (row.leave_type === 'sick') balance.sick = row.balance
    // unpaid has no cap; balance stays 0 (informational)
  }
  return balance
}

/** Returns the entitlement row (or null) for a given employee × type × year. */
function getLeaveEntitlement(
  db: Database.Database,
  employeeId: number,
  leaveType: string,
  year: number,
): LeaveEntitlement | null {
  const row = db.prepare(`
    SELECT * FROM employee_leave_entitlements
    WHERE employee_id = ? AND leave_type = ? AND year = ?
  `).get(employeeId, leaveType, year) as LeaveEntitlement | undefined
  return row ?? null
}

/** Counts inclusive days between two YYYY-MM-DD dates. */
function countDaysInclusive(dateFrom: string, dateTo: string): number {
  const from = new Date(dateFrom + 'T00:00:00')
  const to = new Date(dateTo + 'T00:00:00')
  const ms = to.getTime() - from.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1
}

/**
 * Creates a leave request. Rejects if:
 *  - date_to < date_from (caught by Zod/DB CHECK, but double-check here)
 *  - the date range overlaps an existing pending/approved request for the same employee
 *  - the leave type is annual/sick AND the available balance is 0 (no entitlement row
 *    or balance already exhausted). Unpaid leave has no balance check.
 *
 * The balance is NOT decremented here — that happens on approval, so rejecting a
 * request never touches the balance and a pending request doesn't reserve days.
 */
export function createLeaveRequest(
  db: Database.Database,
  input: CreateLeaveRequestInput,
): LeaveRecord {
  if (input.date_to < input.date_from) {
    throw new Error('date_to must be on or after date_from')
  }

  // Overlap check: any existing pending/approved leave for this employee that
  // intersects the requested range. Rejected leave doesn't block new requests.
  const overlap = db.prepare(`
    SELECT COUNT(*) as cnt FROM leave_records
    WHERE employee_id = ?
      AND status IN ('pending', 'approved')
      AND date_to >= ? AND date_from <= ?
  `).get(input.employee_id, input.date_from, input.date_to) as { cnt: number }
  if (overlap.cnt > 0) {
    throw new Error(
      `Leave request overlaps an existing pending/approved leave for employee ${input.employee_id}`,
    )
  }

  // Balance check for capped leave types. Unpaid leave skips this.
  if (input.leave_type !== 'unpaid') {
    const year = parseInt(input.date_from.slice(0, 4), 10)
    const balance = getEmployeeLeaveBalance(db, input.employee_id, year)
    const available = input.leave_type === 'annual' ? balance.annual : balance.sick
    const requested = countDaysInclusive(input.date_from, input.date_to)
    if (available <= 0) {
      throw new Error(
        `Employee ${input.employee_id} has no ${input.leave_type} leave balance for ${year}`,
      )
    }
    if (requested > available) {
      throw new Error(
        `Requested ${requested} day(s) of ${input.leave_type} leave exceeds available balance of ${available}`,
      )
    }
  }

  const now = new Date().toISOString()
  try {
    const result = db.prepare(`
      INSERT INTO leave_records (employee_id, leave_type, date_from, date_to, reason, status, created_at, updated_at)
      VALUES (@employee_id, @leave_type, @date_from, @date_to, @reason, 'pending', @created_at, @updated_at)
    `).run({
      employee_id: input.employee_id,
      leave_type: input.leave_type,
      date_from: input.date_from,
      date_to: input.date_to,
      reason: input.reason ?? null,
      created_at: now,
      updated_at: now,
    })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return getLeaveRecordById(db, result.lastInsertRowid as number)!
  } catch (err) {
    throw new Error(`Failed to create leave request: ${String(err)}`)
  }
}

/** Fetches a single leave record with employee name joined. */
function getLeaveRecordById(db: Database.Database, id: number): LeaveRecord | null {
  const row = db.prepare(`
    SELECT l.id, l.employee_id, e.name AS employee_name,
           l.leave_type, l.date_from, l.date_to, l.reason, l.status,
           l.created_at, l.updated_at
    FROM leave_records l
    LEFT JOIN employees e ON e.id = l.employee_id
    WHERE l.id = ?
  `).get(id) as LeaveRecord | undefined
  return row ?? null
}

export function listLeaveRecords(
  db: Database.Database,
  filters?: { employeeId?: number; status?: string; dateFrom?: string; dateTo?: string },
): LeaveRecord[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  if (filters?.employeeId) {
    conditions.push('l.employee_id = @employeeId')
    params.employeeId = filters.employeeId
  }
  if (filters?.status) {
    conditions.push('l.status = @status')
    params.status = filters.status
  }
  if (filters?.dateFrom) {
    conditions.push('l.date_to >= @dateFrom')
    params.dateFrom = filters.dateFrom
  }
  if (filters?.dateTo) {
    conditions.push('l.date_from <= @dateTo')
    params.dateTo = filters.dateTo
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return db.prepare(`
    SELECT l.id, l.employee_id, e.name AS employee_name,
           l.leave_type, l.date_from, l.date_to, l.reason, l.status,
           l.created_at, l.updated_at
    FROM leave_records l
    LEFT JOIN employees e ON e.id = l.employee_id
    ${where}
    ORDER BY l.date_from DESC, l.created_at DESC
  `).all(params) as LeaveRecord[]
}

/**
 * Approves a pending leave request and decrements the employee's entitlement balance
 * for the leave type × year. Wrapped in a transaction so the balance and status
 * always move together. Throws if the request isn't pending or the balance is
 * insufficient (the balance was checked at request time, but the admin may have
 * approved other leave in the meantime — re-check at approval).
 */
export function approveLeave(db: Database.Database, id: number): LeaveRecord {
  return db.transaction(() => {
    const record = getLeaveRecordById(db, id)
    if (!record) {
      throw new Error(`Leave record with id ${id} not found`)
    }
    if (record.status !== 'pending') {
      throw new Error(`Leave record ${id} is already ${record.status} (only pending can be approved)`)
    }

    // Decrement balance for capped leave types. Unpaid leave has no balance.
    if (record.leave_type !== 'unpaid') {
      const year = parseInt(record.date_from.slice(0, 4), 10)
      const days = countDaysInclusive(record.date_from, record.date_to)
      const entitlement = getLeaveEntitlement(db, record.employee_id, record.leave_type, year)
      if (!entitlement) {
        throw new Error(
          `No ${record.leave_type} leave entitlement exists for employee ${record.employee_id} in ${year}`,
        )
      }
      if (entitlement.balance < days) {
        throw new Error(
          `Insufficient ${record.leave_type} leave balance: have ${entitlement.balance}, need ${days}`,
        )
      }
      const now = new Date().toISOString()
      db.prepare(`
        UPDATE employee_leave_entitlements
        SET balance = balance - ?, updated_at = ?
        WHERE id = ?
      `).run(days, now, entitlement.id)
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE leave_records SET status = 'approved', updated_at = ? WHERE id = ?
    `).run(now, id)

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return getLeaveRecordById(db, id)!
  })()
}

/** Rejects a pending leave request. No balance change (balance is only touched on approval). */
export function rejectLeave(db: Database.Database, id: number): LeaveRecord {
  const record = getLeaveRecordById(db, id)
  if (!record) {
    throw new Error(`Leave record with id ${id} not found`)
  }
  if (record.status !== 'pending') {
    throw new Error(`Leave record ${id} is already ${record.status} (only pending can be rejected)`)
  }
  const now = new Date().toISOString()
  db.prepare(`UPDATE leave_records SET status = 'rejected', updated_at = ? WHERE id = ?`).run(now, id)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getLeaveRecordById(db, id)!
}

// ── Phase C (C3): Late detection ─────────────────────────

/**
 * Marks a 'late' attendance log as 'excused-late' (admin override — e.g. employee
 * had a valid reason). Only applies to logs currently flagged 'late'. Returns the
 * updated log. This is the only way a log becomes 'excused-late'.
 */
export function excuseLateEntry(db: Database.Database, logId: number): AttendanceLog {
  const existing = queryById(db, logId)
  if (!existing) {
    throw new Error(`Attendance log with id ${logId} not found`)
  }
  if (existing.status !== 'late') {
    throw new Error(
      `Attendance log ${logId} has status '${existing.status}' (only 'late' logs can be excused)`,
    )
  }
  const now = new Date().toISOString()
  db.prepare(`UPDATE attendance_logs SET status = 'excused-late', updated_at = ? WHERE id = ?`).run(
    now,
    logId,
  )
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return queryById(db, logId)!
}

/**
 * Phase 7: Late report from daily_attendance_records (processed data).
 * minutes_late is pre-computed by the processing engine — no need to re-derive
 * from raw logs and shift start times.
 */
export function getLateReport(db: Database.Database, year: number, month: number): LateReportRow[] {
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthStart = `${year}-${pad(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${year}-${pad(month)}-${pad(lastDay)}`

  const rows = db.prepare(`
    SELECT
      dar.employee_id,
      e.name AS employee_name,
      dar.attendance_status,
      SUM(dar.minutes_late) AS total_minutes_late,
      COUNT(*) AS event_count
    FROM daily_attendance_records dar
    LEFT JOIN employees e ON e.id = dar.employee_id
    WHERE dar.date >= ? AND dar.date <= ?
      AND dar.attendance_status IN ('late', 'excused_late')
    GROUP BY dar.employee_id, dar.attendance_status
  `).all(monthStart, monthEnd) as Array<{
    employee_id: number
    employee_name: string
    attendance_status: string
    total_minutes_late: number
    event_count: number
  }>

  const byEmployee = new Map<number, LateReportRow>()
  for (const row of rows) {
    const existing = byEmployee.get(row.employee_id)
    if (existing) {
      if (row.attendance_status === 'late') existing.count_late += row.event_count
      else existing.count_excused += row.event_count
      existing.total_minutes_late += row.total_minutes_late
    } else {
      byEmployee.set(row.employee_id, {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        count_late: row.attendance_status === 'late' ? row.event_count : 0,
        count_excused: row.attendance_status === 'excused_late' ? row.event_count : 0,
        total_minutes_late: row.total_minutes_late,
        avg_minutes_late: 0,
      })
    }
  }

  const result = Array.from(byEmployee.values()).map((r) => {
    const total = r.count_late + r.count_excused
    return { ...r, avg_minutes_late: total > 0 ? Math.round((r.total_minutes_late / total) * 10) / 10 : 0 }
  })

  result.sort((a, b) => b.total_minutes_late - a.total_minutes_late || b.count_late - a.count_late)
  return result
}

// ── Phase C (C4): Monthly calendar + Excel export ─────────

/**
 * Phase 7: Monthly calendar from daily_attendance_records (processed data).
 * All attendance statuses, hours, and leave classification are pre-computed
 * by the processing engine — the calendar is now a simple read query.
 */
export function getMonthlyCalendar(
  db: Database.Database,
  employeeId: number,
  year: number,
  month: number,
): AttendanceMonthlyCalendar {
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthStart = `${year}-${pad(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${year}-${pad(month)}-${pad(lastDay)}`

  const emp = db.prepare('SELECT id, name FROM employees WHERE id = ?').get(employeeId) as
    | { id: number; name: string } | undefined
  if (!emp) throw new Error(`Employee with id ${employeeId} not found`)

  const rows = db.prepare(`
    SELECT date, attendance_status, leave_type, first_in, last_out,
           total_clocked_hours, calendar_type
    FROM daily_attendance_records
    WHERE employee_id = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `).all(employeeId, monthStart, monthEnd) as Array<{
    date: string
    attendance_status: string
    leave_type: string | null
    first_in: string | null
    last_out: string | null
    total_clocked_hours: number
    calendar_type: string
  }>

  const recordByDate = new Map<string, typeof rows[0]>()
  for (const r of rows) {
    recordByDate.set(r.date, r)
  }

  const days: AttendanceSummaryDay[] = []
  let totalHours = 0
  let daysWorked = 0
  let daysLate = 0
  let daysLeave = 0

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const rec = recordByDate.get(dateStr)

    if (!rec) {
      // No processed record — treat as absent (no data available)
      days.push({ date: dateStr, first_in: null, last_out: null, hours_worked: 0, status: 'absent', leave_type: null })
      continue
    }

    const status = rec.attendance_status

    // Map processing-engine statuses to UI-compatible statuses
    if (status === 'on_leave' || status === 'holiday' || status === 'weekly_off' || status === 'emergency_closure') {
      days.push({
        date: dateStr,
        first_in: rec.first_in,
        last_out: rec.last_out,
        hours_worked: 0,
        status: 'leave',
        leave_type: (rec.leave_type as LeaveRecord['leave_type']) ?? null,
      })
      daysLeave++
      continue
    }

    if (status === 'absent' || status === 'no_show') {
      days.push({ date: dateStr, first_in: rec.first_in, last_out: rec.last_out, hours_worked: 0, status: 'absent', leave_type: null })
      continue
    }

    // Working day statuses: present, late, excused_late, early_out
    const hours = Math.round(rec.total_clocked_hours * 100) / 100
    totalHours += hours
    daysWorked++

    let dayStatus: AttendanceSummaryDay['status'] = 'on-time'
    if (status === 'late') {
      dayStatus = 'late'
      daysLate++
    } else if (status === 'excused_late') {
      dayStatus = 'excused-late'
      daysLate++
    }

    days.push({
      date: dateStr,
      first_in: rec.first_in,
      last_out: rec.last_out,
      hours_worked: hours,
      status: dayStatus,
      leave_type: null,
    })
  }

  return {
    employee_id: employeeId,
    employee_name: emp.name,
    year,
    month,
    days,
    total_hours: Math.round(totalHours * 100) / 100,
    days_worked: daysWorked,
    days_late: daysLate,
    days_leave: daysLeave,
  }
}

/**
 * Exports a monthly attendance report to an Excel file using exceljs.
 * One row per employee × day, plus summary rows. Writes to outputDir and returns
 * the absolute file path + filename. The IPC layer resolves outputDir via
 * app.getPath('userData') — kept out of the service layer per the payslipPdf pattern.
 */
export async function exportMonthlyAttendanceExcel(
  db: Database.Database,
  year: number,
  month: number,
  outputDir: string,
): Promise<{ filePath: string; filename: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(`Attendance ${year}-${String(month).padStart(2, '0')}`)

  sheet.columns = [
    { header: 'Employee ID', key: 'employee_id', width: 12 },
    { header: 'Employee Name', key: 'employee_name', width: 24 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'First In', key: 'first_in', width: 12 },
    { header: 'Last Out', key: 'last_out', width: 12 },
    { header: 'Hours Worked', key: 'hours_worked', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Leave Type', key: 'leave_type', width: 12 },
  ]

  // Style header row
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8E6FF' }, // indigo-50
  }

  // Get all active employees
  const employees = db.prepare(`
    SELECT id, name FROM employees WHERE status = 'active' ORDER BY name ASC
  `).all() as Array<{ id: number; name: string }>

  for (const emp of employees) {
    const calendar = getMonthlyCalendar(db, emp.id, year, month)
    for (const day of calendar.days) {
      sheet.addRow({
        employee_id: emp.id,
        employee_name: emp.name,
        date: day.date,
        first_in: day.first_in ? day.first_in.slice(11, 19) : '',
        last_out: day.last_out ? day.last_out.slice(11, 19) : '',
        hours_worked: day.hours_worked,
        status: day.status,
        leave_type: day.leave_type ?? '',
      })
    }
    // Summary row per employee
    sheet.addRow({
      employee_id: '',
      employee_name: `${emp.name} — TOTAL`,
      date: '',
      first_in: '',
      last_out: '',
      hours_worked: calendar.total_hours,
      status: `${calendar.days_worked}d worked, ${calendar.days_late} late, ${calendar.days_leave} leave`,
      leave_type: '',
    })
  }

  const filename = `attendance_${year}-${String(month).padStart(2, '0')}.xlsx`
  const filePath = `${outputDir}/${filename}`.replace(/\//g, require('path').sep)
  await workbook.xlsx.writeFile(filePath)
  return { filePath, filename }
}

