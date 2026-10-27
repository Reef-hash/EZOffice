// Salary advance deductions are capped at 50% of net pay and the rest is carried
// forward. Before this, a RM6,000 advance against RM5,000 pay drove net pay negative
// and the advance was marked settled with RM1,000+ still owed (2026-10-27).

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { allocateAdvanceDeductions, MAX_ADVANCE_DEDUCTION_RATIO } from '../payroll/advanceDeduction'
import { createPayrollRun, calculatePayrollRun, finalizePayrollRun, getPayrollRunItems } from '../payroll/payrollRun'
import { createSalaryAdvance, getSalaryAdvanceById } from '../payroll/salaryAdvances'

const round2 = (n: number) => Math.round(n * 100) / 100

describe('allocateAdvanceDeductions', () => {
  it('uses half the net pay as the ceiling', () => {
    expect(MAX_ADVANCE_DEDUCTION_RATIO).toBe(0.5)
    const result = allocateAdvanceDeductions([{ id: 1, amount: 6000 }], 4400)
    expect(result).toEqual({ perAdvance: [{ id: 1, amount: 2200 }], total: 2200, deferred: 3800 })
  })

  it('deducts the full scheduled amount when it fits under the cap', () => {
    const result = allocateAdvanceDeductions([{ id: 1, amount: 500 }], 4400)
    expect(result).toEqual({ perAdvance: [{ id: 1, amount: 500 }], total: 500, deferred: 0 })
  })

  it('spends the cap on the oldest advance first when there are several', () => {
    const result = allocateAdvanceDeductions([{ id: 1, amount: 1500 }, { id: 2, amount: 1500 }], 4000)
    expect(result.perAdvance).toEqual([{ id: 1, amount: 1500 }, { id: 2, amount: 500 }])
    expect(result.total).toBe(2000)
    expect(result.deferred).toBe(1000)
  })

  it('deducts nothing when there is no net pay to take from', () => {
    for (const net of [0, -250]) {
      expect(allocateAdvanceDeductions([{ id: 1, amount: 300 }], net))
        .toEqual({ perAdvance: [{ id: 1, amount: 0 }], total: 0, deferred: 300 })
    }
  })
})

describe('advance cap through a real payroll run', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db, path.resolve(process.cwd(), 'electron/db/migrations'))
    db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
    db.prepare(`
      INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined)
      VALUES (1, 'EMP001', 'Ali', '900101-01-0001', 1, 'active', '2020-01-01')
    `).run()
    // Fixed RM5,000 monthly pay with EPF/SOCSO/EIS/LINDUNG switched off. PCB still
    // applies from the seeded table, so the tests derive net pay from the item's own
    // pcb rather than assuming a figure.
    db.prepare(`
      INSERT INTO salary_structures (employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
        subject_to_epf, subject_to_socso, subject_to_eis, subject_to_lindung)
      VALUES (1, '2020-01-01', 'monthly', 5000, 8, 0, 0, 0, 0)
    `).run()
    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (1, 'Sep', '2026-08-26', '2026-09-25', 'finalized')
    `).run()
  })

  function run(): number {
    const created = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-09-26' })
    calculatePayrollRun(db, created.id)
    return created.id
  }

  it('the reported case: RM6,000 advance on RM5,000 pay takes half, never goes negative', () => {
    const advance = createSalaryAdvance(db, {
      employee_id: 1, amount: 6000, date_issued: '2026-09-01', limit_max: 6000, deduction_mode: 'full_balance',
    })
    const runId = run()

    const [draft] = getPayrollRunItems(db, runId)
    const netBeforeAdvance = round2(5000 - draft.pcb)
    const expectedDeduction = round2(netBeforeAdvance / 2)
    expect(draft.advance_deduction).toBe(expectedDeduction)
    expect(draft.advance_deferred).toBe(round2(6000 - expectedDeduction))
    expect(draft.net_pay).toBe(round2(netBeforeAdvance - expectedDeduction))
    expect(draft.net_pay).toBeGreaterThan(0)

    finalizePayrollRun(db, runId)
    const [final] = getPayrollRunItems(db, runId)
    expect(final).toMatchObject({ advance_deduction: expectedDeduction, net_pay: draft.net_pay })
    // The unpaid part stays owed and active, instead of being written off as settled.
    expect(getSalaryAdvanceById(db, advance.id)).toMatchObject({
      balance_outstanding: round2(6000 - expectedDeduction),
      status: 'active',
    })
  })

  it('does not touch an advance that fits under the cap', () => {
    const advance = createSalaryAdvance(db, {
      employee_id: 1, amount: 1000, date_issued: '2026-09-01', limit_max: 1000, deduction_mode: 'full_balance',
    })
    const runId = run()
    finalizePayrollRun(db, runId)

    const [item] = getPayrollRunItems(db, runId)
    expect(item).toMatchObject({ advance_deduction: 1000, advance_deferred: 0, net_pay: round2(5000 - item.pcb - 1000) })
    expect(getSalaryAdvanceById(db, advance.id)).toMatchObject({ balance_outstanding: 0, status: 'settled' })
  })

  it('finalize deducts exactly what the draft showed', () => {
    createSalaryAdvance(db, {
      employee_id: 1, amount: 6000, date_issued: '2026-09-01', limit_max: 6000, deduction_mode: 'full_balance',
    })
    const runId = run()
    const [draft] = getPayrollRunItems(db, runId)
    finalizePayrollRun(db, runId)
    const [final] = getPayrollRunItems(db, runId)
    expect(final.advance_deduction).toBe(draft.advance_deduction)
    expect(final.net_pay).toBe(draft.net_pay)
  })
})
