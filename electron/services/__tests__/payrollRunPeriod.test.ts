// Regression for the 2026-08-26 bug report: calculatePayrollRun() summed attendance
// hours by plain calendar month instead of the payroll period's real date range, so a
// period spanning two calendar months (e.g. 26 Jul - 25 Aug) silently dropped the days
// that fell in the earlier month. Migration 0020 links payroll_runs to payroll_periods
// and calculatePayrollRun() now uses the linked period's start_date/end_date directly.
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { runMigrations } from '../../db/migrate'
import {
  createPayrollRun,
  calculatePayrollRun,
  finalizePayrollRun,
  unfinalizePayrollRun,
  getPayrollRunItems,
  getPayrollRunById,
} from '../payroll/payrollRun'

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

function seedEmployeeAndStructure(db: Database.Database): void {
  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined)
    VALUES (1, 'EMP001', 'Alice', '900101-01-0001', 1, 'active', '2020-01-01')
  `).run()
  db.prepare(`
    INSERT INTO salary_structures (
      id, employee_id, effective_from, rate_type, rate_amount,
      standard_hours_per_day, subject_to_epf, subject_to_socso, subject_to_eis
    ) VALUES (1, 1, '2020-01-01', 'hourly', 10, 8, 0, 0, 0)
  `).run()
}

/** Seed one daily_attendance_record per date in [startDate, endDate] with fixed hours. */
function seedDailyRecords(
  db: Database.Database,
  payrollPeriodId: number,
  dates: string[],
  regularHours: number,
  otHours: number,
): void {
  const insert = db.prepare(`
    INSERT INTO daily_attendance_records (
      employee_id, date, payroll_period_id, calendar_type, attendance_status,
      regular_hours, ot_hours
    ) VALUES (1, @date, @payroll_period_id, 'working_day', 'present', @regular_hours, @ot_hours)
  `)
  for (const date of dates) {
    insert.run({ date, payroll_period_id: payrollPeriodId, regular_hours: regularHours, ot_hours: otHours })
  }
}

function julyAndAugustDates(): string[] {
  const dates: string[] = []
  for (let d = 26; d <= 31; d++) dates.push(`2026-07-${d}`)
  for (let d = 1; d <= 25; d++) dates.push(`2026-08-${String(d).padStart(2, '0')}`)
  return dates
}

describe('payroll run linked to payroll period (migration 0020)', () => {
  it('sums attendance hours across the full period range, not just the run\'s calendar month', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    // Fresh install: apply every migration, including 0020, from scratch.
    runMigrations(db, migrationsDir)

    seedEmployeeAndStructure(db)

    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (1, '26 Jul - 25 Aug', '2026-07-26', '2026-08-25', 'processing')
    `).run()

    // 6 days in July (26-31) + 25 days in August (1-25) = 31 days, 8h regular each = 248h regular.
    seedDailyRecords(db, 1, julyAndAugustDates(), 8, 0)

    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    expect(run.payroll_period_id).toBe(1)
    expect(run.year).toBe(2026)
    expect(run.month).toBe(8) // derived from period.end_date, display label only

    calculatePayrollRun(db, run.id)
    const items = getPayrollRunItems(db, run.id)
    expect(items).toHaveLength(1)

    // The bug: querying by calendar month alone would only pick up the 25 August days
    // (25 * 8 = 200h), silently dropping the 6 July days (48h).
    expect(items[0].total_regular_hours).toBe(31 * 8)
    expect(items[0].total_regular_hours).not.toBe(25 * 8)
  })

  it('backfills a legacy year/month-only run onto its period when the match is unambiguous', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    // Simulate an existing install that already has a pre-0020 payroll run.
    applyUpTo(db, '0019_break_limit.sql')
    seedEmployeeAndStructure(db)
    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (1, '26 Jul - 25 Aug', '2026-07-26', '2026-08-25', 'processing')
    `).run()
    db.prepare(`
      INSERT INTO payroll_runs (id, year, month, status, run_date)
      VALUES (1, 2026, 8, 'draft', '2026-08-25')
    `).run()

    runMigrations(db, migrationsDir) // applies 0020+

    const run = getPayrollRunById(db, 1)
    expect(run?.payroll_period_id).toBe(1)

    seedDailyRecords(db, 1, julyAndAugustDates(), 8, 0)
    calculatePayrollRun(db, 1)
    const items = getPayrollRunItems(db, 1)
    expect(items[0].total_regular_hours).toBe(31 * 8)
  })

  it('does not backfill when two periods end in the same calendar month, and refuses to calculate the orphaned run', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    applyUpTo(db, '0019_break_limit.sql')
    seedEmployeeAndStructure(db)
    // Two semi-monthly periods both ending in August.
    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (1, '1-15 Aug', '2026-08-01', '2026-08-15', 'processing')
    `).run()
    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (2, '16-31 Aug', '2026-08-16', '2026-08-31', 'processing')
    `).run()
    db.prepare(`
      INSERT INTO payroll_runs (id, year, month, status, run_date)
      VALUES (1, 2026, 8, 'draft', '2026-08-31')
    `).run()

    runMigrations(db, migrationsDir)

    const run = getPayrollRunById(db, 1)
    expect(run?.payroll_period_id).toBeNull()

    expect(() => calculatePayrollRun(db, 1)).toThrow(/predates Payroll Periods/)
  })
})

describe('unfinalizePayrollRun — reverting a finalized run computed with the calendar-month bug', () => {
  function seedPcbBracket(db: Database.Database): void {
    db.prepare(`
      INSERT INTO pcb_brackets (effective_from, category, children_count, chargeable_income_from, chargeable_income_to, tax_amount)
      VALUES ('2020-01-01', 'single', 0, 0, 100000, 0)
    `).run()
  }

  it('reverts status to draft and does not touch salary_advances when nothing was deducted', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    runMigrations(db, migrationsDir)
    seedEmployeeAndStructure(db)
    seedPcbBracket(db)

    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (1, '26 Jul - 25 Aug', '2026-07-26', '2026-08-25', 'processing')
    `).run()
    seedDailyRecords(db, 1, julyAndAugustDates(), 8, 0)

    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    calculatePayrollRun(db, run.id)
    finalizePayrollRun(db, run.id)

    expect(getPayrollRunById(db, run.id)?.status).toBe('finalized')

    const result = unfinalizePayrollRun(db, run.id)
    expect(result.run.status).toBe('draft')
    expect(result.advancesToVerify).toHaveLength(0)

    // Recalculate now works again, and picks up the full period (no longer blocked
    // by the 'finalized' guard).
    calculatePayrollRun(db, run.id)
    const items = getPayrollRunItems(db, run.id)
    expect(items[0].total_regular_hours).toBe(31 * 8)
  })

  it('lists affected employees instead of guessing which advance to credit back', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    runMigrations(db, migrationsDir)
    seedEmployeeAndStructure(db)
    seedPcbBracket(db)

    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (1, '26 Jul - 25 Aug', '2026-07-26', '2026-08-25', 'processing')
    `).run()
    seedDailyRecords(db, 1, julyAndAugustDates(), 8, 0)
    db.prepare(`
      INSERT INTO salary_advances (id, employee_id, amount, date_issued, limit_max, balance_outstanding, status, deduction_mode)
      VALUES (1, 1, 200, '2026-07-01', 200, 200, 'active', 'full_balance')
    `).run()

    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })
    calculatePayrollRun(db, run.id)
    finalizePayrollRun(db, run.id)

    // Finalize actually applied the deduction — the advance is now settled.
    const advanceAfterFinalize = db.prepare('SELECT status, balance_outstanding FROM salary_advances WHERE id = 1')
      .get() as { status: string; balance_outstanding: number }
    expect(advanceAfterFinalize).toEqual({ status: 'settled', balance_outstanding: 0 })

    const result = unfinalizePayrollRun(db, run.id)
    expect(result.run.status).toBe('draft')
    expect(result.advancesToVerify).toEqual([{ employee_id: 1, employee_name: 'Alice', amount: 200 }])

    // The advance balance is untouched by unfinalize — flagged for manual review instead.
    const advanceAfterUnfinalize = db.prepare('SELECT status, balance_outstanding FROM salary_advances WHERE id = 1')
      .get() as { status: string; balance_outstanding: number }
    expect(advanceAfterUnfinalize).toEqual(advanceAfterFinalize)
  })

  it('refuses to unfinalize a run that is still draft', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    runMigrations(db, migrationsDir)
    seedEmployeeAndStructure(db)

    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (1, '26 Jul - 25 Aug', '2026-07-26', '2026-08-25', 'processing')
    `).run()
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: '2026-08-26' })

    expect(() => unfinalizePayrollRun(db, run.id)).toThrow(/Only a finalized payroll run/)
  })
})
