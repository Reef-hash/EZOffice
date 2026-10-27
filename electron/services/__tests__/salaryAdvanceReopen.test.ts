// Reopening a settled advance: the repair path for an advance that was marked settled
// while the employee still owed money (a deduction larger than the net pay used to
// zero the balance regardless — see CLAUDE.md decision log, 2026-10-27).

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import {
  createSalaryAdvance,
  applyAdvanceDeduction,
  reopenSalaryAdvance,
  adjustSalaryAdvance,
  listSalaryAdvanceAdjustments,
  getActiveAdvancesForEmployee,
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

/** RM6,000 advance, deducted in full by a run — the reported scenario. */
function settledAdvance() {
  const advance = createSalaryAdvance(db, {
    employee_id: 1, amount: 6000, date_issued: '2026-09-01', limit_max: 6000, deduction_mode: 'full_balance',
  })
  applyAdvanceDeduction(db, advance.id, 6000)
  expect(getSalaryAdvanceById(db, advance.id)!.status).toBe('settled')
  return advance
}

describe('reopenSalaryAdvance', () => {
  it('puts a settled advance back to active with the stated balance', () => {
    const advance = settledAdvance()
    const reopened = reopenSalaryAdvance(db, advance.id, { balance_outstanding: 1600, reason: 'Net pay too low' })

    expect(reopened.status).toBe('active')
    expect(reopened.balance_outstanding).toBe(1600)
    expect(reopened.amount).toBe(6000) // total issued is untouched
    expect(getActiveAdvancesForEmployee(db, 1).map((a) => a.id)).toEqual([advance.id])
  })

  it('records the reopening, with its reason, in the advance history', () => {
    const advance = settledAdvance()
    reopenSalaryAdvance(db, advance.id, { balance_outstanding: 1600, reason: 'Net pay too low' })

    const [entry] = listSalaryAdvanceAdjustments(db, advance.id)
    expect(entry).toMatchObject({ balance_before: 0, balance_after: 1600, amount_before: 6000, amount_after: 6000 })
    expect(entry.reason).toBe('Reopened — Net pay too low')
  })

  it('lets the reopened advance be deducted again and settle normally', () => {
    const advance = settledAdvance()
    reopenSalaryAdvance(db, advance.id, { balance_outstanding: 1600, reason: 'Net pay too low' })

    expect(applyAdvanceDeduction(db, advance.id, 1600)).toBe(1600)
    expect(getSalaryAdvanceById(db, advance.id)).toMatchObject({ balance_outstanding: 0, status: 'settled' })
  })

  it('refuses an advance that is still active', () => {
    const advance = createSalaryAdvance(db, {
      employee_id: 1, amount: 500, date_issued: '2026-09-01', limit_max: 500, deduction_mode: 'full_balance',
    })
    expect(() => reopenSalaryAdvance(db, advance.id, { balance_outstanding: 100, reason: 'x' }))
      .toThrow(/Only a settled advance can be reopened/)
  })

  it('refuses a balance above the total issued, leaving the advance settled', () => {
    const advance = settledAdvance()
    expect(() => reopenSalaryAdvance(db, advance.id, { balance_outstanding: 6000.01, reason: 'x' }))
      .toThrow(/cannot exceed the total issued/)
    expect(getSalaryAdvanceById(db, advance.id)!.status).toBe('settled')
    expect(listSalaryAdvanceAdjustments(db, advance.id)).toHaveLength(0)
  })

  it('refuses an unknown advance', () => {
    expect(() => reopenSalaryAdvance(db, 999, { balance_outstanding: 1, reason: 'x' })).toThrow(/not found/)
  })

  it('leaves Correct Balance restricted to active advances', () => {
    const advance = settledAdvance()
    expect(() => adjustSalaryAdvance(db, advance.id, { balance_outstanding: 1600, reason: 'x' }))
      .toThrow(/Cannot adjust a settled advance/)
  })
})
