// Regression: triggerProcessing() had no unique key on (employee_id, date) alone —
// only (employee_id, date, processing_run_id) — and never cleared prior records for
// the period before inserting a new batch. Re-running "Process Attendance" for the
// same period (needed after fixing attendance data, or after an app update that
// changes the processing engine — e.g. the paid-leave-hours fix) would leave the old
// batch's rows in place alongside the new ones, silently double-counting hours in
// every downstream summary/report (none of which filter by processing_run_id).
// Fixed by deleting the period's existing daily_attendance_records for the employees
// being (re)processed before inserting the fresh batch, and refusing to reprocess a
// finalized/closed period (whose records are meant to be locked).
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { triggerProcessing, getDailyRecordsByPeriod, getAttendanceSummaryForDateRange } from '../attendanceProcessor'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, path.resolve(process.cwd(), 'electron/db/migrations'))
  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO shifts (id, name, start_time, end_time, standard_hours, break_minutes)
    VALUES (100, 'Morning 9-6', '09:00', '18:00', 8, 60)
  `).run()
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined, shift_id)
    VALUES (2, 'EMP002', 'Employee 2', '900101-01-1234', 1, 'active', '2020-01-01', 100)
  `).run()
  db.prepare(`
    INSERT INTO payroll_periods (id, name, start_date, end_date, status)
    VALUES (1, 'Aug 2026', '2026-08-10', '2026-08-11', 'open')
  `).run()
  return db
}

function log(db: Database.Database, employeeId: number, type: 'in' | 'out', timestamp: string): void {
  db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
    VALUES (?, ?, ?, 'manual', datetime('now'), datetime('now'))
  `).run(employeeId, type, timestamp)
}

describe('triggerProcessing reprocessing safety', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  it('replaces rather than duplicates records when run twice for the same period', () => {
    log(db, 2, 'in', '2026-08-10T09:00:00')
    log(db, 2, 'out', '2026-08-10T17:00:00')

    triggerProcessing(db, 1, [2])
    triggerProcessing(db, 1, [2]) // reprocess, nothing changed

    const records = getDailyRecordsByPeriod(db, 1, 2)
    expect(records).toHaveLength(2) // one row per day in the period (08-10, 08-11) — not 4

    const summaries = getAttendanceSummaryForDateRange(db, { employeeIds: [2], startDate: '2026-08-10', endDate: '2026-08-10' })
    expect(summaries.find((s) => s.employee_id === 2)!.total_regular_hours).toBe(8) // not 16
  })

  it('reflects newly added attendance data on reprocess, not stale + new combined', () => {
    log(db, 2, 'in', '2026-08-10T09:00:00')
    log(db, 2, 'out', '2026-08-10T13:00:00') // 4h only, first process

    triggerProcessing(db, 1, [2])
    let summaries = getAttendanceSummaryForDateRange(db, { employeeIds: [2], startDate: '2026-08-10', endDate: '2026-08-10' })
    expect(summaries.find((s) => s.employee_id === 2)!.total_regular_hours).toBe(4)

    log(db, 2, 'in', '2026-08-10T14:00:00')
    log(db, 2, 'out', '2026-08-10T18:00:00') // admin adds the missed afternoon punches

    triggerProcessing(db, 1, [2]) // reprocess
    summaries = getAttendanceSummaryForDateRange(db, { employeeIds: [2], startDate: '2026-08-10', endDate: '2026-08-10' })
    expect(summaries.find((s) => s.employee_id === 2)!.total_regular_hours).toBe(8) // corrected total, not 4 + 8
  })

  it('refuses to reprocess a finalized period', () => {
    db.prepare(`UPDATE payroll_periods SET status = 'processing' WHERE id = 1`).run()
    triggerProcessing(db, 1, [2])
    db.prepare(`UPDATE payroll_periods SET status = 'finalized' WHERE id = 1`).run()

    expect(() => triggerProcessing(db, 1, [2])).toThrow(/is finalized and its attendance records are locked/)
  })

  it('refuses to reprocess a closed period', () => {
    db.prepare(`UPDATE payroll_periods SET status = 'closed' WHERE id = 1`).run()
    expect(() => triggerProcessing(db, 1, [2])).toThrow(/is closed and its attendance records are locked/)
  })
})
