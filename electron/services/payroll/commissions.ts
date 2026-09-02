// Ad-hoc per-run sales commission — admin-entered input, mutable only while the
// owning payroll run is a draft. Snapshotted into payroll_run_items.commission by
// calculatePayrollRun (see payrollRun.ts) once the run is calculated.

import type Database from 'better-sqlite3'
import type { PayrollRunCommission } from '../../../src/shared/types/entities'
import type { UpsertPayrollRunCommissionInput } from '../../../src/shared/types/inputs'

// Shared with adhocAllowances.ts — same "locked once finalized" rule applies to
// every admin-entered, per-run input (commission, ad-hoc allowances).
export function assertRunIsDraft(db: Database.Database, runId: number): void {
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
 * Returns employee_id → { amount, statutoryBaseOverride } for a run, for use by
 * the calculation engine. Employees with no entry are absent from the map
 * (treat as commission 0, no override).
 */
export function getCommissionMapForRun(
  db: Database.Database,
  runId: number,
): Map<number, { amount: number; statutoryBaseOverride: number | null }> {
  const rows = db.prepare(
    'SELECT employee_id, amount, statutory_base_override FROM payroll_run_commissions WHERE payroll_run_id = ?',
  ).all(runId) as Array<{ employee_id: number; amount: number; statutory_base_override: number | null }>
  return new Map(rows.map((r) => [r.employee_id, { amount: r.amount, statutoryBaseOverride: r.statutory_base_override }]))
}

/**
 * Add or update the commission amount for one employee on a draft run.
 * UNIQUE(payroll_run_id, employee_id) makes this a true upsert — re-entering an
 * amount for the same employee replaces the previous one rather than erroring.
 *
 * When `sales_amount` is supplied, the final `amount` is ALWAYS computed here
 * server-side as sales_amount x (commission_rate ?? 100) / 100 — a client-supplied
 * `amount` is ignored in that case, never trusted, per CLAUDE.md §3 input validation.
 * `commission_rate` omitted (with sales_amount set) means "the sales figure IS the
 * commission" (100%). When `sales_amount` is omitted, `amount` is used directly as
 * a flat one-off entry (Zod's refine on upsertPayrollRunCommissionSchema requires at
 * least one of the two).
 */
export function upsertCommission(
  db: Database.Database,
  runId: number,
  input: UpsertPayrollRunCommissionInput,
): PayrollRunCommission {
  assertRunIsDraft(db, runId)

  const amount = input.sales_amount != null
    ? Math.round(input.sales_amount * (input.commission_rate ?? 100) / 100 * 100) / 100
    : input.amount!

  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO payroll_run_commissions (
      payroll_run_id, employee_id, amount, sales_amount, commission_rate,
      note, statutory_base_override, created_at, updated_at
    )
    VALUES (
      @payroll_run_id, @employee_id, @amount, @sales_amount, @commission_rate,
      @note, @statutory_base_override, @created_at, @updated_at
    )
    ON CONFLICT(payroll_run_id, employee_id) DO UPDATE SET
      amount = excluded.amount,
      sales_amount = excluded.sales_amount,
      commission_rate = excluded.commission_rate,
      note = excluded.note,
      statutory_base_override = excluded.statutory_base_override,
      updated_at = excluded.updated_at
  `).run({
    payroll_run_id: runId,
    employee_id: input.employee_id,
    amount,
    sales_amount: input.sales_amount ?? null,
    commission_rate: input.commission_rate ?? null,
    note: input.note ?? null,
    statutory_base_override: input.statutory_base_override ?? null,
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
