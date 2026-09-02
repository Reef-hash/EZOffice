// Ad-hoc per-run allowances — admin-entered input, mutable only while the owning
// payroll run is a draft. Unlike commissions.ts (one entry per employee per run),
// an employee can have SEVERAL of these in the same run, each with its own
// description (e.g. "Buka Pagar" = 35 trips x RM5, plus a separate "Elaun Lain").
// The sum is snapshotted into payroll_run_items.adhoc_allowance_total by
// calculatePayrollRun (see payrollRun.ts) once the run is calculated; the itemized
// rows themselves stay in this table (frozen from edits once finalized — see
// assertRunIsDraft) rather than being duplicated into payroll_run_items, the same
// convention payroll_run_commissions already uses.

import type Database from 'better-sqlite3'
import type { PayrollRunAllowance } from '../../../src/shared/types/entities'
import type { UpsertPayrollRunAllowanceInput } from '../../../src/shared/types/inputs'
import { assertRunIsDraft } from './commissions'

export function listAllowancesForRun(db: Database.Database, runId: number): PayrollRunAllowance[] {
  return db.prepare(`
    SELECT a.*, e.name AS employee_name
    FROM payroll_run_allowances a
    LEFT JOIN employees e ON e.id = a.employee_id
    WHERE a.payroll_run_id = ?
    ORDER BY e.name ASC, a.id ASC
  `).all(runId) as PayrollRunAllowance[]
}

/**
 * Returns employee_id → summed amount across all of that employee's ad-hoc
 * allowance entries for a run, for use by the calculation engine. Employees with
 * no entries are absent from the map (treat as 0).
 */
export function getAllowanceTotalsForRun(db: Database.Database, runId: number): Map<number, number> {
  const rows = db.prepare(`
    SELECT employee_id, SUM(amount) AS total
    FROM payroll_run_allowances
    WHERE payroll_run_id = ?
    GROUP BY employee_id
  `).all(runId) as Array<{ employee_id: number; total: number }>
  return new Map(rows.map((r) => [r.employee_id, r.total]))
}

/**
 * Add a new ad-hoc allowance entry for an employee on a draft run. Unlike
 * commissions.upsertCommission, this always INSERTS a new row — an employee can
 * have multiple differently-named entries, so there is no natural upsert key.
 * Editing/removing an entry is delete-and-recreate (see deleteAllowance).
 */
export function createAllowance(
  db: Database.Database,
  runId: number,
  input: UpsertPayrollRunAllowanceInput,
): PayrollRunAllowance {
  assertRunIsDraft(db, runId)

  const amount = input.quantity != null && input.rate_per_unit != null
    ? Math.round(input.quantity * input.rate_per_unit * 100) / 100
    : input.amount!

  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO payroll_run_allowances (
      payroll_run_id, employee_id, description, quantity, rate_per_unit, amount, note, created_at, updated_at
    ) VALUES (
      @payroll_run_id, @employee_id, @description, @quantity, @rate_per_unit, @amount, @note, @created_at, @updated_at
    )
  `).run({
    payroll_run_id: runId,
    employee_id: input.employee_id,
    description: input.description,
    quantity: input.quantity ?? null,
    rate_per_unit: input.rate_per_unit ?? null,
    amount,
    note: input.note ?? null,
    created_at: now,
    updated_at: now,
  })

  const row = db.prepare(`
    SELECT a.*, e.name AS employee_name
    FROM payroll_run_allowances a
    LEFT JOIN employees e ON e.id = a.employee_id
    WHERE a.id = ?
  `).get(result.lastInsertRowid as number) as PayrollRunAllowance
  return row
}

export function deleteAllowance(db: Database.Database, runId: number, allowanceId: number): void {
  assertRunIsDraft(db, runId)

  const result = db.prepare(
    'DELETE FROM payroll_run_allowances WHERE payroll_run_id = ? AND id = ?',
  ).run(runId, allowanceId)
  if (result.changes === 0) {
    throw new Error(`No allowance entry ${allowanceId} found on run ${runId}`)
  }
}
