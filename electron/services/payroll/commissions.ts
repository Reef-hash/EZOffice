// Ad-hoc per-run sales commission — admin-entered input, mutable only while the
// owning payroll run is a draft. Snapshotted into payroll_run_items.commission by
// calculatePayrollRun (see payrollRun.ts) once the run is calculated.

import type Database from 'better-sqlite3'
import type { PayrollRunCommission } from '../../../src/shared/types/entities'
import type { UpsertPayrollRunCommissionInput } from '../../../src/shared/types/inputs'

function assertRunIsDraft(db: Database.Database, runId: number): void {
  const run = db.prepare('SELECT status FROM payroll_runs WHERE id = ?').get(runId) as { status: string } | undefined
  if (!run) throw new Error(`Payroll run ${runId} not found`)
  if (run.status === 'finalized') {
    throw new Error('Cannot change commission entries on a finalized payroll run')
  }
}

export function listCommissionsForRun(db: Database.Database, runId: number): PayrollRunCommission[] {
  return db.prepare(`
    SELECT c.*, e.name AS employee_name
    FROM payroll_run_commissions c
    LEFT JOIN employees e ON e.id = c.employee_id
    WHERE c.payroll_run_id = ?
    ORDER BY e.name ASC
  `).all(runId) as PayrollRunCommission[]
}

/**
 * Returns employee_id → commission amount for a run, for use by the calculation
 * engine. Employees with no entry are simply absent from the map (treat as 0).
 */
export function getCommissionMapForRun(db: Database.Database, runId: number): Map<number, number> {
  const rows = db.prepare(
    'SELECT employee_id, amount FROM payroll_run_commissions WHERE payroll_run_id = ?',
  ).all(runId) as Array<{ employee_id: number; amount: number }>
  return new Map(rows.map((r) => [r.employee_id, r.amount]))
}

/**
 * Add or update the commission amount for one employee on a draft run.
 * UNIQUE(payroll_run_id, employee_id) makes this a true upsert — re-entering an
 * amount for the same employee replaces the previous one rather than erroring.
 */
export function upsertCommission(
  db: Database.Database,
  runId: number,
  input: UpsertPayrollRunCommissionInput,
): PayrollRunCommission {
  assertRunIsDraft(db, runId)

  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO payroll_run_commissions (payroll_run_id, employee_id, amount, note, created_at, updated_at)
    VALUES (@payroll_run_id, @employee_id, @amount, @note, @created_at, @updated_at)
    ON CONFLICT(payroll_run_id, employee_id) DO UPDATE SET
      amount = excluded.amount,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run({
    payroll_run_id: runId,
    employee_id: input.employee_id,
    amount: input.amount,
    note: input.note ?? null,
    created_at: now,
    updated_at: now,
  })

  const row = db.prepare(`
    SELECT c.*, e.name AS employee_name
    FROM payroll_run_commissions c
    LEFT JOIN employees e ON e.id = c.employee_id
    WHERE c.payroll_run_id = ? AND c.employee_id = ?
  `).get(runId, input.employee_id) as PayrollRunCommission
  return row
}

export function deleteCommission(db: Database.Database, runId: number, employeeId: number): void {
  assertRunIsDraft(db, runId)

  const result = db.prepare(
    'DELETE FROM payroll_run_commissions WHERE payroll_run_id = ? AND employee_id = ?',
  ).run(runId, employeeId)
  if (result.changes === 0) {
    throw new Error(`No commission entry found for employee ${employeeId} on run ${runId}`)
  }
}
