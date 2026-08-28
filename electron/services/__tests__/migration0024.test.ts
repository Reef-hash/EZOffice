// Regression coverage for migration 0024 (commission-only payroll + separate
// pay-schedule), which builds on top of migrations 0020-0023 (payroll_runs linked to
// payroll_periods, rest-day/holiday pay, monthly attendance gating, EPF wage base
// snapshot — see the 2026-08-26/2026-08-27 CLAUDE.md entries). Both salary_structures
// and payroll_runs are RECREATED tables (rate_type CHECK widened; UNIQUE(payroll_period_id)
// -> UNIQUE(payroll_period_id, pay_group)). Table recreates in this codebase have
// twice previously broken upgrades for installs with pre-existing rows (0.2.9
// positional SELECT * bug, 0.2.10 FK-drop failure) — this test seeds pre-existing
// rows referencing both tables the same way a real customer DB would, then verifies
// 0020-0024 together preserve everything, including carrying attendance_required
// (added by 0022) forward through the salary_structures recreate in 0024.
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

function seedPreExistingPayrollData(db: Database.Database): void {
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
    VALUES (1, 2026, 6, 'finalized', '2026-06-30')
  `).run()
  db.prepare(`
    INSERT INTO payroll_run_items (
      payroll_run_id, employee_id, salary_structure_id,
      snapshot_rate_type, snapshot_rate_amount, snapshot_standard_hours_per_day,
      snapshot_subject_to_epf, snapshot_subject_to_socso, snapshot_subject_to_eis,
      gross_pay, net_pay
    ) VALUES (1, 1, 1, 'daily', 100, 8, 1, 1, 1, 2000, 1800)
  `).run()
  db.prepare(`
    INSERT INTO payroll_run_commissions (payroll_run_id, employee_id, amount)
    VALUES (1, 1, 250)
  `).run()
}

describe('migration 0024 — commission-only payroll on top of 0020-0023', () => {
  it('preserves pre-existing salary_structures and payroll_runs rows through all migrations', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    applyUpTo(db, '0019_break_limit.sql')
    seedPreExistingPayrollData(db)

    const applied = runMigrations(db, migrationsDir)
    expect(applied).toContain('0020_link_payroll_run_to_period.sql')
    expect(applied).toContain('0022_monthly_attendance_gate.sql')
    expect(applied).toContain('0024_commission_only_payroll.sql')

    // salary_structures row preserved with correct values in the correct columns
    // (named-column copy — not a positional SELECT * that could shift values, per
    // the 0.2.9 incident) — including attendance_required (added by 0022) carried
    // forward through the 0024 recreate, defaulting to 0 rather than being dropped.
    const structure = db
      .prepare('SELECT rate_type, rate_amount, pcb_category, pcb_children_count, attendance_required FROM salary_structures WHERE id = 1')
      .get() as { rate_type: string; rate_amount: number; pcb_category: string; pcb_children_count: number; attendance_required: number }
    expect(structure).toEqual({ rate_type: 'daily', rate_amount: 100, pcb_category: 'single', pcb_children_count: 0, attendance_required: 0 })

    // payroll_runs row preserved through both recreates: payroll_period_id stays
    // NULL (no payroll_periods row exists to unambiguously backfill onto — 0020's
    // own behavior), pay_group/pay_date backfilled by 0024.
    const run = db
      .prepare('SELECT payroll_period_id, year, month, status, run_date, pay_group, pay_date FROM payroll_runs WHERE id = 1')
      .get() as { payroll_period_id: number | null; year: number; month: number; status: string; run_date: string; pay_group: string; pay_date: string }
    expect(run.payroll_period_id).toBeNull()
    expect(run.pay_group).toBe('attendance')
    expect(run.pay_date).toBe(run.run_date)
    expect(run.status).toBe('finalized')

    // FKs from payroll_run_items / payroll_run_commissions still resolve correctly.
    // epf_wage_base (added by 0023, reused rather than duplicated by 0024) defaults
    // to 0 for historical rows never recalculated.
    const item = db.prepare('SELECT salary_structure_id, epf_wage_base FROM payroll_run_items WHERE payroll_run_id = 1').get() as
      { salary_structure_id: number; epf_wage_base: number }
    expect(item.salary_structure_id).toBe(1)
    expect(item.epf_wage_base).toBe(0)

    const commission = db.prepare('SELECT amount, statutory_base_override FROM payroll_run_commissions WHERE payroll_run_id = 1').get() as
      { amount: number; statutory_base_override: number | null }
    expect(commission.amount).toBe(250)
    expect(commission.statutory_base_override).toBeNull()
  })

  it('accepts commission_only rate_type and allows two runs for the same payroll period with different pay_group', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db, migrationsDir)

    db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
    db.prepare(`
      INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined)
      VALUES (1, 'EMP001', 'Alice', '900101-01-0001', 1, 'active', '2020-01-01')
    `).run()
    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (1, 'August 2026', '2026-07-26', '2026-08-25', 'finalized')
    `).run()

    expect(() =>
      db.prepare(`
        INSERT INTO salary_structures (employee_id, effective_from, rate_type, rate_amount)
        VALUES (1, '2026-01-01', 'commission_only', 1700)
      `).run(),
    ).not.toThrow()

    db.prepare(`
      INSERT INTO payroll_runs (payroll_period_id, year, month, status, run_date, pay_group, pay_date)
      VALUES (1, 2026, 8, 'draft', '2026-08-26', 'attendance', '2026-08-26')
    `).run()

    expect(() =>
      db.prepare(`
        INSERT INTO payroll_runs (payroll_period_id, year, month, status, run_date, pay_group, pay_date)
        VALUES (1, 2026, 8, 'draft', '2026-08-26', 'commission_only', '2026-09-01')
      `).run(),
    ).not.toThrow()

    expect(() =>
      db.prepare(`
        INSERT INTO payroll_runs (payroll_period_id, year, month, status, run_date, pay_group, pay_date)
        VALUES (1, 2026, 8, 'draft', '2026-08-26', 'attendance', '2026-08-26')
      `).run(),
    ).toThrow(/UNIQUE/)
  })
})


