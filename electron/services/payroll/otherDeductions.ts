// Ad-hoc per-run "other deductions" — admin-entered, mutable only while the owning
// payroll run is a draft. An employee can have several, each with its own
// description. The sum is snapshotted into payroll_run_items.other_deduction_total
// by calculatePayrollRun; the itemized rows stay in this table (frozen once the run
// is finalized — see assertRunIsDraft), the same convention as adhocAllowances.ts.
//
// These are deducted in full and are NOT subject to the salary advance cap: the admin
// states the exact amount, so splitting a large catch-up across months is their call.
// They are taken before the advance cap is measured (see payrollRun.ts), so an
// advance can never push net pay below what these leave.

import type Database from 'better-sqlite3'
import type { PayrollRunDeduction } from '../../../src/shared/types/entities'
import type { CreatePayrollRunDeductionInput } from '../../../src/shared/types/inputs'
import { assertRunIsDraft } from './commissions'

const SELECT_WITH_EMPLOYEE = `
  SELECT d.*, e.name AS employee_name
  FROM payroll_run_deductions d
  LEFT JOIN employees e ON e.id = d.employee_id
`

export function listDeductionsForRun(db: Database.Database, runId: number): PayrollRunDeduction[] {
  return db.prepare(`${SELECT_WITH_EMPLOYEE} WHERE d.payroll_run_id = ? ORDER BY e.name ASC, d.id ASC`)
    .all(runId) as PayrollRunDeduction[]
}

/** employee_id → summed amount of that employee's entries on the run; absent means 0. */
export function getDeductionTotalsForRun(db: Database.Database, runId: number): Map<number, number> {
  const rows = db.prepare(`
    SELECT employee_id, SUM(amount) AS total
    FROM payroll_run_deductions
    WHERE payroll_run_id = ?
    GROUP BY employee_id
  `).all(runId) as Array<{ employee_id: number; total: number }>
  return new Map(rows.map((r) => [r.employee_id, r.total]))
}

/** Always inserts: correcting an entry is delete-and-recreate (no natural upsert key). */
export function createDeduction(
  db: Database.Database,
  runId: number,
  input: CreatePayrollRunDeductionInput,
): PayrollRunDeduction {
  assertRunIsDraft(db, runId)

  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO payroll_run_deductions (payroll_run_id, employee_id, description, amount, note, created_at, updated_at)
    VALUES (@payroll_run_id, @employee_id, @description, @amount, @note, @created_at, @updated_at)
  `).run({
    payroll_run_id: runId,
    employee_id: input.employee_id,
    description: input.description,
    amount: Math.round(input.amount * 100) / 100,
    note: input.note ?? null,
    created_at: now,
    updated_at: now,
  })

  return db.prepare(`${SELECT_WITH_EMPLOYEE} WHERE d.id = ?`).get(result.lastInsertRowid as number) as PayrollRunDeduction
}

export function deleteDeduction(db: Database.Database, runId: number, deductionId: number): void {
  assertRunIsDraft(db, runId)

  const result = db.prepare('DELETE FROM payroll_run_deductions WHERE payroll_run_id = ? AND id = ?')
    .run(runId, deductionId)
  if (result.changes === 0) {
    throw new Error(`No deduction entry ${deductionId} found on run ${runId}`)
  }
}
