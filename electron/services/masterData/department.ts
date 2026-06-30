// Department service — list + create for dropdown usage.

import type Database from 'better-sqlite3'
import type { Department } from '../../../src/shared/types/entities'
import type { CreateDepartmentInput } from '../../../src/shared/types/inputs'

export function listDepartments(db: Database.Database): Department[] {
  return db
    .prepare('SELECT * FROM departments ORDER BY name ASC')
    .all() as Department[]
}

export function createDepartment(db: Database.Database, input: CreateDepartmentInput): Department {
  const now = new Date().toISOString()
  const stmt = db.prepare(
    `INSERT INTO departments (name, created_at, updated_at)
     VALUES (@name, @created_at, @updated_at)`,
  )

  const result = stmt.run({
    name: input.name,
    created_at: now,
    updated_at: now,
  })

  const row = db.prepare('SELECT * FROM departments WHERE id = ?').get(result.lastInsertRowid) as Department
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return row!
}
