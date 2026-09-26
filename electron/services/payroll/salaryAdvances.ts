// Salary Advance service — CRUD + active balance tracking.
// Handles per-advance deduction terms (full_balance vs fixed_installment).
// The deduction logic for a payroll run is in the orchestrator, not here —
// this file keeps advance CRUD and balance queries.

import type Database from 'better-sqlite3'
import type { SalaryAdvance, SalaryAdvanceTopUp, SalaryAdvanceAdjustment } from '../../../src/shared/types/entities'
import type {
  CreateSalaryAdvanceInput,
  UpdateSalaryAdvanceInput,
  TopUpSalaryAdvanceInput,
  AdjustSalaryAdvanceInput,
} from '../../../src/shared/types/inputs'

// ── Shared ───────────────────────────────────────────────

function queryById(db: Database.Database, id: number): SalaryAdvance | null {
  const row = db.prepare(`
    SELECT a.*, e.name AS employee_name
    FROM salary_advances a
    LEFT JOIN employees e ON e.id = a.employee_id
    WHERE a.id = ?
  `).get(id) as SalaryAdvance | undefined
  return row ?? null
}

// ── Queries ──────────────────────────────────────────────

export function listSalaryAdvances(db: Database.Database, employeeId?: number): SalaryAdvance[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (employeeId) {
    conditions.push('a.employee_id = @employeeId')
    params.employeeId = employeeId
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db.prepare(`
    SELECT a.*, e.name AS employee_name
    FROM salary_advances a
    LEFT JOIN employees e ON e.id = a.employee_id
    ${where}
    ORDER BY a.date_issued DESC
  `).all(params) as SalaryAdvance[]
}

export function getSalaryAdvanceById(db: Database.Database, id: number): SalaryAdvance | null {
  return queryById(db, id)
}

/**
 * Returns all ACTIVE advances for an employee (balance_outstanding > 0).
 * Used by the payroll run orchestrator to compute deductions.
 */
export function getActiveAdvancesForEmployee(
  db: Database.Database,
  employeeId: number,
): SalaryAdvance[] {
  return db.prepare(`
    SELECT a.*, e.name AS employee_name
    FROM salary_advances a
    LEFT JOIN employees e ON e.id = a.employee_id
    WHERE a.employee_id = ? AND a.status = 'active' AND a.balance_outstanding > 0
    ORDER BY a.date_issued ASC
  `).all(employeeId) as SalaryAdvance[]
}

// ── CRUD ─────────────────────────────────────────────────

export function createSalaryAdvance(
  db: Database.Database,
  input: CreateSalaryAdvanceInput,
): SalaryAdvance {
  // Validate: installment_amount required when fixed_installment mode
  if (input.deduction_mode === 'fixed_installment' && !input.installment_amount) {
    throw new Error('installment_amount is required when deduction_mode is fixed_installment')
  }
  // limit_max must be ≥ amount
  if (input.limit_max < input.amount) {
    throw new Error('limit_max must be greater than or equal to the advance amount')
  }

  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO salary_advances (
      employee_id, amount, date_issued, limit_max, balance_outstanding,
      status, deduction_mode, installment_amount, created_at, updated_at
    ) VALUES (
      @employee_id, @amount, @date_issued, @limit_max, @amount,
      'active', @deduction_mode, @installment_amount, @created_at, @updated_at
    )
  `).run({
    employee_id: input.employee_id,
    amount: input.amount,
    date_issued: input.date_issued,
    limit_max: input.limit_max,
    deduction_mode: input.deduction_mode,
    installment_amount: input.installment_amount ?? null,
    created_at: now,
    updated_at: now,
  })

  return queryById(db, result.lastInsertRowid as number)!
}

export function updateSalaryAdvance(
  db: Database.Database,
  id: number,
  input: UpdateSalaryAdvanceInput,
): SalaryAdvance {
  const existing = queryById(db, id)
  if (!existing) throw new Error(`Salary advance with id ${id} not found`)

  if (existing.status !== 'active') {
    throw new Error(`Cannot update a ${existing.status} advance`)
  }

  const now = new Date().toISOString()
  const amount = input.amount ?? existing.amount
  // balance_outstanding is never reset by edits — it tracks repayments made through
  // payroll runs. Resetting it would silently erase partial repayments already applied.
  // A changed principal shifts the balance by the same delta instead, so the amount
  // already repaid (amount − balance) is preserved. Before this, raising the amount
  // left the balance untouched — the extra money was never deducted.
  const balanceOutstanding = existing.balance_outstanding + (amount - existing.amount)
  if (balanceOutstanding < 0) {
    const repaid = existing.amount - existing.balance_outstanding
    throw new Error(
      `Amount cannot be lower than what has already been repaid (RM ${repaid.toFixed(2)})`,
    )
  }
  const merged = {
    employee_id: input.employee_id ?? existing.employee_id,
    amount,
    date_issued: input.date_issued ?? existing.date_issued,
    limit_max: input.limit_max ?? existing.limit_max,
    balance_outstanding: balanceOutstanding,
    deduction_mode: input.deduction_mode ?? existing.deduction_mode,
    installment_amount: input.installment_amount !== undefined ? input.installment_amount : existing.installment_amount,
  }

  if (merged.deduction_mode === 'fixed_installment' && !merged.installment_amount) {
    throw new Error('installment_amount is required when deduction_mode is fixed_installment')
  }
  if (merged.limit_max < merged.amount) {
    throw new Error('limit_max must be greater than or equal to the advance amount')
  }

  db.prepare(`
    UPDATE salary_advances
    SET employee_id = @employee_id, amount = @amount, date_issued = @date_issued,
        limit_max = @limit_max, balance_outstanding = @balance_outstanding,
        deduction_mode = @deduction_mode, installment_amount = @installment_amount,
        updated_at = @updated_at
    WHERE id = @id
  `).run({ ...merged, updated_at: now, id })

  return queryById(db, id)!
}

/**
 * Adds more money to an existing ACTIVE advance instead of opening a second one.
 *
 * Why: each active advance contributes its own installment to a payroll run
 * (previewAdvanceDeductions sums one per advance), so a second advance doubles the
 * monthly deduction. Topping up keeps one balance and one installment.
 *
 * Principal and balance_outstanding both grow by the top-up amount, so the amount
 * already repaid is unchanged. The event is recorded in salary_advance_topups.
 * A finalized payroll run is unaffected — its deduction is already snapshotted — and
 * a draft run picks up the new balance on its next Recalculate / at Finalize.
 */
export function topUpSalaryAdvance(
  db: Database.Database,
  id: number,
  input: TopUpSalaryAdvanceInput,
): SalaryAdvance {
  const existing = queryById(db, id)
  if (!existing) throw new Error(`Salary advance with id ${id} not found`)
  if (existing.status !== 'active') {
    throw new Error(`Cannot top up a ${existing.status} advance — create a new advance instead`)
  }

  const newAmount = existing.amount + input.amount
  const newBalance = existing.balance_outstanding + input.amount
  const newLimit = input.limit_max ?? existing.limit_max
  if (newLimit < newAmount) {
    throw new Error(
      `New total RM ${newAmount.toFixed(2)} exceeds the approved limit of RM ${newLimit.toFixed(2)} — ` +
      'raise the approved limit in the same top-up',
    )
  }
  const newInstallment = input.installment_amount ?? existing.installment_amount

  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`
      UPDATE salary_advances
      SET amount = @amount, balance_outstanding = @balance_outstanding, limit_max = @limit_max,
          installment_amount = @installment_amount, updated_at = @updated_at
      WHERE id = @id
    `).run({
      amount: newAmount,
      balance_outstanding: newBalance,
      limit_max: newLimit,
      installment_amount: newInstallment,
      updated_at: now,
      id,
    })
    db.prepare(`
      INSERT INTO salary_advance_topups (salary_advance_id, amount, date_issued, note, created_at)
      VALUES (@salary_advance_id, @amount, @date_issued, @note, @created_at)
    `).run({
      salary_advance_id: id,
      amount: input.amount,
      date_issued: input.date_issued,
      note: input.note || null,
      created_at: now,
    })
  })()

  return queryById(db, id)!
}

export function listSalaryAdvanceTopUps(db: Database.Database, id: number): SalaryAdvanceTopUp[] {
  return db.prepare(`
    SELECT * FROM salary_advance_topups
    WHERE salary_advance_id = ?
    ORDER BY date_issued ASC, id ASC
  `).all(id) as SalaryAdvanceTopUp[]
}

/**
 * Manually corrects an active advance's outstanding balance (and optionally its total
 * issued) to the values the admin states are correct, recording before/after and a
 * mandatory reason in salary_advance_adjustments.
 *
 * Unlike updateSalaryAdvance, the balance is set directly rather than shifted by the
 * amount's delta — this is the escape hatch for data that is already wrong, so it must
 * not derive the new balance from the (possibly wrong) current values.
 * A balance of 0 settles the advance, same as a final payroll deduction would.
 */
export function adjustSalaryAdvance(
  db: Database.Database,
  id: number,
  input: AdjustSalaryAdvanceInput,
): SalaryAdvance {
  const existing = queryById(db, id)
  if (!existing) throw new Error(`Salary advance with id ${id} not found`)
  if (existing.status !== 'active') {
    throw new Error(`Cannot adjust a ${existing.status} advance`)
  }

  const newAmount = input.amount ?? existing.amount
  const newBalance = input.balance_outstanding
  if (newBalance > newAmount) {
    throw new Error(
      `Balance outstanding (RM ${newBalance.toFixed(2)}) cannot exceed the total issued (RM ${newAmount.toFixed(2)})`,
    )
  }
  if (newAmount > existing.limit_max) {
    throw new Error(
      `Total issued (RM ${newAmount.toFixed(2)}) exceeds the approved limit of RM ${existing.limit_max.toFixed(2)} — ` +
      'raise the approved limit first',
    )
  }
  if (newBalance === existing.balance_outstanding && newAmount === existing.amount) {
    throw new Error('Nothing to adjust — the values are unchanged')
  }

  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`
      UPDATE salary_advances
      SET amount = @amount, balance_outstanding = @balance_outstanding, status = @status, updated_at = @updated_at
      WHERE id = @id
    `).run({
      amount: newAmount,
      balance_outstanding: newBalance,
      status: newBalance === 0 ? 'settled' : 'active',
      updated_at: now,
      id,
    })
    db.prepare(`
      INSERT INTO salary_advance_adjustments (
        salary_advance_id, balance_before, balance_after, amount_before, amount_after, reason, created_at
      ) VALUES (
        @salary_advance_id, @balance_before, @balance_after, @amount_before, @amount_after, @reason, @created_at
      )
    `).run({
      salary_advance_id: id,
      balance_before: existing.balance_outstanding,
      balance_after: newBalance,
      amount_before: existing.amount,
      amount_after: newAmount,
      reason: input.reason,
      created_at: now,
    })
  })()

  return queryById(db, id)!
}

export function listSalaryAdvanceAdjustments(db: Database.Database, id: number): SalaryAdvanceAdjustment[] {
  return db.prepare(`
    SELECT * FROM salary_advance_adjustments
    WHERE salary_advance_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(id) as SalaryAdvanceAdjustment[]
}

export function deleteSalaryAdvance(db: Database.Database, id: number): void {
  const existing = queryById(db, id)
  if (!existing) throw new Error(`Salary advance with id ${id} not found`)

  if (existing.status === 'active' && existing.balance_outstanding > 0) {
    throw new Error(
      'Cannot delete an active advance with outstanding balance. ' +
      'Mark it as cancelled instead, or settle it through a payroll run.'
    )
  }

  const result = db.prepare('DELETE FROM salary_advances WHERE id = ?').run(id)
  if (result.changes === 0) throw new Error(`Salary advance with id ${id} not found`)
}

/**
 * Applies a deduction to an advance's balance_outstanding.
 * Used internally by the payroll run orchestrator.
 * If balance reaches 0, status flips to 'settled'.
 * Returns the actual amount deducted (may be less than requested if balance is smaller).
 */
export function applyAdvanceDeduction(
  db: Database.Database,
  advanceId: number,
  amount: number,
): number {
  const advance = queryById(db, advanceId)
  if (!advance) throw new Error(`Salary advance with id ${advanceId} not found`)
  if (advance.status !== 'active') return 0

  const actualDeduction = Math.min(amount, advance.balance_outstanding)
  const newBalance = advance.balance_outstanding - actualDeduction
  const newStatus = newBalance <= 0 ? 'settled' : 'active'
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE salary_advances
    SET balance_outstanding = @balance_outstanding, status = @status, updated_at = @updated_at
    WHERE id = @id
  `).run({
    balance_outstanding: newBalance,
    status: newStatus,
    updated_at: now,
    id: advanceId,
  })

  return actualDeduction
}
