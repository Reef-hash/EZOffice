// Attendance Exceptions service — H2/D5 implementation.
// Computes and persists attendance anomalies for admin review before payroll.
// D5: calculatePayrollRun refuses while any 'open' exception exists in the run month.
//
// Exceptions are computed on-demand (via IPC attendance:computeExceptions) before running
// payroll. Existing 'resolved' or 'dismissed' exceptions are preserved — the admin's
// decision is not overwritten on recomputation.

import type Database from 'better-sqlite3'
import type { AttendanceException } from '../../src/shared/types/entities'

/** Fetches a single exception with employee_name joined. */
function getExceptionById(db: Database.Database, id: number): AttendanceException | null {
  const row = db.prepare(`
    SELECT ae.*, e.name AS employee_name
    FROM attendance_exceptions ae
    LEFT JOIN employees e ON e.id = ae.employee_id
    WHERE ae.id = ?
  `).get(id) as AttendanceException | undefined
  return row ?? null
}

/**
 * Lists attendance exceptions with optional filters.
 */
export function listAttendanceExceptions(
  db: Database.Database,
  filters: { year: number; month: number; employeeId?: number; status?: string },
): AttendanceException[] {
  const conditions = ['ae.year = @year', 'ae.month = @month']
  const params: Record<string, unknown> = { year: filters.year, month: filters.month }

  if (filters.employeeId !== undefined) {
    conditions.push('ae.employee_id = @employeeId')
    params.employeeId = filters.employeeId
  }
  if (filters.status !== undefined) {
    conditions.push('ae.status = @status')
    params.status = filters.status
  }

  return db.prepare(`
    SELECT ae.*, e.name AS employee_name
    FROM attendance_exceptions ae
    LEFT JOIN employees e ON e.id = ae.employee_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ae.date ASC, ae.employee_id ASC
  `).all(params) as AttendanceException[]
}

/**
 * Computes attendance exceptions for a given month and upserts them into the DB.
 * Anomalies checked:
 *   - missing_punch: days with an odd number of punches (unpaired IN or OUT)
 *   - over_long_session: sessions longer than max_session_hours that would be excluded
 *   - punch_on_leave: employee punched while on approved leave
 *
 * Existing 'resolved' or 'dismissed' exceptions are left untouched.
 * New anomalies not yet in the DB are created as 'open'.
 *
 * Returns the count of newly created exception rows.
 */
export function computeAttendanceExceptions(
  db: Database.Database,
  year: number,
  month: number,
): { created: number } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthStart = `${year}-${pad(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${year}-${pad(month)}-${pad(lastDay)}`

  // Read config
  const maxSessionRow = db.prepare('SELECT max_session_hours FROM payroll_settings WHERE id = 1').get() as
    { max_session_hours?: number } | undefined
  const maxSessionHours = maxSessionRow?.max_session_hours ?? 16

  // Get all employees who have attendance in the month
  const employees = db.prepare(`
    SELECT DISTINCT employee_id FROM attendance_logs
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
  `).all(monthStart, monthEnd) as Array<{ employee_id: number }>

  // Get approved leave dates for all employees in the month
  const allLeaveRows = db.prepare(`
    SELECT employee_id, date_from, date_to FROM leave_records
    WHERE status = 'approved' AND date_from <= ? AND date_to >= ?
  `).all(monthEnd, monthStart) as Array<{ employee_id: number; date_from: string; date_to: string }>

  // Build: employeeId → Set<YYYY-MM-DD>
  const leaveByEmployee = new Map<number, Set<string>>()
  for (const lr of allLeaveRows) {
    const dates = leaveByEmployee.get(lr.employee_id) ?? new Set<string>()
    const from = new Date(lr.date_from + 'T00:00:00')
    const to = new Date(lr.date_to + 'T00:00:00')
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10)
      if (iso >= monthStart && iso <= monthEnd) dates.add(iso)
    }
    leaveByEmployee.set(lr.employee_id, dates)
  }

  const now = new Date().toISOString()
  let created = 0

  // Helper: insert an exception only if it doesn't already exist (any status).
  const existsStmt = db.prepare(`
    SELECT COUNT(*) AS cnt FROM attendance_exceptions
    WHERE employee_id = ? AND date = ? AND exception_type = ?
  `)
  const insertStmt = db.prepare(`
    INSERT INTO attendance_exceptions
      (employee_id, year, month, date, exception_type, description, status, related_log_ids, created_at, updated_at)
    VALUES
      (@employee_id, @year, @month, @date, @exception_type, @description, 'open', @related_log_ids, @now, @now)
  `)

  function upsertException(
    employeeId: number,
    date: string,
    exceptionType: string,
    description: string,
    relatedLogIds: number[],
  ): void {
    const exists = existsStmt.get(employeeId, date, exceptionType) as { cnt: number }
    if (exists.cnt > 0) return
    insertStmt.run({
      employee_id: employeeId,
      year,
      month,
      date,
      exception_type: exceptionType,
      description,
      related_log_ids: relatedLogIds.length > 0 ? JSON.stringify(relatedLogIds) : null,
      now,
    })
    created++
  }

  const insertTx = db.transaction(() => {
    for (const { employee_id: employeeId } of employees) {
      const logs = db.prepare(`
        SELECT id, type, timestamp FROM attendance_logs
        WHERE employee_id = ? AND date(timestamp) >= ? AND date(timestamp) <= ?
        ORDER BY timestamp ASC
      `).all(employeeId, monthStart, monthEnd) as Array<{ id: number; type: string; timestamp: string }>

      const leaveDates = leaveByEmployee.get(employeeId) ?? new Set<string>()

      // Group logs by day
      const byDay = new Map<string, Array<{ id: number; type: string; timestamp: string }>>()
      for (const log of logs) {
        const date = log.timestamp.slice(0, 10)
        const arr = byDay.get(date) ?? []
        arr.push(log)
        byDay.set(date, arr)
      }

      for (const [date, dayLogs] of byDay) {
        // Check punch_on_leave: any punch on a leave day
        if (leaveDates.has(date)) {
          upsertException(
            employeeId,
            date,
            'punch_on_leave',
            `Employee punched ${dayLogs.length} time(s) on approved leave day ${date}`,
            dayLogs.map((l) => l.id),
          )
        }

        // Check missing_punch: odd number of punches on this day
        if (dayLogs.length % 2 !== 0) {
          upsertException(
            employeeId,
            date,
            'missing_punch',
            `Odd number of punches (${dayLogs.length}) on ${date} — likely missing IN or OUT`,
            dayLogs.map((l) => l.id),
          )
        }

        // Check over_long_session: any IN→OUT pair longer than the cap
        let currentIn: { id: number; timestamp: string } | null = null
        for (const log of dayLogs) {
          if (log.type === 'in') {
            currentIn = { id: log.id, timestamp: log.timestamp }
          } else if (log.type === 'out' && currentIn !== null) {
            const hours = (new Date(log.timestamp).getTime() - new Date(currentIn.timestamp).getTime()) / (1000 * 60 * 60)
            if (hours > maxSessionHours) {
              upsertException(
                employeeId,
                date,
                'over_long_session',
                `Session from ${currentIn.timestamp.slice(11, 16)} to ${log.timestamp.slice(11, 16)} is ${Math.round(hours * 10) / 10}h (exceeds ${maxSessionHours}h cap)`,
                [currentIn.id, log.id],
              )
            }
            currentIn = null
          }
        }
      }
    }
  })

  insertTx()
  return { created }
}

/**
 * Marks an exception as resolved (admin fixed the underlying punches).
 */
export function resolveAttendanceException(
  db: Database.Database,
  id: number,
  note?: string,
): AttendanceException {
  const existing = getExceptionById(db, id)
  if (!existing) throw new Error(`Attendance exception ${id} not found`)
  if (existing.status === 'dismissed') {
    throw new Error(`Exception ${id} is already dismissed — cannot resolve a dismissed exception`)
  }
  db.prepare(`
    UPDATE attendance_exceptions SET status = 'resolved', note = ?, updated_at = ? WHERE id = ?
  `).run(note ?? null, new Date().toISOString(), id)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getExceptionById(db, id)!
}

/**
 * Marks an exception as dismissed (admin deliberately chose to leave it as-is).
 * A note is required — the admin must document why the exception is acceptable.
 */
export function dismissAttendanceException(
  db: Database.Database,
  id: number,
  note: string,
): AttendanceException {
  const existing = getExceptionById(db, id)
  if (!existing) throw new Error(`Attendance exception ${id} not found`)
  if (existing.status !== 'open') {
    throw new Error(`Exception ${id} is already ${existing.status} (only open exceptions can be dismissed)`)
  }
  db.prepare(`
    UPDATE attendance_exceptions SET status = 'dismissed', note = ?, updated_at = ? WHERE id = ?
  `).run(note, new Date().toISOString(), id)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getExceptionById(db, id)!
}
