// Regression coverage for the 2026-08-18 late-detection fix.
// Bug: syncFromDeviceEthernet() had a blanket "punch date < sync date → force
// on-time" rule (M2), meant to protect against a drifted device clock. In
// practice any sync delayed by even one calendar day (the normal case — device
// syncs are manual/on-interval, not real-time) silently downgraded every
// genuinely-late historical punch to 'on-time'. Reported symptom: a 9:21 AM
// check-in (Morning shift, 08:00 start, 15 min grace → cutoff 08:15) synced the
// same day showed 'Late' correctly, while a 9:27 AM check-in on an earlier date
// — synced a day or more later — showed 'On Time', even though it was later
// (more late) than the correctly-flagged one. See CLAUDE.md decision log for
// the full writeup.
//
// This file covers the backfill correction (recomputeDeviceLogStatuses) that
// fixes already-corrupted rows left behind by the removed M2 rule. The insert
// path itself (syncFromDeviceEthernet) is not unit-tested here since it
// requires mocking the zkteco-js device transport.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { recomputeDeviceLogStatuses } from '../attendance'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, path.resolve(process.cwd(), 'electron/db/migrations'))
  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined, shift_id)
    VALUES (2, 'EMP002', 'Employee 2', '900101-01-1234', 1, 'active', '2020-01-01', 1)
  `).run()
  // Morning shift is seeded by 0009_leave_shifts_late.sql as id 1: 08:00-17:00.
  // Default grace period (payroll_settings.grace_period_minutes) is 15 min → cutoff 08:15.
  return db
}

describe('recomputeDeviceLogStatuses (backfill correction for the M2 blanket-historical bug)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  it('corrects a device-synced IN wrongly forced to on-time despite being past the grace cutoff', () => {
    db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
      VALUES (2, 'in', '2026-08-16T09:27:00', 'device', 1, 'on-time', datetime('now'), datetime('now'))
    `).run()

    const result = recomputeDeviceLogStatuses(db)

    expect(result).toEqual({ updated: 1, unchanged: 0, skippedClosedPeriod: 0 })
    const row = db.prepare('SELECT status FROM attendance_logs WHERE employee_id = 2').get() as { status: string }
    expect(row.status).toBe('late')
  })

  it('leaves an already-correct status untouched', () => {
    db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
      VALUES (2, 'in', '2026-08-17T09:21:00', 'device', 1, 'late', datetime('now'), datetime('now'))
    `).run()

    const result = recomputeDeviceLogStatuses(db)

    expect(result).toEqual({ updated: 0, unchanged: 1, skippedClosedPeriod: 0 })
  })

  it('never overrides a manually excused-late entry', () => {
    db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
      VALUES (2, 'in', '2026-08-16T09:27:00', 'device', 1, 'excused-late', datetime('now'), datetime('now'))
    `).run()

    const result = recomputeDeviceLogStatuses(db)

    expect(result).toEqual({ updated: 0, unchanged: 1, skippedClosedPeriod: 0 })
    const row = db.prepare('SELECT status FROM attendance_logs WHERE employee_id = 2').get() as { status: string }
    expect(row.status).toBe('excused-late')
  })

  it('skips rows inside a closed payroll period rather than rewriting them', () => {
    db.prepare(`
      INSERT INTO payroll_periods (name, start_date, end_date, status)
      VALUES ('August 2026', '2026-08-01', '2026-08-31', 'closed')
    `).run()
    db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
      VALUES (2, 'in', '2026-08-16T09:27:00', 'device', 1, 'on-time', datetime('now'), datetime('now'))
    `).run()

    const result = recomputeDeviceLogStatuses(db)

    expect(result).toEqual({ updated: 0, unchanged: 0, skippedClosedPeriod: 1 })
    const row = db.prepare('SELECT status FROM attendance_logs WHERE employee_id = 2').get() as { status: string }
    expect(row.status).toBe('on-time')
  })

  it('respects an explicit date range and ignores logs outside it', () => {
    db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
      VALUES (2, 'in', '2026-08-16T09:27:00', 'device', 1, 'on-time', datetime('now'), datetime('now'))
    `).run()
    db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
      VALUES (2, 'in', '2026-08-01T09:27:00', 'device', 1, 'on-time', datetime('now'), datetime('now'))
    `).run()

    const result = recomputeDeviceLogStatuses(db, '2026-08-15', '2026-08-20')

    expect(result).toEqual({ updated: 1, unchanged: 0, skippedClosedPeriod: 0 })
    const rows = db.prepare('SELECT timestamp, status FROM attendance_logs ORDER BY timestamp').all() as
      { timestamp: string; status: string }[]
    expect(rows.find((r) => r.timestamp.startsWith('2026-08-01'))?.status).toBe('on-time')
    expect(rows.find((r) => r.timestamp.startsWith('2026-08-16'))?.status).toBe('late')
  })

  it('ignores manual-source logs — createManualLog never had the M2 bug', () => {
    db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, shift_id, status, created_at, updated_at)
      VALUES (2, 'in', '2026-08-16T09:27:00', 'manual', 1, 'on-time', datetime('now'), datetime('now'))
    `).run()

    const result = recomputeDeviceLogStatuses(db)

    expect(result).toEqual({ updated: 0, unchanged: 0, skippedClosedPeriod: 0 })
  })
})
