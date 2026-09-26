// Coverage for migration 0027: topping up an existing salary advance instead of
// opening a second one (which would double the monthly installment deduction).

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import {
  createSalaryAdvance,
  topUpSalaryAdvance,
  listSalaryAdvanceTopUps,
  updateSalaryAdvance,
  applyAdvanceDeduction,
  getActiveAdvancesForEmployee,
  adjustSalaryAdvance,
  listSalaryAdvanceAdjustments,
  getSalaryAdvanceById,
} from '../payroll/salaryAdvances'

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
})

/** The reported scenario: RM1,000 advance at RM250/run, RM500 already repaid. */
function advanceWith500Outstanding() {
  const advance = createSalaryAdvance(db, {
    employee_id: 1,
    amount: 1000,
    date_issued: '2026-06-01',
    limit_max: 1000,
    deduction_mode: 'fixed_installment',
    installment_amount: 250,
  })
  applyAdvanceDeduction(db, advance.id, 250)
  applyAdvanceDeduction(db, advance.id, 250)
  return advance.id
}

describe('topUpSalaryAdvance', () => {
  it('adds to both principal and balance, keeping one advance and one installment', () => {
    const id = advanceWith500Outstanding()

    const updated = topUpSalaryAdvance(db, id, { amount: 1000, date_issued: '2026-09-01', limit_max: 2000 })

    expect(updated.amount).toBe(2000)
    expect(updated.balance_outstanding).toBe(1500)
    expect(updated.installment_amount).toBe(250)
    expect(getActiveAdvancesForEmployee(db, 1)).toHaveLength(1)
  })

  it('records the top-up in history', () => {
    const id = advanceWith500Outstanding()
    topUpSalaryAdvance(db, id, { amount: 1000, date_issued: '2026-09-01', limit_max: 2000, note: 'Kecemasan' })

    const history = listSalaryAdvanceTopUps(db, id)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ amount: 1000, date_issued: '2026-09-01', note: 'Kecemasan' })
  })

  it('can re-size the installment in the same step', () => {
    const id = advanceWith500Outstanding()
    const updated = topUpSalaryAdvance(db, id, {
      amount: 1000, date_issued: '2026-09-01', limit_max: 2000, installment_amount: 300,
    })
    expect(updated.installment_amount).toBe(300)
  })

  it('refuses when the new total exceeds the approved limit and nothing changes', () => {
    const id = advanceWith500Outstanding()
    expect(() => topUpSalaryAdvance(db, id, { amount: 1000, date_issued: '2026-09-01' }))
      .toThrow(/exceeds the approved limit/)
    expect(listSalaryAdvanceTopUps(db, id)).toHaveLength(0)
    expect(getActiveAdvancesForEmployee(db, 1)[0].balance_outstanding).toBe(500)
  })

  it('refuses a settled advance', () => {
    const id = advanceWith500Outstanding()
    applyAdvanceDeduction(db, id, 500)
    expect(() => topUpSalaryAdvance(db, id, { amount: 100, date_issued: '2026-09-01', limit_max: 2000 }))
      .toThrow(/Cannot top up a settled advance/)
  })
})

describe('updateSalaryAdvance — amount change', () => {
  it('shifts the balance by the same delta, preserving what was already repaid', () => {
    const id = advanceWith500Outstanding()
    const updated = updateSalaryAdvance(db, id, { amount: 1500, limit_max: 1500 })
    expect(updated.balance_outstanding).toBe(1000)
  })

  it('refuses an amount lower than what has already been repaid', () => {
    const id = advanceWith500Outstanding()
    expect(() => updateSalaryAdvance(db, id, { amount: 400 })).toThrow(/already been repaid/)
  })
})

describe('adjustSalaryAdvance (migration 0028)', () => {
  it('fixes a double top-up by setting the correct values and records before/after', () => {
    const id = advanceWith500Outstanding()
    topUpSalaryAdvance(db, id, { amount: 1000, date_issued: '2026-09-01', limit_max: 3000 })
    topUpSalaryAdvance(db, id, { amount: 1000, date_issued: '2026-09-01' }) // the mistake

    const fixed = adjustSalaryAdvance(db, id, {
      balance_outstanding: 1500, amount: 2000, reason: 'Top-up entered twice',
    })

    expect(fixed.balance_outstanding).toBe(1500)
    expect(fixed.amount).toBe(2000)
    expect(listSalaryAdvanceAdjustments(db, id)[0]).toMatchObject({
      balance_before: 2500, balance_after: 1500, amount_before: 3000, amount_after: 2000,
      reason: 'Top-up entered twice',
    })
  })

  it('sets the balance directly, independent of the (possibly wrong) current values', () => {
    const id = advanceWith500Outstanding()
    const fixed = adjustSalaryAdvance(db, id, { balance_outstanding: 300, reason: 'Paid RM200 in cash' })
    expect(fixed.balance_outstanding).toBe(300)
    expect(fixed.amount).toBe(1000)
  })

  it('settles the advance when the corrected balance is zero', () => {
    const id = advanceWith500Outstanding()
    adjustSalaryAdvance(db, id, { balance_outstanding: 0, reason: 'Repaid in cash' })
    expect(getSalaryAdvanceById(db, id)!.status).toBe('settled')
    expect(getActiveAdvancesForEmployee(db, 1)).toHaveLength(0)
  })

  it('refuses a balance above the total issued and leaves everything untouched', () => {
    const id = advanceWith500Outstanding()
    expect(() => adjustSalaryAdvance(db, id, { balance_outstanding: 1200, reason: 'x' }))
      .toThrow(/cannot exceed the total issued/)
    expect(getSalaryAdvanceById(db, id)!.balance_outstanding).toBe(500)
    expect(listSalaryAdvanceAdjustments(db, id)).toHaveLength(0)
  })

  it('refuses a no-op correction', () => {
    const id = advanceWith500Outstanding()
    expect(() => adjustSalaryAdvance(db, id, { balance_outstanding: 500, reason: 'x' }))
      .toThrow(/Nothing to adjust/)
  })
})
