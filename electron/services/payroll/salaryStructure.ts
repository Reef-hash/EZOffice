// Salary Structure service — CRUD for salary_structures.
// One employee can have multiple structures over time (effective-dated).
// "Current" = the single most recent structure whose effective_from ≤ today.

import type Database from 'better-sqlite3'
import type { SalaryStructure } from '../../../src/shared/types/entities'
import type { CreateSalaryStructureInput, UpdateSalaryStructureInput } from '../../../src/shared/types/inputs'

// ── Shared helpers ───────────────────────────────────────

function queryById(db: Database.Database, id: number): SalaryStructure | null {
  const row = db.prepare(`
    SELECT s.*, e.name AS employee_name
    FROM salary_structures s
    LEFT JOIN employees e ON e.id = s.employee_id
    WHERE s.id = ?
  `).get(id) as SalaryStructure | undefined
  return row ?? null
}

// ── Query functions ──────────────────────────────────────

export function listSalaryStructures(
  db: Database.Database,
  employeeId?: number,
): SalaryStructure[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (employeeId) {
    conditions.push('s.employee_id = @employeeId')
    params.employeeId = employeeId
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db.prepare(`
    SELECT s.*, e.name AS employee_name
    FROM salary_structures s
    LEFT JOIN employees e ON e.id = s.employee_id
    ${where}
    ORDER BY s.employee_id, s.effective_from DESC
  `).all(params) as SalaryStructure[]
}

export function getSalaryStructureById(db: Database.Database, id: number): SalaryStructure | null {
  return queryById(db, id)
}

/**
 * Returns the single most recent salary structure for an employee
 * whose effective_from is ≤ asOfDate (defaults to today).
 */
export function getCurrentSalaryStructure(
  db: Database.Database,
  employeeId: number,
  asOfDate?: string,
): SalaryStructure | null {
  const date = asOfDate ?? new Date().toISOString().split('T')[0]
  const row = db.prepare(`
    SELECT s.*, e.name AS employee_name
    FROM salary_structures s
    LEFT JOIN employees e ON e.id = s.employee_id
    WHERE s.employee_id = ? AND s.effective_from <= ?
    ORDER BY s.effective_from DESC
    LIMIT 1
  `).get(employeeId, date) as SalaryStructure | undefined
  return row ?? null
}

// ── CRUD ─────────────────────────────────────────────────

export function createSalaryStructure(
  db: Database.Database,
  input: CreateSalaryStructureInput,
): SalaryStructure {
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO salary_structures (
      employee_id, effective_from, rate_type, rate_amount,
      standard_hours_per_day, subject_to_epf, subject_to_socso, subject_to_eis,
      pcb_category, pcb_children_count,
      created_at, updated_at
    ) VALUES (
      @employee_id, @effective_from, @rate_type, @rate_amount,
      @standard_hours_per_day, @subject_to_epf, @subject_to_socso, @subject_to_eis,
      @pcb_category, @pcb_children_count,
      @created_at, @updated_at
    )
  `).run({
    employee_id: input.employee_id,
    effective_from: input.effective_from,
    rate_type: input.rate_type,
    rate_amount: input.rate_amount,
    standard_hours_per_day: input.standard_hours_per_day,
    subject_to_epf: input.subject_to_epf,
    subject_to_socso: input.subject_to_socso,
    subject_to_eis: input.subject_to_eis,
    pcb_category: input.pcb_category,
    pcb_children_count: input.pcb_children_count,
    created_at: now,
    updated_at: now,
  })

  return queryById(db, result.lastInsertRowid as number)!
}

export function updateSalaryStructure(
  db: Database.Database,
  id: number,
  input: UpdateSalaryStructureInput,
): SalaryStructure {
  const existing = queryById(db, id)
  if (!existing) {
    throw new Error(`Salary structure with id ${id} not found`)
  }

  const now = new Date().toISOString()
  const merged = {
    employee_id: input.employee_id ?? existing.employee_id,
    effective_from: input.effective_from ?? existing.effective_from,
    rate_type: input.rate_type ?? existing.rate_type,
    rate_amount: input.rate_amount ?? existing.rate_amount,
    standard_hours_per_day: input.standard_hours_per_day ?? existing.standard_hours_per_day,
    subject_to_epf: input.subject_to_epf ?? existing.subject_to_epf,
    subject_to_socso: input.subject_to_socso ?? existing.subject_to_socso,
    subject_to_eis: input.subject_to_eis ?? existing.subject_to_eis,
    pcb_category: input.pcb_category ?? existing.pcb_category,
    pcb_children_count: input.pcb_children_count ?? existing.pcb_children_count,
  }

  db.prepare(`
    UPDATE salary_structures
    SET employee_id = @employee_id,
        effective_from = @effective_from,
        rate_type = @rate_type,
        rate_amount = @rate_amount,
        standard_hours_per_day = @standard_hours_per_day,
        subject_to_epf = @subject_to_epf,
        subject_to_socso = @subject_to_socso,
        subject_to_eis = @subject_to_eis,
        pcb_category = @pcb_category,
        pcb_children_count = @pcb_children_count,
        updated_at = @updated_at
    WHERE id = @id
  `).run({ ...merged, updated_at: now, id })

  return queryById(db, id)!
}

export function deleteSalaryStructure(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM salary_structures WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Salary structure with id ${id} not found`)
  }
}
