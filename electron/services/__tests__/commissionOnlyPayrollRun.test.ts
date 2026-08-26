// Integration coverage for the commission-only payroll + separate pay-schedule
// feature (docs/COMMISSION_PAYROLL_PLAN.md): a commission-only employee (RM12,690
// trip x 20% = RM2,538, EPF/SOCSO/EIS base RM1,700) must never be pulled into the
// normal attendance payroll run, and a dedicated commission-only run must exist
// for the same payroll month without colliding with it.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { createPayrollRun, calculatePayrollRun, getPayrollRunItems } from '../payroll/payrollRun'
import { upsertCommission } from '../payroll/commissions'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, path.resolve(process.cwd(), 'electron/db/migrations'))

  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined)
    VALUES
      (1, 'EMP001', 'Ali (attendance)', '900101-01-0001', 1, 'active', '2020-01-01'),
      (2, 'EMP002', 'Siti (commission)', '900101-01-0002', 1, 'active', '2020-01-01')
  `).run()

  // Employee 1: ordinary daily-rate attendance employee.
  db.prepare(`
    INSERT INTO salary_structures (employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day, subject_to_epf, subject_to_socso, subject_to_eis)
    VALUES (1, '2020-01-01', 'daily', 80, 8, 1, 1, 1)
  `).run()

  // Employee 2: commission-only, recurring default statutory base RM1,700.
  db.prepare(`
    INSERT INTO salary_structures (employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day, subject_to_epf, subject_to_socso, subject_to_eis)
    VALUES (2, '2020-01-01', 'commission_only', 1700, 8, 1, 0, 0)
  `).run()

  // EPF bracket covering both RM1,700 and RM2,538 so we can tell which base was used.
  db.prepare(`
    INSERT INTO epf_rates (effective_from, employee_category, wage_from, wage_to, employee_contribution_pct, employer_contribution_pct)
    VALUES ('2020-01-01', 'all', 0, 5000, 11, 13)
  `).run()

  return db
}

describe('commission-only payroll run + pay-group separation', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  it('allows an attendance run and a commission-only run for the same year/month', () => {
    const attendanceRun = createPayrollRun(db, { year: 2026, month: 8, pay_group: 'attendance', pay_date: '2026-08-26' })
    const commissionRun = createPayrollRun(db, { year: 2026, month: 8, pay_group: 'commission_only', pay_date: '2026-09-01' })

    expect(attendanceRun.id).not.toBe(commissionRun.id)
    expect(attendanceRun.pay_group).toBe('attendance')
    expect(commissionRun.pay_group).toBe('commission_only')
  })

  it('rejects a second run with the same year/month/pay_group', () => {
    createPayrollRun(db, { year: 2026, month: 8, pay_group: 'attendance', pay_date: '2026-08-26' })
    expect(() =>
      createPayrollRun(db, { year: 2026, month: 8, pay_group: 'attendance', pay_date: '2026-08-26' }),
    ).toThrow(/already exists/)
  })

  it('excludes the commission-only employee from the attendance run', () => {
    const run = createPayrollRun(db, { year: 2026, month: 8, pay_group: 'attendance', pay_date: '2026-08-26' })
    calculatePayrollRun(db, run.id)
    const items = getPayrollRunItems(db, run.id)

    expect(items.map((i) => i.employee_id)).toEqual([1])
  })

  it('excludes the attendance employee from the commission-only run, and computes gross/statutory base correctly', () => {
    const run = createPayrollRun(db, { year: 2026, month: 8, pay_group: 'commission_only', pay_date: '2026-09-01' })
    upsertCommission(db, run.id, { employee_id: 2, amount: 2538, note: 'Trip RM12,690 x 20%', statutory_base_override: null })

    calculatePayrollRun(db, run.id)
    const items = getPayrollRunItems(db, run.id)

    expect(items.map((i) => i.employee_id)).toEqual([2])
    const item = items[0]

    // Gross pay is the commission itself — RM1,700 must NOT be added (not RM4,238).
    expect(item.gross_pay).toBe(2538)
    // No override supplied → recurring default (salary_structures.rate_amount) is used.
    expect(item.statutory_base).toBe(1700)
    // EPF = 1700 * 11% = 187, NOT 2538 * 11% = 279.18.
    expect(item.epf_employee).toBe(187)
    // PCB uses the full gross wage (RM2,538) per the locked decision — seeded PCB
    // bracket for single/0 children/RM2,500–3,000 is RM15.
    expect(item.pcb).toBe(15)
    expect(item.net_pay).toBe(2538 - 187 - 15)
  })

  it('honors a per-run statutory base override over the recurring default', () => {
    const run = createPayrollRun(db, { year: 2026, month: 8, pay_group: 'commission_only', pay_date: '2026-09-01' })
    upsertCommission(db, run.id, { employee_id: 2, amount: 2538, note: null, statutory_base_override: 1800 })

    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    expect(item.statutory_base).toBe(1800)
    expect(item.epf_employee).toBe(198) // 1800 * 11%
    expect(item.gross_pay).toBe(2538) // gross pay is unaffected by the override
  })
})
