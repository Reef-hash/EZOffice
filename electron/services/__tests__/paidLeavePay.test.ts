// Regression: approved annual/sick leave paid 0 for the day instead of a normal
// day's pay. Reported by the project owner ("MC dan annual leave tak beri gaji
// sehari (8 jam)"). Root cause: attendanceProcessor.ts Stage 10 only credited
// regular_hours when attendance_status was 'present'/'late'/'early_out' — an
// 'on_leave' day (set for ANY leave_type, including paid annual/sick) always fell
// through with regular_hours = 0, silently underpaying daily/hourly-rate employees
// for paid leave (which under the Employment Act 1955 must be paid as a normal
// working day). Unpaid leave correctly stays at 0 pay. Monthly-salary employees are
// unaffected (their gross pay never depends on hours/days_worked).
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
    VALUES (1, 'Aug 2026', '2026-08-10', '2026-08-13', 'open')
  `).run()
  return db
}

function approveLeave(
  db: Database.Database,
  employeeId: number,
  leaveType: 'annual' | 'sick' | 'unpaid',
  date: string,
): void {
  db.prepare(`
    INSERT INTO leave_records (employee_id, leave_type, date_from, date_to, status)
    VALUES (?, ?, ?, ?, 'approved')
  `).run(employeeId, leaveType, date, date)
}

function log(db: Database.Database, employeeId: number, type: 'in' | 'out', timestamp: string): void {
  db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
    VALUES (?, ?, ?, 'manual', datetime('now'), datetime('now'))
  `).run(employeeId, type, timestamp)
}

describe('processing engine: paid vs unpaid leave hours (Stage 10)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  it('credits a full standard-hours day for approved annual leave', () => {
    approveLeave(db, 2, 'annual', '2026-08-10')

    triggerProcessing(db, 1, [2])
    const records = getDailyRecordsByPeriod(db, 1, 2)
    const day = records.find((r) => r.date === '2026-08-10')

    expect(day!.attendance_status).toBe('on_leave')
    expect(day!.leave_type).toBe('annual')
    expect(day!.regular_hours).toBe(8)
    expect(day!.ot_hours).toBe(0)
  })

  it('credits a full standard-hours day for approved sick leave (MC)', () => {
    approveLeave(db, 2, 'sick', '2026-08-11')

    triggerProcessing(db, 1, [2])
    const records = getDailyRecordsByPeriod(db, 1, 2)
    const day = records.find((r) => r.date === '2026-08-11')

    expect(day!.attendance_status).toBe('on_leave')
    expect(day!.leave_type).toBe('sick')
    expect(day!.regular_hours).toBe(8)
    expect(day!.ot_hours).toBe(0)
  })

  it('does NOT pay unpaid leave', () => {
    approveLeave(db, 2, 'unpaid', '2026-08-12')

    triggerProcessing(db, 1, [2])
    const records = getDailyRecordsByPeriod(db, 1, 2)
    const day = records.find((r) => r.date === '2026-08-12')

    expect(day!.attendance_status).toBe('on_leave')
    expect(day!.leave_type).toBe('unpaid')
    expect(day!.regular_hours).toBe(0)
    expect(day!.ot_hours).toBe(0)
  })

  it('counts paid leave days in days_worked (for daily-rate pay) but not unpaid leave', () => {
    approveLeave(db, 2, 'annual', '2026-08-10')
    approveLeave(db, 2, 'sick', '2026-08-11')
    approveLeave(db, 2, 'unpaid', '2026-08-12')
    // 08-13: a normal worked day (09:00-17:00 = 8h, matches standard_hours, no OT)
    log(db, 2, 'in', '2026-08-13T09:00:00')
    log(db, 2, 'out', '2026-08-13T17:00:00')

    triggerProcessing(db, 1, [2])
    const summaries = getAttendanceSummaryForDateRange(db, { employeeIds: [2], startDate: '2026-08-10', endDate: '2026-08-13' })
    const summary = summaries.find((s) => s.employee_id === 2)!

    // annual + sick + the worked day = 3 paid days; unpaid leave excluded.
    expect(summary.days_worked).toBe(3)
    // 8h (annual) + 8h (sick) + 8h (worked, break excluded) = 24h regular.
    expect(summary.total_regular_hours).toBe(24)
    expect(summary.total_ot_hours).toBe(0)
  })
})
