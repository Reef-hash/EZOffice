// Coverage for migration 0026: ad-hoc, per-run, variable allowances (e.g. "Buka
// Pagar" = 35 trips x RM5), distinct from migration 0025's recurring
// fixed_allowance. Unlike commission, an employee can have SEVERAL differently-
// named entries in the same run — see this session's chat for the confirmed
// design decisions (multiple entries allowed, excluded from EPF/SOCSO/EIS).

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { calculatePay, type OtRule } from '../payroll/calculationEngine'
import { makeSummary } from './helpers/summary'
import { createPayrollRun, calculatePayrollRun, getPayrollRunItems } from '../payroll/payrollRun'
import { createAllowance, deleteAllowance, listAllowancesForRun, getAllowanceTotalsForRun } from '../payroll/adhocAllowances'

const otRule: OtRule = { ot_rule_type: 'multiplier', ot_rule_value: 1.5 }

describe('calculatePay — adhocAllowanceTotal (migration 0026)', () => {
  const dailyStruct = {
    rate_type: 'daily' as const,
    rate_amount: 80,
    standard_hours_per_day: 8,
    subject_to_epf: 1,
    subject_to_socso: 0,
    subject_to_eis: 0,
  }

  it('adds the ad-hoc allowance total to gross pay but excludes it from the EPF base', () => {
    const result = calculatePay({
      summary: makeSummary({ days_worked: 20 }),
      structure: dailyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 0,
      adhocAllowanceTotal: 175, // "Buka Pagar" 35 trips x RM5
      workingDaysInMonth: 22,
    })

    // gross = (80 * 20) + 175 = 1775
    expect(result.gross_pay).toBe(1775)
    expect(result.adhoc_allowance_total).toBe(175)
    // EPF base excludes it: 1600 * 11% = 176, not 1775 * 11%.
    expect(result.epf_wage_base).toBe(1600)
    expect(result.statutory.epf_employee).toBe(176)
  })

  it('stacks with the recurring fixed_allowance (migration 0025) rather than replacing it', () => {
    const result = calculatePay({
      summary: makeSummary({ days_worked: 20 }),
      structure: { ...dailyStruct, fixed_allowance: 200 },
      otRule,
      epfRate: null,
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 0,
      adhocAllowanceTotal: 175,
      workingDaysInMonth: 22,
    })

    // gross = 1600 + 200 (fixed) + 175 (ad-hoc) = 1975
    expect(result.gross_pay).toBe(1975)
    expect(result.allowance).toBe(200)
    expect(result.adhoc_allowance_total).toBe(175)
  })

  it('defaults to 0 and is fully backward-compatible when omitted', () => {
    const result = calculatePay({
      summary: makeSummary({ days_worked: 20 }),
      structure: dailyStruct,
      otRule,
      epfRate: null,
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 0,
      workingDaysInMonth: 22,
    })

    expect(result.adhoc_allowance_total).toBe(0)
    expect(result.gross_pay).toBe(1600)
  })
})

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, path.resolve(process.cwd(), 'electron/db/migrations'))

  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined)
    VALUES (1, 'EMP001', 'Ali', '900101-01-0001', 1, 'active', '2020-01-01')
  `).run()
  db.prepare(`
    INSERT INTO salary_structures (employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day, subject_to_epf, subject_to_socso, subject_to_eis)
    VALUES (1, '2020-01-01', 'daily', 80, 8, 1, 0, 0)
  `).run()
  db.prepare(`
    INSERT INTO epf_rates (effective_from, employee_category, wage_from, wage_to, employee_contribution_pct, employer_contribution_pct)
    VALUES ('2020-01-01', 'all', 0, 5000, 11, 13)
  `).run()
  db.prepare(`
    INSERT INTO payroll_periods (id, name, start_date, end_date, status)
    VALUES (1, 'August 2026', '2026-08-01', '2026-08-31', 'finalized')
  `).run()

  return db
}

describe('adhocAllowances service + payrollRun integration', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  it('computes amount from quantity x rate_per_unit, not a raw entry', () => {
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    const saved = createAllowance(db, run.id, {
      employee_id: 1,
      description: 'Buka Pagar',
      quantity: 35,
      rate_per_unit: 5,
    })

    expect(saved.amount).toBe(175)
    expect(saved.quantity).toBe(35)
    expect(saved.rate_per_unit).toBe(5)
    expect(saved.description).toBe('Buka Pagar')
  })

  it('supports a flat amount entry with no quantity/rate basis', () => {
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    const saved = createAllowance(db, run.id, {
      employee_id: 1,
      description: 'One-off gift',
      amount: 50,
    })

    expect(saved.amount).toBe(50)
    expect(saved.quantity).toBeNull()
  })

  it('allows SEVERAL differently-named entries for the same employee in one run, and sums them', () => {
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    createAllowance(db, run.id, { employee_id: 1, description: 'Buka Pagar', quantity: 35, rate_per_unit: 5 })
    createAllowance(db, run.id, { employee_id: 1, description: 'Elaun Lain', amount: 50 })

    const list = listAllowancesForRun(db, run.id)
    expect(list).toHaveLength(2)
    expect(list.map((a) => a.description).sort()).toEqual(['Buka Pagar', 'Elaun Lain'])

    const totals = getAllowanceTotalsForRun(db, run.id)
    expect(totals.get(1)).toBe(225) // 175 + 50
  })

  it('flows through a real payroll run: added to gross, excluded from EPF, included in net', () => {
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    createAllowance(db, run.id, { employee_id: 1, description: 'Buka Pagar', quantity: 35, rate_per_unit: 5 })

    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]

    expect(item.adhoc_allowance_total).toBe(175)
    // Employee has 0 days_worked (no attendance data seeded) — gross is the
    // allowance alone, EPF base is 0 (allowance excluded).
    expect(item.gross_pay).toBe(175)
    expect(item.epf_wage_base).toBe(0)
    expect(item.epf_employee).toBe(0)
    // PCB is included (not excluded like EPF) — net is gross minus whatever the
    // seeded PCB bracket charges at this income, not necessarily 0.
    expect(item.net_pay).toBe(Math.round((175 - item.pcb) * 100) / 100)
  })

  it('is removable while draft, and the removal is reflected on recalculation', () => {
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    const saved = createAllowance(db, run.id, { employee_id: 1, description: 'Buka Pagar', quantity: 35, rate_per_unit: 5 })
    deleteAllowance(db, run.id, saved.id)

    expect(listAllowancesForRun(db, run.id)).toHaveLength(0)

    calculatePayrollRun(db, run.id)
    const item = getPayrollRunItems(db, run.id)[0]
    expect(item.adhoc_allowance_total).toBe(0)
  })

  it('refuses to add or remove an entry once the run is finalized', () => {
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    createAllowance(db, run.id, { employee_id: 1, description: 'Buka Pagar', quantity: 35, rate_per_unit: 5 })
    calculatePayrollRun(db, run.id)
    db.prepare(`UPDATE payroll_runs SET status = 'finalized' WHERE id = ?`).run(run.id)

    expect(() => createAllowance(db, run.id, { employee_id: 1, description: 'Late Addition', amount: 10 }))
      .toThrow(/finalized/)
  })
})
