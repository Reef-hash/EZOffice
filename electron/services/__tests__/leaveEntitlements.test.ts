// Coverage for the 2026-07-15 leave entitlement configuration feature: company-wide
// defaults (payroll_settings.default_annual_leave_days/default_sick_leave_days),
// per-employee overrides (upsertLeaveEntitlement), and the yearly rollover
// (initializeYearlyLeaveEntitlements) that never clobbers an existing balance row.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import {
  listLeaveEntitlements,
  upsertLeaveEntitlement,
  initializeYearlyLeaveEntitlements,
  getEmployeeLeaveBalance,
} from '../attendance'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, path.resolve(process.cwd(), 'electron/db/migrations'))
  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined)
    VALUES
      (1, 'EMP001', 'Ali', '900101-01-0001', 1, 'active', '2020-01-01'),
      (2, 'EMP002', 'Siti', '900101-01-0002', 1, 'active', '2020-01-01'),
      (3, 'EMP003', 'Inactive Staff', '900101-01-0003', 1, 'inactive', '2020-01-01')
  `).run()
  return db
}

describe('leave entitlement defaults + per-employee overrides', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  it('payroll_settings seeds a default of 14/14 days', () => {
    const row = db.prepare('SELECT default_annual_leave_days, default_sick_leave_days FROM payroll_settings WHERE id = 1').get() as
      { default_annual_leave_days: number; default_sick_leave_days: number }
    expect(row.default_annual_leave_days).toBe(14)
    expect(row.default_sick_leave_days).toBe(14)
  })

  it('listLeaveEntitlements shows null balances for employees with no row yet, and skips inactive employees', () => {
    const rows = listLeaveEntitlements(db, 2026)
    expect(rows.length).toBe(2) // only the 2 active employees
    expect(rows.every((r) => r.annual_balance === null && r.sick_balance === null)).toBe(true)
  })

  it('initializeYearlyLeaveEntitlements applies the configured defaults to every active employee', () => {
    db.prepare('UPDATE payroll_settings SET default_annual_leave_days = 16, default_sick_leave_days = 18 WHERE id = 1').run()

    const result = initializeYearlyLeaveEntitlements(db, 2026)
    expect(result.created).toBe(4) // 2 active employees x 2 leave types
    expect(result.skipped).toBe(0)

    const rows = listLeaveEntitlements(db, 2026)
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.annual_balance).toBe(16)
      expect(row.sick_balance).toBe(18)
    }

    const balance = getEmployeeLeaveBalance(db, 1, 2026)
    expect(balance.annual).toBe(16)
    expect(balance.sick).toBe(18)
  })

  it('initializeYearlyLeaveEntitlements never overwrites an existing row (manual override or prior run)', () => {
    // Admin manually sets employee 1's annual balance to 20 (e.g. senior staff) before initializing.
    upsertLeaveEntitlement(db, { employee_id: 1, leave_type: 'annual', year: 2026, balance: 20 })

    const result = initializeYearlyLeaveEntitlements(db, 2026)
    // employee 1's annual row already existed -> skipped; the other 3 rows (emp1 sick, emp2 annual+sick) created.
    expect(result.created).toBe(3)
    expect(result.skipped).toBe(1)

    const balance = getEmployeeLeaveBalance(db, 1, 2026)
    expect(balance.annual).toBe(20) // untouched by initialize
    expect(balance.sick).toBe(14) // filled in by initialize using the default

    // Running it again is a no-op (fully idempotent).
    const second = initializeYearlyLeaveEntitlements(db, 2026)
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(4)
  })

  it('upsertLeaveEntitlement updates an existing balance in place (ON CONFLICT), not a duplicate row', () => {
    upsertLeaveEntitlement(db, { employee_id: 2, leave_type: 'sick', year: 2026, balance: 10 })
    upsertLeaveEntitlement(db, { employee_id: 2, leave_type: 'sick', year: 2026, balance: 12 })

    const count = db.prepare(`
      SELECT COUNT(*) AS cnt FROM employee_leave_entitlements WHERE employee_id = 2 AND leave_type = 'sick' AND year = 2026
    `).get() as { cnt: number }
    expect(count.cnt).toBe(1)

    const balance = getEmployeeLeaveBalance(db, 2, 2026)
    expect(balance.sick).toBe(12)
  })
})
