// Coverage for the payroll-period attendance summary (getPeriodCalendar), added
// 2026-08-27.
//
// The point of this view is RECONCILIATION: the client compared the month-based
// Monthly Summary against a payroll run, the numbers disagreed (different date range,
// and the summary showed raw clocked hours while payroll pays on regular hours), and
// correct payroll figures looked inflated. The load-bearing test here is the one that
// asserts the summary's totals equal the payroll run's totals for the same period.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { triggerProcessing } from '../attendanceProcessor'
import { getPeriodCalendar, getMonthlyCalendar } from '../attendance'
import { createPayrollRun, calculatePayrollRun, getPayrollRunItems } from '../payroll/payrollRun'

const migrationsDir = path.resolve(process.cwd(), 'electron/db/migrations')

/** Period 26 Jul – 25 Aug 2026: the cross-month range that started all of this. */
function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrationsDir)
  db.prepare(`INSERT INTO departments (id,name) VALUES (1,'Ops')`).run()
  db.prepare(`
    INSERT INTO shifts (id,name,start_time,end_time,standard_hours,break_minutes)
    VALUES (100,'Period Test Shift','09:00','18:00',8,60)
  `).run()
  db.prepare(`
    INSERT INTO employees (id,employee_code,name,ic_number,department_id,status,date_joined,shift_id)
    VALUES (2,'E2','Ali','900101-01-0002',1,'active','2020-01-01',100)
  `).run()
  db.prepare(`
    INSERT INTO salary_structures
      (id,employee_id,effective_from,rate_type,rate_amount,standard_hours_per_day,
       subject_to_epf,subject_to_socso,subject_to_eis)
    VALUES (1,2,'2020-01-01','hourly',10,8,0,0,0)
  `).run()
  db.prepare(`
    INSERT INTO payroll_periods (id,name,start_date,end_date,status)
    VALUES (1,'26 Jul - 25 Aug','2026-07-26','2026-08-25','open')
  `).run()
  return db
}

function punch(db: Database.Database, date: string, inH: string, outH: string): void {
  db.prepare(`INSERT INTO attendance_logs (employee_id,type,timestamp,source,created_at,updated_at)
    VALUES (2,'in',?, 'manual',datetime('now'),datetime('now'))`).run(`${date}T${inH}:00`)
  db.prepare(`INSERT INTO attendance_logs (employee_id,type,timestamp,source,created_at,updated_at)
    VALUES (2,'out',?, 'manual',datetime('now'),datetime('now'))`).run(`${date}T${outH}:00`)
}

/** Every weekday in the period, 09:00-17:00 (exactly the 8h standard, so no OT). */
function workEveryWeekday(db: Database.Database): string[] {
  const worked: string[] = []
  const cursor = new Date('2026-07-26T00:00:00')
  const end = new Date('2026-08-25T00:00:00')
  while (cursor <= end) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    const d = String(cursor.getDate()).padStart(2, '0')
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6) {
      const date = `${y}-${m}-${d}`
      punch(db, date, '09:00', '17:00')
      worked.push(date)
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return worked
}

describe('getPeriodCalendar', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb() })

  it('covers the period\'s real range, including the days in the earlier month', () => {
    workEveryWeekday(db)
    triggerProcessing(db, 1, [2])

    const cal = getPeriodCalendar(db, 2, 1)

    expect(cal.period_name).toBe('26 Jul - 25 Aug')
    expect(cal.start_date).toBe('2026-07-26')
    expect(cal.end_date).toBe('2026-08-25')
    expect(cal.days[0].date).toBe('2026-07-26')
    expect(cal.days[cal.days.length - 1].date).toBe('2026-08-25')

    // The July days are present — the month view could never show them alongside August.
    expect(cal.days.some((d) => d.date.startsWith('2026-07'))).toBe(true)
    expect(cal.days.some((d) => d.date.startsWith('2026-08'))).toBe(true)
  })

  it('totals match the payroll run for the same period — the reconciliation guarantee', () => {
    workEveryWeekday(db)
    // A worked rest day (Sunday) is deliberately included: premium hours live in their
    // own buckets in payroll, and folding them into regular_hours here made this screen
    // over-report against the payroll run (the bug this case exists to catch).
    punch(db, '2026-08-16', '09:00', '18:00')
    triggerProcessing(db, 1, [2])

    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1 })
    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    const cal = getPeriodCalendar(db, 2, 1)

    expect(cal.total_regular_hours).toBe(item.total_regular_hours)
    expect(cal.total_ot_hours).toBe(item.total_ot_hours)
    // And the rest-day hours are shown, just not counted as ordinary time.
    expect(cal.total_premium_hours).toBeGreaterThan(0)
  })

  it('reports clocked hours separately from the regular hours payroll pays on', () => {
    // 09:00-19:00 = 10h clocked, single session (no lunch punch), against an 8h
    // standard. Auto-deduct (2026-08-27) assumes the shift's 60-min break is inside
    // that span: 10h - 1h = 9h pay-hours -> 8 regular + 1 OT.
    punch(db, '2026-08-03', '09:00', '19:00')
    triggerProcessing(db, 1, [2])

    const cal = getPeriodCalendar(db, 2, 1)
    const day = cal.days.find((d) => d.date === '2026-08-03')!

    expect(day.hours_worked).toBe(10) // raw clocked
    expect(day.regular_hours).toBe(8) // what payroll pays as regular
    expect(day.ot_hours).toBe(1)
    // The clocked figure being larger than regular is exactly what looked like a
    // discrepancy before these fields existed.
    expect(cal.total_hours).toBe(10)
    expect(cal.total_regular_hours).toBe(8)
  })

  it('counts rest-day work, which pays but is not ordinary regular time', () => {
    // 2026-08-16 is a Sunday. 09:00-18:00 = 9h clocked, single session -> auto-deduct
    // assumes the 60-min break is inside it: 9h - 1h = 8h pay-hours, exactly the
    // normal day (no rest-day OT).
    punch(db, '2026-08-16', '09:00', '18:00')
    triggerProcessing(db, 1, [2])

    const cal = getPeriodCalendar(db, 2, 1)
    const day = cal.days.find((d) => d.date === '2026-08-16')!

    // Shown as leave-type (non-working day) and the paid hours are not lost — but they
    // are premium hours, NOT ordinary regular/OT time, because that is how payroll
    // stores and pays them.
    expect(day.premium_hours).toBe(8)
    expect(day.regular_hours).toBe(0)
    expect(day.ot_hours).toBe(0)
    expect(cal.total_premium_hours).toBe(8)
    expect(cal.total_regular_hours).toBe(0)
    expect(cal.total_ot_hours).toBe(0)
  })

  it('month view still works and is scoped to the calendar month', () => {
    workEveryWeekday(db)
    triggerProcessing(db, 1, [2])

    const aug = getMonthlyCalendar(db, 2, 2026, 8)
    expect(aug.period_name).toBeNull()
    expect(aug.start_date).toBe('2026-08-01')
    expect(aug.end_date).toBe('2026-08-31')
    expect(aug.days.every((d) => d.date.startsWith('2026-08'))).toBe(true)

    // And it is genuinely a smaller slice than the period — the original complaint.
    const period = getPeriodCalendar(db, 2, 1)
    expect(aug.total_regular_hours).toBeLessThan(period.total_regular_hours)
  })

  it('throws for an unknown payroll period', () => {
    expect(() => getPeriodCalendar(db, 2, 999)).toThrow(/Payroll period 999 not found/)
  })
})
