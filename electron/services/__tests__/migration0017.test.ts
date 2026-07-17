// Regression: 0.2.10 startup crash on migration 0017 when payroll_run_items
// already references salary_structures. DROP TABLE salary_structures fails with
// "FOREIGN KEY constraint failed" under PRAGMA foreign_keys=ON whenever child
// rows exist. The migration runner must temporarily disable FKs for table
// recreates (toggle must be outside the migration transaction — SQLite ignores
// PRAGMA foreign_keys changes inside a transaction).
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { runMigrations } from '../../db/migrate'

const migrationsDir = path.resolve(process.cwd(), 'electron/db/migrations')

function applyUpTo(db: Database.Database, lastFilename: string): void {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    if (file > lastFilename) break
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    // Mirror the runner's FK-off pattern so pre-0017 setup can also recreate tables if needed
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(sql)
        db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(file)
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }
}

function seedPayrollReferencingStructure(db: Database.Database): void {
  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined)
    VALUES (1, 'EMP001', 'Alice', '900101-01-0001', 1, 'active', '2020-01-01')
  `).run()
  db.prepare(`
    INSERT INTO salary_structures (
      id, employee_id, effective_from, rate_type, rate_amount,
      standard_hours_per_day, subject_to_epf, subject_to_socso, subject_to_eis
    ) VALUES (1, 1, '2026-01-01', 'daily', 100, 8, 1, 1, 1)
  `).run()
  db.prepare(`
    INSERT INTO payroll_runs (id, year, month, status, run_date)
    VALUES (1, 2026, 6, 'draft', '2026-06-30')
  `).run()
  db.prepare(`
    INSERT INTO payroll_run_items (
      payroll_run_id, employee_id, salary_structure_id,
      snapshot_rate_type, snapshot_rate_amount, snapshot_standard_hours_per_day,
      snapshot_subject_to_epf, snapshot_subject_to_socso, snapshot_subject_to_eis
    ) VALUES (1, 1, 1, 'daily', 100, 8, 1, 1, 1)
  `).run()
}

describe('migration 0017 — salary_structures recreate with payroll_run_items FKs', () => {
  it('applies cleanly when payroll_run_items already references a salary structure', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    applyUpTo(db, '0016_leave_entitlement_defaults.sql')
    seedPayrollReferencingStructure(db)

    // Sanity: the old DROP-with-FKs-on failure mode still exists if we try it raw
    try {
      db.exec('DROP TABLE salary_structures')
      throw new Error('expected DROP to fail with FKs ON while child rows exist')
    } catch (e) {
      expect((e as Error).message).toMatch(/FOREIGN KEY/i)
    }

    // Runner applies 0017 (and any later files) with the FK-off window
    const applied = runMigrations(db, migrationsDir)
    expect(applied).toContain('0017_fixed_monthly_salary.sql')

    // Data preserved, monthly CHECK accepts 'monthly', FK still enforceable
    const structure = db
      .prepare('SELECT id, rate_type, rate_amount, pcb_category FROM salary_structures WHERE id = 1')
      .get() as { id: number; rate_type: string; rate_amount: number; pcb_category: string }
    expect(structure).toEqual({
      id: 1,
      rate_type: 'daily',
      rate_amount: 100,
      pcb_category: 'single',
    })

    const item = db
      .prepare('SELECT salary_structure_id FROM payroll_run_items WHERE id = 1')
      .get() as { salary_structure_id: number }
    expect(item.salary_structure_id).toBe(1)

    // monthly is now a valid rate_type
    db.prepare(`
      INSERT INTO salary_structures (
        employee_id, effective_from, rate_type, rate_amount,
        standard_hours_per_day, subject_to_epf, subject_to_socso, subject_to_eis
      ) VALUES (1, '2026-07-01', 'monthly', 1700, 8, 1, 1, 1)
    `).run()

    // FK still enforced after migration
    expect(() =>
      db.prepare(`
        INSERT INTO payroll_run_items (
          payroll_run_id, employee_id, salary_structure_id,
          snapshot_rate_type, snapshot_rate_amount, snapshot_standard_hours_per_day,
          snapshot_subject_to_epf, snapshot_subject_to_socso, snapshot_subject_to_eis
        ) VALUES (1, 1, 9999, 'daily', 100, 8, 1, 1, 1)
      `).run(),
    ).toThrow(/FOREIGN KEY/i)

    db.close()
  })
})
