// Regression/feature coverage for rest/lunch break-limit tracking (migration
// 0019_break_limit.sql). Confirmed with the project owner: employees clock
// out/in for lunch (two sessions/day), and they want to know who exceeds the
// shift's allowed break duration. See docs/OT_CALCULATION_PLAN.md.
//
// The processing engine (attendanceProcessor.ts, Stage 10) computes the gap
// between consecutive IN/OUT sessions on the same day as the break taken, and
// flags break_minutes_over when it exceeds shift.break_minutes. This does not
// change regular/OT hours — those were already correct since break time was
// never counted in any session's elapsed time.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { triggerProcessing, getDailyRecordsByPeriod } from '../attendanceProcessor'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, path.resolve(process.cwd(), 'electron/db/migrations'))
  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  // Morning shift: 09:00-18:00, standard_hours=7 (net, since lunch is clocked
  // separately — Scenario B confirmed with the project owner), break allowance 60 min.
  db.prepare(`
    INSERT INTO shifts (id, name, start_time, end_time, standard_hours, break_minutes)
    VALUES (100, 'Morning 9-6', '09:00', '18:00', 7, 60)
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

describe('processing engine: break-limit tracking (Stage 10)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  it('flags a lunch break that exceeds the shift allowance', () => {
    // 09:00-13:00 (4h), lunch 13:00-14:30 (90 min — 30 over the 60-min allowance), 14:30-18:00 (3.5h)
    log(db, 2, 'in', '2026-08-10T09:00:00')
    log(db, 2, 'out', '2026-08-10T13:00:00')
    log(db, 2, 'in', '2026-08-10T14:30:00')
    log(db, 2, 'out', '2026-08-10T18:00:00')

    triggerProcessing(db, 1, [2])
    const records = getDailyRecordsByPeriod(db, 1, 2)
    const day = records.find((r) => r.date === '2026-08-10')

    expect(day).toBeDefined()
    expect(day!.break_hours).toBeCloseTo(1.5, 2)
    expect(day!.break_minutes_over).toBe(30)
    // total clocked 7.5h, standard_hours=7 → regular capped at 7, OT = 0.5. Break math
    // is purely informational and must not further reduce these.
    expect(day!.total_clocked_hours).toBeCloseTo(7.5, 2)
    expect(day!.regular_hours).toBeCloseTo(7, 2)
    expect(day!.ot_hours).toBeCloseTo(0.5, 2)
  })

  it('does not flag a break within the allowance', () => {
    // 09:00-13:00, lunch exactly 60 min, 14:00-17:00
    log(db, 2, 'in', '2026-08-10T09:00:00')
    log(db, 2, 'out', '2026-08-10T13:00:00')
    log(db, 2, 'in', '2026-08-10T14:00:00')
    log(db, 2, 'out', '2026-08-10T17:00:00')

    triggerProcessing(db, 1, [2])
    const records = getDailyRecordsByPeriod(db, 1, 2)
    const day = records.find((r) => r.date === '2026-08-10')

    expect(day!.break_hours).toBeCloseTo(1, 2)
    expect(day!.break_minutes_over).toBe(0)
  })

  it('records zero break for a single continuous session (no separate lunch punch)', () => {
    log(db, 2, 'in', '2026-08-10T09:00:00')
    log(db, 2, 'out', '2026-08-10T17:00:00')

    triggerProcessing(db, 1, [2])
    const records = getDailyRecordsByPeriod(db, 1, 2)
    const day = records.find((r) => r.date === '2026-08-10')

    expect(day!.break_hours).toBe(0)
    expect(day!.break_minutes_over).toBe(0)
  })

  it('falls back to a 60-minute default allowance when the employee has no shift', () => {
    db.prepare('UPDATE employees SET shift_id = NULL WHERE id = 2').run()
    log(db, 2, 'in', '2026-08-10T09:00:00')
    log(db, 2, 'out', '2026-08-10T13:00:00')
    log(db, 2, 'in', '2026-08-10T15:00:00') // 120-min break, 60 over the default allowance
    log(db, 2, 'out', '2026-08-10T18:00:00')

    triggerProcessing(db, 1, [2])
    const records = getDailyRecordsByPeriod(db, 1, 2)
    const day = records.find((r) => r.date === '2026-08-10')

    expect(day!.break_hours).toBeCloseTo(2, 2)
    expect(day!.break_minutes_over).toBe(60)
  })
})
