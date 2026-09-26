// Regression for the 2026-09-26 fix: an UNWORKED public/company holiday paid RM0
// instead of a normal day's pay. Reported by a client — Malaysia Day (16 Sep) was
// correctly marked on the calendar, the Attendance Summary showed the day as "Leave"
// (expected — the Summary groups holiday/weekly_off/on_leave under one badge), but
// unlike an approved annual/sick leave day, regular_hours stayed at 0 instead of the
// full 8h. EA 1955 s.60D(1): a gazetted (or company) holiday is a PAID day off,
// same as paid annual/sick leave — see attendanceProcessor.ts Stage 10.
//
// A WORKED holiday was already correct (paid via the holiday-premium bucket,
// restDayHolidayPay.test.ts) — this file covers only the unworked case, plus that
// the two don't double-count each other in the daily-rate day cap.
//
// Periods below run 2026-09-01 to 2026-09-20 rather than the whole month, deliberately
// stopping short of 2026-09-25 (Maulidur Rasul, also seeded by 0013) — a second
// holiday in range would earn its own paid day and muddy each test's expected numbers
// for no reason; the isolated 16 Sep case is what was actually reported.
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { triggerProcessing, getDailyRecordsByPeriod, getAttendanceSummaryForDateRange } from '../attendanceProcessor'
import { createPayrollRun, calculatePayrollRun, getPayrollRunItems } from '../payroll/payrollRun'

const migrationsDir = path.resolve(process.cwd(), 'electron/db/migrations')

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

function log(db: Database.Database, type: 'in' | 'out', timestamp: string) {
  db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source)
    VALUES (2, ?, ?, 'manual')
  `).run(type, timestamp)
}

describe('unworked public/company holiday is paid a normal day (EA 1955 s.60D(1))', () => {
  it('credits a daily-rate employee a full day for Malaysia Day (16 Sep), not worked', () => {
    // 16 Sep 2026 is a Wednesday and is seeded as a public_holiday calendar event by 0013.
    const db = makeDb('2026-09-01', '2026-09-20')
    db.prepare(`
      INSERT INTO salary_structures
        (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
         subject_to_epf, subject_to_socso, subject_to_eis)
      VALUES (1, 2, '2020-01-01', 'daily', 80, 8, 0, 0, 0)
    `).run()

    // Work every weekday in range except Malaysia Day itself — deliberately not worked.
    let workedDays = 0
    for (let d = 1; d <= 20; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`
      if (date === '2026-09-16') continue
      const dow = new Date(`${date}T00:00:00`).getDay()
      if (dow === 0 || dow === 6) continue
      workedDays++
      log(db, 'in', `${date}T09:00:00`)
      log(db, 'out', `${date}T18:00:00`)
    }

    triggerProcessing(db, 1, [2])

    const rec = getDailyRecordsByPeriod(db, 1).find((r) => r.date === '2026-09-16')!
    expect(rec.calendar_type).toBe('public_holiday')
    expect(rec.attendance_status).toBe('holiday')
    expect(rec.regular_hours).toBe(8) // paid, not worked — same treatment as annual/sick leave
    expect(rec.holiday_hours).toBe(0) // NOT the worked-holiday premium bucket — no work was done
    expect(rec.total_clocked_hours).toBe(0) // the raw "what literally happened" column stays 0

    const summary = getAttendanceSummaryForDateRange(db, {
      employeeIds: [2], startDate: '2026-09-01', endDate: '2026-09-20',
    })[0]
    expect(summary.days_worked).toBe(workedDays + 1) // + the paid, unworked holiday
    expect(summary.total_regular_hours).toBe((workedDays + 1) * 8)

    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-09-26' })
    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    // The bug this fixes: this used to be workedDays * 80, silently dropping Malaysia Day.
    expect(item.gross_regular_pay).toBe((workedDays + 1) * 80)
    expect(item.holiday_pay).toBe(0) // no work was done on the holiday, so no premium bucket either
  })

  it('credits an hourly-rate employee the shift threshold in hours worked, unaffected by any day cap', () => {
    const db = makeDb('2026-09-01', '2026-09-20')
    db.prepare(`
      INSERT INTO salary_structures
        (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
         subject_to_epf, subject_to_socso, subject_to_eis)
      VALUES (1, 2, '2020-01-01', 'hourly', 10, 8, 0, 0, 0)
    `).run()

    log(db, 'in', '2026-09-15T09:00:00')
    log(db, 'out', '2026-09-15T18:00:00')
    // 2026-09-16 (Malaysia Day): no punches at all.

    triggerProcessing(db, 1, [2])
    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-09-26' })
    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    // Auto-deduct removes the unpunched lunch break from the 15th (9h - 1h = 8h), plus
    // 8h paid-but-unworked for the 16th = 16h total x RM10 = RM160.
    expect(item.gross_regular_pay).toBe(160)
  })

  it('pays an unworked COMPANY holiday the same way as a public holiday', () => {
    const db = makeDb('2026-09-01', '2026-09-20')
    db.prepare(`
      INSERT INTO calendar_events (event_type, name, event_date, is_recurring)
      VALUES ('company_holiday', 'Company Anniversary', '2026-09-10', 0)
    `).run()
    db.prepare(`
      INSERT INTO salary_structures
        (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
         subject_to_epf, subject_to_socso, subject_to_eis)
      VALUES (1, 2, '2020-01-01', 'hourly', 10, 8, 0, 0, 0)
    `).run()
    // No punches at all in the period — isolates the single company-holiday day.

    triggerProcessing(db, 1, [2])
    const rec = getDailyRecordsByPeriod(db, 1).find((r) => r.date === '2026-09-10')!
    expect(rec.calendar_type).toBe('company_holiday')
    expect(rec.attendance_status).toBe('holiday')
    expect(rec.regular_hours).toBe(8)
  })

  it('does not double-pay a WORKED holiday through both the premium bucket and the day count', () => {
    // Same Malaysia Day, but this time actually worked. Confirms the fix above didn't
    // regress the pre-existing worked-holiday behavior (restDayHolidayPay.test.ts).
    const db = makeDb('2026-09-16', '2026-09-17')
    db.prepare(`
      INSERT INTO salary_structures
        (id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
         subject_to_epf, subject_to_socso, subject_to_eis)
      VALUES (1, 2, '2020-01-01', 'daily', 80, 8, 0, 0, 0)
    `).run()
    log(db, 'in', '2026-09-16T09:00:00')
    log(db, 'out', '2026-09-16T18:00:00')

    triggerProcessing(db, 1, [2])
    const rec = getDailyRecordsByPeriod(db, 1).find((r) => r.date === '2026-09-16')!
    expect(rec.regular_hours).toBe(0) // NOT credited as an ordinary paid day
    expect(rec.holiday_hours).toBe(8) // paid once, via the worked-holiday premium bucket

    const summary = getAttendanceSummaryForDateRange(db, {
      employeeIds: [2], startDate: '2026-09-16', endDate: '2026-09-17',
    })[0]
    // 9/17 is an ordinary working day with no punch — 'absent', contributes nothing here.
    expect(summary.days_worked).toBe(0) // not counted as an ordinary paid day either

    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-09-26' })
    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]
    expect(item.gross_regular_pay).toBe(0) // only holiday_pay carries this day's pay
    expect(item.holiday_pay).toBeGreaterThan(0)
  })
})
