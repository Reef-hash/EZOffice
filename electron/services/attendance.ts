// Attendance service — business logic for attendance_logs.
// All functions take `db` as the first argument (testable, no hidden global).
// All queries use prepared statements.
// Alternation validation is shared across clockIn/clockOut/createManualLog.

import type Database from 'better-sqlite3'
import type { AttendanceLog } from '../../src/shared/types/entities'
import type { CreateAttendanceLogInput, UpdateAttendanceLogInput } from '../../src/shared/types/inputs'

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

/** Queries a single AttendanceLog, joining employees for the employee_name. */
function queryById(db: Database.Database, id: number): AttendanceLog | null {
  const row = db.prepare(`
    SELECT
      a.id, a.employee_id, e.name AS employee_name,
      a.type, a.timestamp, a.source, a.device_id, a.note,
      a.created_at, a.updated_at
    FROM attendance_logs a
    LEFT JOIN employees e ON e.id = a.employee_id
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
      a.created_at, a.updated_at
    FROM attendance_logs a
    LEFT JOIN employees e ON e.id = a.employee_id
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
      a.created_at, a.updated_at
    FROM attendance_logs a
    LEFT JOIN employees e ON e.id = a.employee_id
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

  const result = db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
    VALUES (@employee_id, 'in', @timestamp, 'manual', @created_at, @updated_at)
  `).run({
    employee_id: employeeId,
    timestamp: ts,
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

  const result = db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
    VALUES (@employee_id, 'out', @timestamp, 'manual', @created_at, @updated_at)
  `).run({
    employee_id: employeeId,
    timestamp: ts,
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

  const result = db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, note, created_at, updated_at)
    VALUES (@employee_id, @type, @timestamp, 'manual', @note, @created_at, @updated_at)
  `).run({
    employee_id: input.employee_id,
    type: input.type,
    timestamp: input.timestamp,
    note: input.note ?? null,
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
  const merged = {
    employee_id: input.employee_id ?? existing.employee_id,
    type: input.type ?? existing.type,
    timestamp: input.timestamp ?? existing.timestamp,
    note: input.note !== undefined ? input.note : existing.note,
  }

  db.prepare(`
    UPDATE attendance_logs
    SET employee_id = @employee_id,
        type = @type,
        timestamp = @timestamp,
        note = @note,
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
    const Zkteco = require('zkteco-js').default
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
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
      VALUES (@employee_id, @type, @timestamp, 'device', @created_at, @updated_at)
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
          insertStmt.run({
            employee_id: log.employeeId,
            type: log.type,
            timestamp: log.timestamp,
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
