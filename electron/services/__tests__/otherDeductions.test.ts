// Other deductions on a payroll run (migration 0031): a one-off or catch-up amount
// with its own label, recovered from net pay in full and shown as its own payslip line
// instead of being disguised as a salary advance.

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { createPayrollRun, calculatePayrollRun, finalizePayrollRun, getPayrollRunItems } from '../payroll/payrollRun'
import { createDeduction, deleteDeduction, listDeductionsForRun } from '../payroll/otherDeductions'
import { createSalaryAdvance, getSalaryAdvanceById } from '../payroll/salaryAdvances'

const round2 = (n: number) => Math.round(n * 100) / 100

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
  // Fixed RM3,000 pay with every statutory contribution off, so the only things between
  // gross and net are PCB (read from the item) and what these tests add.
  db.prepare(`
    INSERT INTO salary_structures (employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
      subject_to_epf, subject_to_socso, subject_to_eis, subject_to_lindung)
    VALUES (1, '2020-01-01', 'monthly', 3000, 8, 0, 0, 0, 0)
  `).run()
  db.prepare(`
    INSERT INTO payroll_periods (id, name, start_date, end_date, status)
    VALUES (1, 'Sep', '2026-08-26', '2026-09-25', 'finalized')
  `).run()
})

function newRun(): number {
  return createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-09-26' }).id
}

describe('other deductions on a payroll run', () => {
  it('takes the amount from net pay in full and records the total on the item', () => {
    const runId = newRun()
    createDeduction(db, runId, { employee_id: 1, description: 'Caruman tertunggak SOCSO Jan–Sep', amount: 1000 })
    calculatePayrollRun(db, runId)

    const [item] = getPayrollRunItems(db, runId)
    expect(item.other_deduction_total).toBe(1000)
    expect(item.gross_pay).toBe(3000)
    expect(item.net_pay).toBe(round2(3000 - item.pcb - 1000))
  })

  it('sums several entries for the same employee', () => {
    const runId = newRun()
    createDeduction(db, runId, { employee_id: 1, description: 'Caruman SOCSO', amount: 400.5 })
    createDeduction(db, runId, { employee_id: 1, description: 'Caruman EIS', amount: 99.5 })
    calculatePayrollRun(db, runId)

    const [item] = getPayrollRunItems(db, runId)
    expect(item.other_deduction_total).toBe(500)
    expect(listDeductionsForRun(db, runId).map((d) => d.description)).toEqual(['Caruman SOCSO', 'Caruman EIS'])
  })

  it('leaves the statutory base alone, since it is a deduction and not a wage', () => {
    const runId = newRun()
    calculatePayrollRun(db, runId)
    const [before] = getPayrollRunItems(db, runId)

    createDeduction(db, runId, { employee_id: 1, description: 'x', amount: 700 })
    calculatePayrollRun(db, runId)
    const [after] = getPayrollRunItems(db, runId)

    expect(after.gross_pay).toBe(before.gross_pay)
    expect(after.pcb).toBe(before.pcb)
    expect(after.net_pay).toBe(round2(before.net_pay - 700))
  })

  it('is taken before the advance cap is measured', () => {
    const advance = createSalaryAdvance(db, {
      employee_id: 1, amount: 6000, date_issued: '2026-09-01', limit_max: 6000, deduction_mode: 'full_balance',
    })
    const runId = newRun()
    createDeduction(db, runId, { employee_id: 1, description: 'Caruman tertunggak', amount: 1000 })
    calculatePayrollRun(db, runId)

    const [draft] = getPayrollRunItems(db, runId)
    const netBeforeAdvance = round2(3000 - draft.pcb - 1000)
    expect(draft.advance_deduction).toBe(round2(netBeforeAdvance / 2))
    expect(draft.net_pay).toBe(round2(netBeforeAdvance - draft.advance_deduction))

    finalizePayrollRun(db, runId)
    const [final] = getPayrollRunItems(db, runId)
    expect(final.other_deduction_total).toBe(1000)
    expect(final.advance_deduction).toBe(draft.advance_deduction)
    expect(final.net_pay).toBe(draft.net_pay)
    expect(getSalaryAdvanceById(db, advance.id)!.status).toBe('active')
  })

  it('can be removed while the run is a draft, and recalculating drops it', () => {
    const runId = newRun()
    const entry = createDeduction(db, runId, { employee_id: 1, description: 'x', amount: 250 })
    deleteDeduction(db, runId, entry.id)
    calculatePayrollRun(db, runId)

    const [item] = getPayrollRunItems(db, runId)
    expect(item.other_deduction_total).toBe(0)
  })

  it('is locked once the run is finalized', () => {
    const runId = newRun()
    const entry = createDeduction(db, runId, { employee_id: 1, description: 'x', amount: 250 })
    calculatePayrollRun(db, runId)
    finalizePayrollRun(db, runId)

    expect(() => createDeduction(db, runId, { employee_id: 1, description: 'y', amount: 1 })).toThrow()
    expect(() => deleteDeduction(db, runId, entry.id)).toThrow()
  })

  it('refuses a zero or blank entry at the database level', () => {
    const runId = newRun()
    const insert = (description: string, amount: number) => db.prepare(`
      INSERT INTO payroll_run_deductions (payroll_run_id, employee_id, description, amount)
      VALUES (?, 1, ?, ?)
    `).run(runId, description, amount)
    expect(() => insert('ok', 0)).toThrow()
    expect(() => insert('   ', 10)).toThrow()
  })

  it('refuses to delete an entry that is not on the run', () => {
    expect(() => deleteDeduction(db, newRun(), 999)).toThrow(/No deduction entry/)
  })
})
