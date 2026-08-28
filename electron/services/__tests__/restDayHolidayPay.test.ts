// Regression for the 2026-08-27 OT review. Three separate money bugs, all confirmed
// by repro before the fix:
//
//   1. Work performed on a rest day (weekly_off) or a public/company holiday was
//      recorded (total_clocked_hours was correct) but credited ZERO paid hours — the
//      employee was paid RM0 for a full day's work.
//   2. payrollRun's working-day count hardcoded Mon-Fri, ignoring the configurable
//      Company Calendar, so a six-day-week company had every daily-rate employee's
//      paid days capped at the Mon-Fri count.
//   3. That same count excluded holidays by reading `public_holidays` — a table
//      nothing in the app writes to and which holds no dates past 2025 — instead of
//      `calendar_events`, which is what the Calendar module actually manages.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { triggerProcessing, getDailyRecordsByPeriod, getAttendanceSummaryForDateRange } from '../attendanceProcessor'
import { createPayrollRun, calculatePayrollRun, getPayrollRunItems } from '../payroll/payrollRun'

const migrationsDir = path.resolve(process.cwd(), 'electron/db/migrations')

/** 2026-08-15 is a Saturday, 08-16 a Sunday — both weekly_off under the default profile. */
function makeDb(startDate: string, endDate: string): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrationsDir)
  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO shifts (id, name, start_time, end_time, standard_hours, break_minutes)
    VALUES (100, 'Test Shift', '09:00', '18:00', 8, 60)
  `).run()
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined, shift_id)
    VALUES (2, 'EMP002', 'Worker', '900101-01-1234', 1, 'active', '2020-01-01', 100)
  `).run()
  db.prepare(`
    INSERT INTO payroll_periods (id, name, start_date, end_date, status)
    VALUES (1, 'P', ?, ?, 'open')
  `).run(startDate, endDate)
  return db
}

function log(db: Database.Database, type: 'in' | 'out', timestamp: string): void {
  db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
    VALUES (2, ?, ?, 'manual', datetime('now'), datetime('now'))
  `).run(type, timestamp)
}

function seedHourlyStructure(db: Database.Database, hourlyRate = 10): void {
  db.prepare(`
    INSERT INTO salary_structures
      (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
       subject_to_epf, subject_to_socso, subject_to_eis)
    VALUES (1, 2, '2020-01-01', 'hourly', ?, 8, 0, 0, 0)
  `).run(hourlyRate)
}

describe('rest day work is paid (EA 1955 s.60(3))', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb('2026-08-14', '2026-08-17') })

  it('credits a FULL day when more than half the normal hours are worked', () => {
    // Sunday 2026-08-16, 09:00-18:00 = 9 hours, single session (no lunch punch).
    // Auto-deduct (2026-08-27) assumes the shift's 60-min break is inside that span:
    // 9h - 1h = 8h pay-hours, exactly the normal day (no rest-day OT).
    log(db, 'in', '2026-08-16T09:00:00')
    log(db, 'out', '2026-08-16T18:00:00')

    triggerProcessing(db, 1, [2])
    const rec = getDailyRecordsByPeriod(db, 1, 2).find((r) => r.date === '2026-08-16')!

    expect(rec.calendar_type).toBe('weekly_off')
    expect(rec.total_clocked_hours).toBe(9) // raw clock span, unadjusted
    expect(rec.rest_day_hours).toBe(8)
    expect(rec.rest_day_ot_hours).toBe(0)
    // Must NOT leak into the ordinary buckets — those are paid at the ordinary rate.
    expect(rec.regular_hours).toBe(0)
    expect(rec.ot_hours).toBe(0)
  })

  it('credits only HALF a day when at most half the normal hours are worked', () => {
    // 3 hours on the Sunday — below the 4h half-day threshold.
    log(db, 'in', '2026-08-16T09:00:00')
    log(db, 'out', '2026-08-16T12:00:00')

    triggerProcessing(db, 1, [2])
    const rec = getDailyRecordsByPeriod(db, 1, 2).find((r) => r.date === '2026-08-16')!

    expect(rec.rest_day_hours).toBe(4) // half of the 8h standard day
    expect(rec.rest_day_ot_hours).toBe(0)
  })

  it('leaves an unworked rest day at zero', () => {
    triggerProcessing(db, 1, [2])
    const rec = getDailyRecordsByPeriod(db, 1, 2).find((r) => r.date === '2026-08-16')!

    expect(rec.rest_day_hours).toBe(0)
    expect(rec.rest_day_ot_hours).toBe(0)
  })

  it('pays rest-day work through to the payroll run', () => {
    seedHourlyStructure(db, 10)
    log(db, 'in', '2026-08-16T09:00:00')
    log(db, 'out', '2026-08-16T18:00:00')

    triggerProcessing(db, 1, [2])
    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    // 8h x RM10 x 1.0 (rest day), no rest-day OT after auto-deduct removes the
    // unpunched break = RM80.
    expect(item.rest_day_pay).toBe(80)
    expect(item.gross_pay).toBe(80) // no ordinary hours worked this period
    expect(item.gross_pay).toBeGreaterThan(0) // the bug paid RM0
  })
})

describe('public holiday work is paid (EA 1955 s.60D(3))', () => {
  it('credits the full normal day plus holiday overtime, and pays it', () => {
    // 2026-08-31 (Merdeka) is seeded as a public_holiday calendar event by 0013.
    const db = makeDb('2026-08-30', '2026-09-01')
    seedHourlyStructure(db, 10)
    log(db, 'in', '2026-08-31T09:00:00')
    log(db, 'out', '2026-08-31T18:00:00')

    triggerProcessing(db, 1, [2])
    const rec = getDailyRecordsByPeriod(db, 1, 2).find((r) => r.date === '2026-08-31')!

    expect(rec.calendar_type).toBe('public_holiday')
    expect(rec.holiday_hours).toBe(8)
    expect(rec.holiday_ot_hours).toBe(0) // 9h clocked - 1h auto-deducted break = 8h, no OT
    expect(rec.regular_hours).toBe(0)

    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    // 8h x RM10 x 2.0 (holiday), no holiday OT = RM160
    expect(item.holiday_pay).toBe(160)
    expect(item.gross_pay).toBe(160)
  })

  it('has no half-day tier — any work earns the full holiday premium', () => {
    const db = makeDb('2026-08-30', '2026-09-01')
    log(db, 'in', '2026-08-31T09:00:00')
    log(db, 'out', '2026-08-31T11:00:00') // only 2 hours

    triggerProcessing(db, 1, [2])
    const rec = getDailyRecordsByPeriod(db, 1, 2).find((r) => r.date === '2026-08-31')!

    expect(rec.holiday_hours).toBe(8)
    expect(rec.holiday_ot_hours).toBe(0)
  })
})

describe('EPF base excludes premium overtime but includes ordinary premium hours', () => {
  it('splits rest-day pay correctly for EPF', () => {
    const db = makeDb('2026-08-14', '2026-08-17')
    db.prepare(`
      INSERT INTO salary_structures
        (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
         subject_to_epf, subject_to_socso, subject_to_eis)
      VALUES (1, 2, '2020-01-01', 'hourly', 10, 8, 1, 0, 0)
    `).run()
    db.prepare(`
      INSERT INTO epf_rates (effective_from, employee_category, wage_from, wage_to,
                             employee_contribution_pct, employer_contribution_pct)
      VALUES ('2020-01-01', 'all', 0, NULL, 11, 13)
    `).run()
    db.prepare(`
      INSERT INTO pcb_brackets (effective_from, category, children_count,
                                chargeable_income_from, chargeable_income_to, tax_amount)
      VALUES ('2020-01-01', 'single', 0, 0, 100000, 0)
    `).run()

    log(db, 'in', '2026-08-16T09:00:00')
    log(db, 'out', '2026-08-16T18:00:00')

    triggerProcessing(db, 1, [2])
    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    // Auto-deduct removes the unpunched break, leaving no rest-day OT — rest_day_pay
    // is the ordinary portion only (8h x 10 x 1.0 = 80). KWSP banding: 80 -> band 80,
    // 80 x 11% = 8.80 -> ceil -> RM9.
    expect(item.rest_day_pay).toBe(80)
    expect(item.epf_employee).toBe(9)
  })
})

describe('working-day count follows the Company Calendar, not a hardcoded Mon-Fri', () => {
  it('pays a daily-rate employee for all six days of a six-day week', () => {
    const db = makeDb('2026-08-01', '2026-08-31')
    db.prepare(`UPDATE company_calendar_profiles SET saturday_is_working = 1 WHERE id = 1`).run()
    db.prepare(`
      INSERT INTO salary_structures
        (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
         subject_to_epf, subject_to_socso, subject_to_eis)
      VALUES (1, 2, '2020-01-01', 'daily', 80, 8, 0, 0, 0)
    `).run()

    // Work Mon-Sat every week; skip Sundays. 2026-08-31 (Merdeka) is a public holiday
    // and is deliberately NOT worked here so this test isolates the working-day count.
    let workedDays = 0
    for (let d = 1; d <= 30; d++) {
      const date = `2026-08-${String(d).padStart(2, '0')}`
      if (new Date(`${date}T00:00:00`).getDay() === 0) continue
      workedDays++
      log(db, 'in', `${date}T09:00:00`)
      log(db, 'out', `${date}T17:00:00`)
    }

    triggerProcessing(db, 1, [2])
    const summary = getAttendanceSummaryForDateRange(db, {
      employeeIds: [2], startDate: '2026-08-01', endDate: '2026-08-31',
    })[0]
    expect(summary.days_worked).toBe(workedDays)

    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    // Every worked day is paid. The bug capped this at the Mon-Fri count (21 days,
    // RM1,680) and silently dropped the Saturdays.
    expect(item.gross_regular_pay).toBe(workedDays * 80)
    expect(item.gross_regular_pay).toBeGreaterThan(21 * 80)
  })

  it('excludes a Calendar-module public holiday from the working-day count', () => {
    // The old code read `public_holidays`, which has no 2026 dates and which nothing
    // writes to — so a holiday entered through the Calendar UI had no effect at all.
    const db = makeDb('2026-08-01', '2026-08-31')
    db.prepare(`
      INSERT INTO salary_structures
        (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
         subject_to_epf, subject_to_socso, subject_to_eis)
      VALUES (1, 2, '2020-01-01', 'daily', 80, 8, 0, 0, 0)
    `).run()

    // Work every weekday including Merdeka (a seeded public_holiday calendar event).
    for (let d = 1; d <= 31; d++) {
      const date = `2026-08-${String(d).padStart(2, '0')}`
      const dow = new Date(`${date}T00:00:00`).getDay()
      if (dow === 0 || dow === 6) continue
      log(db, 'in', `${date}T09:00:00`)
      log(db, 'out', `${date}T17:00:00`)
    }

    triggerProcessing(db, 1, [2])
    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    // 21 weekdays in Aug 2026, one of which (the 31st) is Merdeka. Merdeka is paid as
    // holiday work, not as an ordinary day, so ordinary pay covers 20 days.
    expect(item.gross_regular_pay).toBe(20 * 80)
    expect(item.holiday_pay).toBeGreaterThan(0)
  })
})
