// Coverage for the OT report (electron/services/otReport.ts), built 2026-08-27 so the
// client can audit "which day, and how much" instead of only seeing a monthly total.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { triggerProcessing } from '../attendanceProcessor'
import { createPayrollRun, calculatePayrollRun } from '../payroll/payrollRun'
import { getOtReport } from '../otReport'

const migrationsDir = path.resolve(process.cwd(), 'electron/db/migrations')

/** Shift 09:00-18:00. standardHours is the knob this suite exercises. */
function makeDb(standardHours: number): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrationsDir)
  db.prepare(`INSERT INTO departments (id,name) VALUES (1,'Ops')`).run()
  db.prepare(`
    INSERT INTO shifts (id,name,start_time,end_time,standard_hours,break_minutes)
    VALUES (100,'Morning 9-6','09:00','18:00',?,60)
  `).run(standardHours)
  db.prepare(`
    INSERT INTO employees (id,employee_code,name,ic_number,department_id,status,date_joined,shift_id)
    VALUES (2,'E2','Ali','900101-01-0002',1,'active','2020-01-01',100)
  `).run()
  db.prepare(`
    INSERT INTO employees (id,employee_code,name,ic_number,department_id,status,date_joined,shift_id)
    VALUES (3,'E3','Siti','900101-01-0003',1,'active','2020-01-01',100)
  `).run()
  // 2026-08-10 Mon .. 2026-08-12 Wed — all ordinary working days.
  db.prepare(`
    INSERT INTO payroll_periods (id,name,start_date,end_date,status)
    VALUES (1,'Aug W2','2026-08-10','2026-08-12','open')
  `).run()
  return db
}

function log(db: Database.Database, employeeId: number, type: 'in' | 'out', ts: string): void {
  db.prepare(`
    INSERT INTO attendance_logs (employee_id,type,timestamp,source,created_at,updated_at)
    VALUES (?,?,?,'manual',datetime('now'),datetime('now'))
  `).run(employeeId, type, ts)
}

/** One continuous 09:00-18:00 punch (9 clocked hours). */
function fullDay(db: Database.Database, employeeId: number, date: string): void {
  log(db, employeeId, 'in', `${date}T09:00:00`)
  log(db, employeeId, 'out', `${date}T18:00:00`)
}

describe('getOtReport', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb(8) })

  it('reports per-employee totals with a per-day breakdown, biggest OT first', () => {
    // Ali: 09:00-19:00 = 10h clocked, single session, no lunch punch. Auto-deduct
    // (2026-08-27) assumes the shift's 60-min break is inside that span: 10h - 1h =
    // 9h pay-hours vs 8h standard = 1h real OT (not 2h — the unpunched break is
    // excluded first, same as the "OT too expensive" fix).
    log(db, 2, 'in', '2026-08-10T09:00:00')
    log(db, 2, 'out', '2026-08-10T19:00:00')
    // Siti: 09:00-20:00 = 11h clocked -> 10h pay-hours -> 2h OT.
    log(db, 3, 'in', '2026-08-11T09:00:00')
    log(db, 3, 'out', '2026-08-11T20:00:00')

    triggerProcessing(db, 1)
    const report = getOtReport(db, 1)

    expect(report.period_name).toBe('Aug W2')
    expect(report.start_date).toBe('2026-08-10')
    expect(report.end_date).toBe('2026-08-12')

    // Sorted by total OT descending — Siti (2h) before Ali (1h).
    expect(report.rows.map((r) => r.employee_name)).toEqual(['Siti', 'Ali'])

    const ali = report.rows.find((r) => r.employee_name === 'Ali')!
    expect(ali.days_with_ot).toBe(1)
    expect(ali.total_ot_hours).toBe(1)
    expect(ali.days).toHaveLength(1)
    expect(ali.days[0].date).toBe('2026-08-10')
    expect(ali.days[0].total_clocked_hours).toBe(10) // raw clock span, unadjusted
    expect(ali.days[0].standard_hours).toBe(8)
    expect(ali.days[0].first_in).toContain('09:00')
    expect(ali.days[0].last_out).toContain('19:00')

    expect(report.grand_total_ot_hours).toBe(3) // 1 + 2
  })

  it('lists employees with zero OT but gives them no day rows', () => {
    // Ali works exactly a normal day on all three dates -> no OT at all.
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12']) {
      log(db, 2, 'in', `${d}T09:00:00`)
      log(db, 2, 'out', `${d}T17:00:00`) // 8h clocked = standard
    }

    triggerProcessing(db, 1, [2])
    const report = getOtReport(db, 1)

    const ali = report.rows.find((r) => r.employee_name === 'Ali')!
    expect(ali.total_ot_hours).toBe(0)
    expect(ali.days_with_ot).toBe(0)
    expect(ali.days).toEqual([])
    expect(report.grand_total_ot_hours).toBe(0)
  })

  it('surfaces phantom OT from a too-low Standard Hours, even after auto-deduct removes the break-related part', () => {
    // The real incident: shift standard_hours = 7 against a 9-6 shift where the break
    // is never punched. Auto-deduct (2026-08-27) now removes the 1h that was really
    // just the unpunched lunch break (9h clocked - 1h assumed break = 8h pay-hours),
    // but the shift is STILL misconfigured at 7h instead of the correct 8h, so 1h/day
    // of genuine phantom OT remains — auto-deduct fixes the break-omission bug, not a
    // wrong Standard Hours setting, and this report should still surface that.
    const db7 = makeDb(7)
    fullDay(db7, 2, '2026-08-10')
    fullDay(db7, 2, '2026-08-11')

    triggerProcessing(db7, 1, [2])
    const report = getOtReport(db7, 1)
    const ali = report.rows.find((r) => r.employee_name === 'Ali')!

    expect(ali.days_with_ot).toBe(2)
    expect(ali.total_ot_hours).toBe(2) // 1h/day of overtime nobody worked
    // Every flagged day clocked only a normal shift span — this pair (clocked vs
    // standard) is what the UI highlights so the cause is visible, not guessed.
    for (const day of ali.days) {
      expect(day.total_clocked_hours).toBe(9)
      expect(day.standard_hours).toBe(7)
    }
  })

  it('reports OT pay as null before a payroll run, and the snapshot after', () => {
    db.prepare(`
      INSERT INTO salary_structures
        (id,employee_id,effective_from,rate_type,rate_amount,standard_hours_per_day,
         subject_to_epf,subject_to_socso,subject_to_eis)
      VALUES (1,2,'2020-01-01','hourly',10,8,0,0,0)
    `).run()
    log(db, 2, 'in', '2026-08-10T09:00:00')
    log(db, 2, 'out', '2026-08-10T19:00:00') // 10h clocked - 1h auto-deducted break = 1h OT

    triggerProcessing(db, 1, [2])

    const before = getOtReport(db, 1)
    expect(before.rows.find((r) => r.employee_name === 'Ali')!.ot_pay).toBeNull()
    expect(before.grand_total_ot_pay).toBeNull()

    db.prepare(`UPDATE payroll_periods SET status='processing' WHERE id=1`).run()
    const run = createPayrollRun(db, { payroll_period_id: 1 })
    calculatePayrollRun(db, run.id)

    const after = getOtReport(db, 1)
    // Default OT rule for a fresh DB is multiplier 1.5 -> 1h x RM10 x 1.5 = RM15.
    expect(after.rows.find((r) => r.employee_name === 'Ali')!.ot_pay).toBe(15)
    expect(after.grand_total_ot_pay).toBe(15)
  })

  it('separates rest-day and holiday OT from normal-day OT', () => {
    // 2026-08-16 is a Sunday (weekly_off under the default calendar).
    const dbWeekend = makeDb(8)
    dbWeekend.prepare(`UPDATE payroll_periods SET start_date='2026-08-14', end_date='2026-08-17' WHERE id=1`).run()
    log(dbWeekend, 2, 'in', '2026-08-16T09:00:00')
    log(dbWeekend, 2, 'out', '2026-08-16T19:00:00') // 10h clocked - 1h auto-deducted break = 1h rest-day OT

    triggerProcessing(dbWeekend, 1, [2])
    const report = getOtReport(dbWeekend, 1)
    const ali = report.rows.find((r) => r.employee_name === 'Ali')!

    expect(ali.total_ot_hours).toBe(0) // not normal-day OT
    expect(ali.total_rest_day_ot_hours).toBe(1)
    expect(ali.days[0].calendar_type).toBe('weekly_off')
    expect(report.grand_total_ot_hours).toBe(1)
  })

  it('throws for an unknown payroll period rather than returning an empty report', () => {
    expect(() => getOtReport(db, 999)).toThrow(/Payroll period 999 not found/)
  })
})
