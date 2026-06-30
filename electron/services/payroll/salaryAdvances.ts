// Salary Advance service — CRUD + active balance tracking.
// Handles per-advance deduction terms (full_balance vs fixed_installment).
// The deduction logic for a payroll run is in the orchestrator, not here —
// this file keeps advance CRUD and balance queries.

import type Database from 'better-sqlite3'
import type { SalaryAdvance } from '../../../src/shared/types/entities'
import type { CreateSalaryAdvanceInput, UpdateSalaryAdvanceInput } from '../../../src/shared/types/inputs'

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
  const merged = {
    employee_id: input.employee_id ?? existing.employee_id,
    amount: input.amount ?? existing.amount,
    date_issued: input.date_issued ?? existing.date_issued,
    limit_max: input.limit_max ?? existing.limit_max,
    // balance_outstanding is never reset by edits — it tracks repayments made through
    // payroll runs and is only mutated by applyAdvanceDeduction / status transitions.
    // Resetting it here would silently erase partial repayments already applied.
    balance_outstanding: existing.balance_outstanding,
    deduction_mode: input.deduction_mode ?? existing.deduction_mode,
    installment_amount: input.installment_amount !== undefined ? input.installment_amount : existing.installment_amount,
  }

  if (merged.deduction_mode === 'fixed_installment' && !merged.installment_amount) {
    throw new Error('installment_amount is required when deduction_mode is fixed_installment')
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
