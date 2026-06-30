// Employee service — CRUD + CSV bulk import.
// All queries use prepared statements. Every multi-row write is transactional.

import type Database from 'better-sqlite3'
import type { Employee } from '../../../src/shared/types/entities'
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
  CsvEmployeeRow,
  CsvImportResult,
} from '../../../src/shared/types/inputs'
import { EMPLOYEE_STATUS } from '../../../src/shared/types/entities'

export function listEmployees(db: Database.Database): Employee[] {
  return db
    .prepare(
      `SELECT e.*, d.name AS department_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       ORDER BY e.name ASC`,
    )
    .all() as Employee[]
}

export function getEmployeeById(db: Database.Database, id: number): Employee | null {
  const row = db
    .prepare(
      `SELECT e.*, d.name AS department_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE e.id = ?`,
    )
    .get(id) as Employee | undefined
  return row ?? null
}

export function createEmployee(db: Database.Database, input: CreateEmployeeInput): Employee {
  const now = new Date().toISOString()
  const stmt = db.prepare(
    `INSERT INTO employees (employee_code, name, ic_number, phone, email, department_id, position, status, date_joined, created_at, updated_at)
     VALUES (@employee_code, @name, @ic_number, @phone, @email, @department_id, @position, @status, @date_joined, @created_at, @updated_at)`,
  )

  const result = stmt.run({
    employee_code: input.employee_code,
    name: input.name,
    ic_number: input.ic_number,
    phone: input.phone ?? null,
    email: input.email || null,
    department_id: input.department_id ?? null,
    position: input.position ?? null,
    status: input.status ?? EMPLOYEE_STATUS.ACTIVE,
    date_joined: input.date_joined,
    created_at: now,
    updated_at: now,
  })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getEmployeeById(db, result.lastInsertRowid as number)!
}

export function updateEmployee(
  db: Database.Database,
  id: number,
  input: UpdateEmployeeInput,
): Employee {
  const existing = getEmployeeById(db, id)
  if (!existing) {
    throw new Error(`Employee with id ${id} not found`)
  }

  const now = new Date().toISOString()
  const merged = {
    employee_code: input.employee_code ?? existing.employee_code,
    name: input.name ?? existing.name,
    ic_number: input.ic_number ?? existing.ic_number,
    phone: input.phone !== undefined ? input.phone : existing.phone,
    email: input.email !== undefined ? (input.email || null) : existing.email,
    department_id: input.department_id !== undefined ? input.department_id : existing.department_id,
    position: input.position !== undefined ? input.position : existing.position,
    status: input.status ?? existing.status,
    date_joined: input.date_joined ?? existing.date_joined,
  }

  db.prepare(
    `UPDATE employees
     SET employee_code = @employee_code,
         name = @name,
         ic_number = @ic_number,
         phone = @phone,
         email = @email,
         department_id = @department_id,
         position = @position,
         status = @status,
         date_joined = @date_joined,
         updated_at = @updated_at
     WHERE id = @id`,
  ).run({ ...merged, updated_at: now, id })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getEmployeeById(db, id)!
}

export function deleteEmployee(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM employees WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Employee with id ${id} not found`)
  }
}

/**
 * Bulk CSV import — wrapped in a single transaction.
 * Partial writes are NOT acceptable (Claude.md §4).
 * Each row is validated; invalid rows are collected as errors but do not abort the transaction.
 */
export function importEmployeesCsv(
  db: Database.Database,
  rows: CsvEmployeeRow[],
): CsvImportResult {
  const errors: Array<{ row: number; message: string }> = []
  const validRows: Array<CsvEmployeeRow & { department_id: number | null }> = []

  // Resolve department names to IDs
  const deptStmt = db.prepare('SELECT id FROM departments WHERE name = ?')

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // +2 because row 1 is header, and we want 1-indexed display

    if (!row.employee_code || !row.name || !row.ic_number || !row.date_joined) {
      errors.push({ row: rowNum, message: 'Missing required field (employee_code, name, ic_number, date_joined)' })
      continue
    }

    let department_id: number | null = null
    if (row.department_name) {
      const dept = deptStmt.get(row.department_name) as { id: number } | undefined
      if (!dept) {
        errors.push({ row: rowNum, message: `Department "${row.department_name}" not found — create it first` })
        continue
      }
      department_id = dept.id
    }

    validRows.push({ ...row, department_id })
  }

  if (validRows.length === 0) {
    return { imported: 0, errors }
  }

  let imported = 0

  // Single transaction for the entire import
  const importAll = db.transaction(() => {
    const insertStmt = db.prepare(
      `INSERT OR IGNORE INTO employees (employee_code, name, ic_number, phone, email, department_id, position, status, date_joined, created_at, updated_at)
       VALUES (@employee_code, @name, @ic_number, @phone, @email, @department_id, @position, 'active', @date_joined, @created_at, @updated_at)`,
    )

    const now = new Date().toISOString()

    for (const row of validRows) {
      const result = insertStmt.run({
        employee_code: row.employee_code,
        name: row.name,
        ic_number: row.ic_number,
        phone: row.phone || null,
        email: row.email || null,
        department_id: row.department_id,
        position: row.position || null,
        date_joined: row.date_joined,
        created_at: now,
        updated_at: now,
      })
      if (result.changes > 0) {
        imported++
      } else {
        // INSERT OR IGNORE skipped this row — likely duplicate employee_code or ic_number
        errors.push({
          row: rows.indexOf(row) + 2,
          message: `Duplicate employee_code "${row.employee_code}" or ic_number "${row.ic_number}" — skipped`,
        })
      }
    }
  })

  importAll()
  return { imported, errors }
}
