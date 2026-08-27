// Integration coverage for rate_type='monthly' + attendance_required=1 (migration
// 0022) — exercises the real Company Calendar lookup (deriveMonthlyHourlyRate), the
// processing engine inclusion/exclusion rule, and a full payroll run end to end.
// Pure calculation-engine math is covered separately in monthlyAttendanceGate.test.ts.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { triggerProcessing } from '../attendanceProcessor'
import { createPayrollRun, calculatePayrollRun, getPayrollRunItems } from '../payroll/payrollRun'

const migrationsDir = path.resolve(process.cwd(), 'electron/db/migrations')

/** Period 2026-08-03 (Mon) - 2026-08-09 (Sun), one full week under the default Mon-Fri calendar. */
function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrationsDir)
  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO shifts (id, name, start_time, end_time, standard_hours, break_minutes)
    VALUES (100, 'Gate Test Shift', '09:00', '18:00', 8, 60)
  `).run()
  // Gated: basic tied to attendance.
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined, shift_id)
    VALUES (2, 'EMP002', 'Gated Worker', '900101-01-0002', 1, 'active', '2020-01-01', 100)
  `).run()
  db.prepare(`
    INSERT INTO salary_structures
      (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
       subject_to_epf, subject_to_socso, subject_to_eis, attendance_required)
    VALUES (1, 2, '2020-01-01', 'monthly', 1700, 8, 0, 0, 0, 1)
  `).run()
  // Plain monthly (default attendance_required=0), for the exclusion regression pin.
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined, shift_id)
    VALUES (3, 'EMP003', 'Fixed Worker', '900101-01-0003', 1, 'active', '2020-01-01', 100)
  `).run()
  db.prepare(`
    INSERT INTO salary_structures
      (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
       subject_to_epf, subject_to_socso, subject_to_eis)
    VALUES (2, 3, '2020-01-01', 'monthly', 1700, 8, 0, 0, 0)
  `).run()
  db.prepare(`
    INSERT INTO payroll_periods (id, name, start_date, end_date, status)
    VALUES (1, 'Week', '2026-08-03', '2026-08-09', 'open')
  `).run()
  return db
}

function punch(db: Database.Database, employeeId: number, date: string, inH: string, outH: string): void {
  db.prepare(`INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
    VALUES (?, 'in', ?, 'manual', datetime('now'), datetime('now'))`).run(employeeId, `${date}T${inH}:00`)
  db.prepare(`INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
    VALUES (?, 'out', ?, 'manual', datetime('now'), datetime('now'))`).run(employeeId, `${date}T${outH}:00`)
}

/** EA 1955 Second Schedule: (12 x monthly wage) / (52 x working days/week) / standard hours. */
function expectedHourlyRate(monthlyWage: number, workingDaysPerWeek: number, standardHours: number): number {
  return (12 * monthlyWage) / (52 * workingDaysPerWeek) / standardHours
}

describe('monthly + attendance_required — integration', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb() })

  it('triggerProcessing INCLUDES a gated monthly employee but still EXCLUDES a plain one', () => {
    // Mon-Fri worked for the gated employee; the plain-monthly employee never punches
    // at all (their pay doesn't depend on it).
    for (const date of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']) {
      punch(db, 2, date, '09:00', '18:00')
    }
    triggerProcessing(db, 1)

    const gatedRows = db.prepare(
      `SELECT COUNT(*) AS n FROM daily_attendance_records WHERE employee_id = 2`,
    ).get() as { n: number }
    const plainRows = db.prepare(
      `SELECT COUNT(*) AS n FROM daily_attendance_records WHERE employee_id = 3`,
    ).get() as { n: number }

    expect(gatedRows.n).toBeGreaterThan(0)
    expect(plainRows.n).toBe(0)
  })

  it('pays the full basic when every required day is worked exactly', () => {
    for (const date of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']) {
      punch(db, 2, date, '09:00', '18:00') // 09:00-18:00, 1h break -> 8h clocked-worth
    }
    triggerProcessing(db, 1)
    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1 })
    calculatePayrollRun(db, run.id)

    const item = getPayrollRunItems(db, run.id).find((i) => i.employee_id === 2)!
    expect(item.basic_salary_snapshot).toBe(1700)
    expect(item.attendance_shortfall_hours).toBe(0)
    expect(item.attendance_shortfall_amount).toBe(0)
    expect(item.gross_regular_pay).toBe(1700)
  })

  it('deducts pro-rata for a full-day absence — same formula as a partial shortfall', () => {
    // Worked Mon-Thu, absent Friday (no punch, no leave record).
    for (const date of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']) {
      punch(db, 2, date, '09:00', '18:00')
    }
    triggerProcessing(db, 1)
    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1 })
    calculatePayrollRun(db, run.id)

    const item = getPayrollRunItems(db, run.id).find((i) => i.employee_id === 2)!
    const rate = expectedHourlyRate(1700, 5, 8) // default company calendar: Mon-Fri
    expect(item.attendance_shortfall_hours).toBe(8)
    expect(item.attendance_shortfall_amount).toBeCloseTo(8 * rate, 2)
    expect(item.gross_regular_pay).toBeCloseTo(1700 - 8 * rate, 2)
    expect(item.basic_salary_snapshot).toBe(1700) // full contracted amount always shown
  })

  it('a plain monthly employee (attendance_required=0) is paid in full regardless — unaffected by this feature', () => {
    // Employee 3 never punches at all across the whole period.
    triggerProcessing(db, 1)
    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1 })
    calculatePayrollRun(db, run.id)

    const item = getPayrollRunItems(db, run.id).find((i) => i.employee_id === 3)!
    expect(item.gross_regular_pay).toBe(1700)
    expect(item.attendance_shortfall_amount).toBe(0)
    expect(item.basic_salary_snapshot).toBe(0) // only populated for the gated branch
  })

  it('derives a different hourly rate (and shortfall amount) for a six-day-week employee', () => {
    // Override employee 2's calendar to a six-day week (Mon-Sat working).
    db.prepare(`
      INSERT INTO employee_calendar_profiles
        (employee_id, monday_is_working, tuesday_is_working, wednesday_is_working,
         thursday_is_working, friday_is_working, saturday_is_working, sunday_is_working,
         effective_from)
      VALUES (2, 1, 1, 1, 1, 1, 1, 0, '2020-01-01')
    `).run()

    for (const date of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']) {
      punch(db, 2, date, '09:00', '18:00')
    }
    // Saturday (08-08) absent — a working day only under the six-day override, so
    // this is the sole shortfall day (8h).
    triggerProcessing(db, 1)
    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1 })
    calculatePayrollRun(db, run.id)

    const item = getPayrollRunItems(db, run.id).find((i) => i.employee_id === 2)!
    const sixDayRate = expectedHourlyRate(1700, 6, 8)
    const fiveDayRate = expectedHourlyRate(1700, 5, 8)
    expect(sixDayRate).not.toBeCloseTo(fiveDayRate, 2)
    expect(item.attendance_shortfall_amount).toBeCloseTo(8 * sixDayRate, 2)
  })

  it('pays OT on top of the basic when the employee clocks beyond the shift threshold', () => {
    for (const date of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']) {
      punch(db, 2, date, '09:00', '18:00')
    }
    punch(db, 2, '2026-08-07', '09:00', '20:00') // 10h clocked - 1h break = 9h -> 1h OT
    triggerProcessing(db, 1)
    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1 })
    calculatePayrollRun(db, run.id)

    const item = getPayrollRunItems(db, run.id).find((i) => i.employee_id === 2)!
    expect(item.gross_ot_pay).toBeGreaterThan(0)
    expect(item.gross_regular_pay).toBe(1700) // basic unaffected by earning OT
    expect(item.gross_pay).toBeCloseTo(1700 + item.gross_ot_pay, 2)
  })
})
