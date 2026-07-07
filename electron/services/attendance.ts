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
} from '../../src/shared/types/entities'
import type {
  CreateAttendanceLogInput,
  UpdateAttendanceLogInput,
  CreateShiftInput,
  UpdateShiftInput,
  CreateLeaveRequestInput,
} from '../../src/shared/types/inputs'

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
  console.log('[LATE-DETECT] getGracePeriodMinutes →', grace, '(raw:', row?.grace_period_minutes, ')')
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

  console.log('[LATE-DETECT] computeMinutesLate — shift:', shift.name, '| start:', shiftStart, '| punchTime:', punchTime, '| punchTimestamp (full):', punchTimestamp, '| grace:', graceMinutes)

  // For night shifts (start > end, e.g. 22:00→06:00), a punch at 22:30 is 30 min late,
  // a punch at 21:50 is "early" (before shift) → 0 minutes late.
  // For day shifts (start < end), straightforward comparison.
  const minutesLateRaw = minutesBetween(shiftStart, punchTime)
  console.log('[LATE-DETECT] minutesLateRaw:', minutesLateRaw, '→ after grace:', Math.max(0, minutesLateRaw - graceMinutes))
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
  console.log('[LATE-DETECT] computeClockInStatus — hasShift:', !!shift, '| shiftName:', shift?.name, '| timestamp:', punchTimestamp)
  if (!shift) {
    console.log('[LATE-DETECT]   → on-time (no shift assigned)')
    return 'on-time' // no assigned shift → no lateness rule
  }
  const grace = getGracePeriodMinutes(db)
  const minutesLate = computeMinutesLate(shift, punchTimestamp, grace)
  const result = minutesLate > 0 ? 'late' : 'on-time'
  console.log('[LATE-DETECT]   → RESULT:', result, '| minutesLate:', minutesLate, '| grace:', grace)
  return result
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
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('[LATE-DETECT] clockIn() called — employeeId:', employeeId, '| timestamp:', timestamp)
  assertAlternation(db, employeeId, 'in')

  const ts = timestamp ?? nowLocalISO()
  const now = new Date().toISOString()
  console.log('[LATE-DETECT]   effective timestamp:', ts, '| now:', now)

  // Phase C: snapshot the employee's assigned shift and compute lateness at clock-in.
  const shift = getEmployeeShift(db, employeeId)
  console.log('[LATE-DETECT]   employee shift:', shift?.name ?? 'NONE')
  const status = computeClockInStatus(db, shift, ts)
  console.log('[LATE-DETECT]   FINAL STATUS:', status)

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
  const result = db.prepare('DELETE FROM attendance_logs WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Attendance log with id ${id} not found`)
  }
}

// ── Device Sync (Phase 3: ZKTeco V1000) ──────────────────

interface DeviceSyncResult {
  inserted: number
  skipped: number
  errors: string[]
}

export async function syncFromDeviceEthernet(
  db: Database.Database,
  deviceIp: string,
  devicePort: number,
): Promise<DeviceSyncResult> {
  let device: any // zkteco-js types are loose; isolate here
  const errors: string[] = []
  let inserted = 0
  let skipped = 0

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Zkteco = require('zkteco-js')
    device = new Zkteco(deviceIp, devicePort, 5200, 5000)

    await device.createSocket()
    const logs = await device.getAttendances()
    await device.disconnect()

    if (!Array.isArray(logs) || logs.length === 0) {
      return { inserted: 0, skipped: 0, errors: [] }
    }

    // Map device logs: expected structure from zkteco-js is
    // { user_id, punch_time, punch_state } or similar.
    // Normalize to { employeeId, timestamp, type }
    const mappedLogs = logs
      .map((log: any) => {
        const employeeId = log.user_id || log.employeeId
        // punch_state: 0=Check-in, 1=Check-out (ZKTeco convention)
        // Normalize to 'in' | 'out'
        const punchState = log.punch_state ?? log.type
        const type: 'in' | 'out' = (punchState === 0 || punchState === 'in' || String(punchState).toLowerCase() === 'in')
          ? 'in'
          : 'out'
        // punch_time or timestamp; convert to ISO if needed
        const timestamp = typeof log.punch_time === 'string'
          ? log.punch_time
          : new Date(log.punch_time * 1000).toISOString()

        return { employeeId, timestamp, type }
      })
      .filter((log) => log.employeeId && log.timestamp)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    // Transaction: insert all new logs, respecting alternation per employee
    const insertStmt = db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
      VALUES (@employee_id, @type, @timestamp, 'device', @shift_id, @status, @created_at, @updated_at)
    `)

    // Check which logs already exist to avoid duplicates
    const existsStmt = db.prepare(`
      SELECT COUNT(*) as cnt FROM attendance_logs
      WHERE employee_id = @employee_id AND timestamp = @timestamp AND type = @type
    `)

    // Validate that the device user_id maps to a known employee — device numbering may not
    // match EZOffice IDs. Logs for unknown employee IDs are skipped rather than inserted
    // under a nonexistent or wrong employee.
    const employeeExistsStmt = db.prepare('SELECT COUNT(*) as cnt FROM employees WHERE id = ?')

    db.transaction(() => {
      for (const log of mappedLogs) {
        const empExists = employeeExistsStmt.get(log.employeeId) as { cnt: number }
        if (empExists.cnt === 0) {
          errors.push(`Skipped: Device user_id ${log.employeeId} does not match any employee in EZOffice`)
          skipped++
          continue
        }

        const exists = existsStmt.get({
          employee_id: log.employeeId,
          timestamp: log.timestamp,
          type: log.type,
        }) as { cnt: number }

        if (exists.cnt > 0) {
          skipped++
          continue
        }

        // Check alternation — re-use the same validator
        try {
          assertAlternation(db, log.employeeId, log.type)
          const now = new Date().toISOString()
          // Phase C: snapshot shift + status for device-sourced logs too.
          const shift = getEmployeeShift(db, log.employeeId)
          const status: 'on-time' | 'late' =
            log.type === 'in' ? computeClockInStatus(db, shift, log.timestamp) : 'on-time'
          insertStmt.run({
            employee_id: log.employeeId,
            type: log.type,
            timestamp: log.timestamp,
            shift_id: shift?.id ?? null,
            status,
            created_at: now,
            updated_at: now,
          })
          inserted++
        } catch (err) {
          errors.push(
            `Skipped: Employee ${log.employeeId} at ${log.timestamp}: ${String(err)}`,
          )
          skipped++
        }
      }
    })()

    return { inserted, skipped, errors }
  } catch (err) {
    throw new Error(`Device sync failed: ${String(err)}`)
  }
}

// Phase 4 will add: getMonthlyAttendanceSummary(db, employeeId, month) —
// aggregates work days, lateness, OT hours based on salary_structures table
// which doesn't exist yet.

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
 * Builds the late report for a given month: one row per employee who has at least
 * one 'late' or 'excused-late' log in that month. Counts, total minutes late, and
 * average minutes late per late event.
 */
export function getLateReport(db: Database.Database, year: number, month: number): LateReportRow[] {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Pull raw late/excused-late logs with their shift start time. Minutes late is
  // computed in JS (reusing the same minutesBetween/computeMinutesLate logic the
  // clock-in path uses) rather than in SQL — SQLite's MAX() is an aggregate, which
  // makes scalar "max(0, x)" awkward inside a SUM(CASE...), and doing it in JS keeps
  // the lateness math in one place.
  const rows = db.prepare(`
    SELECT
      a.employee_id,
      e.name AS employee_name,
      a.status,
      a.timestamp,
      s.start_time
    FROM attendance_logs a
    LEFT JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.status IN ('late', 'excused-late')
      AND date(a.timestamp) >= ? AND date(a.timestamp) <= ?
  `).all(monthStart, monthEnd) as Array<{
    employee_id: number
    employee_name: string
    status: string
    timestamp: string
    start_time: string | null
  }>

  const grace = getGracePeriodMinutes(db)

  // Aggregate per employee
  const byEmployee = new Map<number, LateReportRow & { _minutesSum: number }>()
  for (const row of rows) {
    const existing = byEmployee.get(row.employee_id)
    const minutesLate = row.start_time
      ? Math.max(0, minutesBetween(row.start_time, row.timestamp.slice(11, 16)) - grace)
      : 0

    if (existing) {
      if (row.status === 'late') existing.count_late++
      else existing.count_excused++
      existing.total_minutes_late += minutesLate
    } else {
      byEmployee.set(row.employee_id, {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        count_late: row.status === 'late' ? 1 : 0,
        count_excused: row.status === 'excused-late' ? 1 : 0,
        total_minutes_late: minutesLate,
        avg_minutes_late: 0,
        _minutesSum: 0,
      })
    }
  }

  const result = Array.from(byEmployee.values()).map((r) => {
    const total = r.count_late + r.count_excused
    const avg = total > 0 ? Math.round((r.total_minutes_late / total) * 10) / 10 : 0
    const { _minutesSum, ...rest } = r
    void _minutesSum
    return { ...rest, avg_minutes_late: avg }
  })

  result.sort(
    (a, b) => b.total_minutes_late - a.total_minutes_late || b.count_late - a.count_late,
  )
  return result
}

// ── Phase C (C4): Monthly calendar + Excel export ─────────

/**
 * Builds a per-day attendance calendar for one employee in one month.
 * Each day shows first IN, last OUT, hours worked, and a status derived from
 * the punch status / approved leave / absence. Approved leave days are marked
 * 'leave' with the leave type; days with no IN punch and no leave are 'absent'.
 */
export function getMonthlyCalendar(
  db: Database.Database,
  employeeId: number,
  year: number,
  month: number,
): AttendanceMonthlyCalendar {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Employee name
  const emp = db.prepare('SELECT id, name FROM employees WHERE id = ?').get(employeeId) as
    | { id: number; name: string }
    | undefined
  if (!emp) {
    throw new Error(`Employee with id ${employeeId} not found`)
  }

  // All punches for the month, ordered chronologically
  const logs = db.prepare(`
    SELECT type, timestamp, status FROM attendance_logs
    WHERE employee_id = ? AND date(timestamp) >= ? AND date(timestamp) <= ?
    ORDER BY timestamp ASC
  `).all(employeeId, monthStart, monthEnd) as Array<{
    type: 'in' | 'out'
    timestamp: string
    status: string
  }>

  // Approved leave days in the month (set of YYYY-MM-DD → leave_type)
  const leaveRows = db.prepare(`
    SELECT leave_type, date_from, date_to FROM leave_records
    WHERE employee_id = ? AND status = 'approved'
      AND date_to >= ? AND date_from <= ?
  `).all(employeeId, monthStart, monthEnd) as Array<{
    leave_type: string
    date_from: string
    date_to: string
  }>
  const leaveByDay = new Map<string, string>()
  for (const lr of leaveRows) {
    const from = new Date(lr.date_from + 'T00:00:00')
    const to = new Date(lr.date_to + 'T00:00:00')
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10)
      if (ds >= monthStart && ds <= monthEnd) {
        leaveByDay.set(ds, lr.leave_type)
      }
    }
  }

  // Group punches by calendar day
  const punchesByDay = new Map<string, { ins: string[]; outs: string[]; statuses: string[] }>()
  for (const log of logs) {
    const day = log.timestamp.slice(0, 10)
    const entry = punchesByDay.get(day) ?? { ins: [], outs: [], statuses: [] }
    if (log.type === 'in') {
      entry.ins.push(log.timestamp)
      entry.statuses.push(log.status)
    } else {
      entry.outs.push(log.timestamp)
    }
    punchesByDay.set(day, entry)
  }

  const days: AttendanceSummaryDay[] = []
  let totalHours = 0
  let daysWorked = 0
  let daysLate = 0
  let daysLeave = 0

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const punches = punchesByDay.get(dateStr)
    const leaveType = leaveByDay.get(dateStr) ?? null

    if (leaveType) {
      // Approved leave takes precedence over absence/late classification.
      days.push({
        date: dateStr,
        first_in: null,
        last_out: null,
        hours_worked: 0,
        status: 'leave',
        leave_type: leaveType as LeaveRecord['leave_type'],
      })
      daysLeave++
      continue
    }

    if (!punches || punches.ins.length === 0) {
      // No IN punch and no leave → absent
      days.push({
        date: dateStr,
        first_in: null,
        last_out: punches && punches.outs.length > 0 ? punches.outs[punches.outs.length - 1] : null,
        hours_worked: 0,
        status: 'absent',
        leave_type: null,
      })
      continue
    }

    // Has at least one IN. Compute hours from first IN → last OUT (if any OUT exists).
    const firstIn = punches.ins[0]
    const lastOut = punches.outs.length > 0 ? punches.outs[punches.outs.length - 1] : null
    let hours = 0
    if (lastOut) {
      hours = (new Date(lastOut).getTime() - new Date(firstIn).getTime()) / (1000 * 60 * 60)
      hours = Math.max(0, Math.round(hours * 100) / 100)
    }
    totalHours += hours
    daysWorked++

    // Day-level status: if any IN punch was 'late' or 'excused-late', reflect that.
    let dayStatus: AttendanceSummaryDay['status'] = 'on-time'
    if (punches.statuses.includes('late')) {
      dayStatus = 'late'
      daysLate++
    } else if (punches.statuses.includes('excused-late')) {
      dayStatus = 'excused-late'
    }

    days.push({
      date: dateStr,
      first_in: firstIn,
      last_out: lastOut,
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
