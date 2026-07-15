// Regression coverage for the 2026-07-15 manual-backfill/date-conflict fix.
// Bug: assertAlternation() validated new punches against getLastLogForEmployee()
// (the globally most recent punch), instead of the punch chronologically adjacent
// to the new entry's own timestamp. This made it impossible to backfill earlier
// dates (e.g. days 1-13 of a month) once device sync or later manual entries had
// already populated later dates — every backfilled punch was wrongly compared
// against unrelated future data. See CLAUDE.md decision log for the full writeup.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import {
  createManualLog,
  updateAttendanceLog,
  deleteAttendanceLog,
  listAttendanceLogs,
  getLastLogForEmployee,
} from '../attendance'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, path.resolve(process.cwd(), 'electron/db/migrations'))
  db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
  db.prepare(`
    INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined, device_user_id)
    VALUES (2, 'EMP002', 'Employee 2', '900101-01-1234', 1, 'active', '2020-01-01', '2')
  `).run()
  return db
}

describe('manual backfill against pre-existing later (device-synced) data', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
    // Device sync already populated day 14 onward before any manual backfill happens.
    db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
      VALUES (2, 'in', '2026-07-14T08:00:00', 'device', datetime('now'), datetime('now'))
    `).run()
    db.prepare(`
      INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
      VALUES (2, 'out', '2026-07-15T18:41:43', 'device', datetime('now'), datetime('now'))
    `).run()
  })

  it('sanity check: the naive "global last punch" is the day-15 device row, not anything near a backfilled date', () => {
    const last = getLastLogForEmployee(db, 2)
    expect(last?.timestamp).toBe('2026-07-15T18:41:43')
    expect(last?.type).toBe('out')
  })

  it('allows sequentially backfilling days 1-13, ending right before the day-14 device IN', () => {
    createManualLog(db, { employee_id: 2, type: 'in', timestamp: '2026-07-01T08:00:00', note: 'backfill' })
    createManualLog(db, { employee_id: 2, type: 'out', timestamp: '2026-07-01T17:00:00', note: 'backfill' })

    for (let d = 2; d <= 13; d++) {
      const day = String(d).padStart(2, '0')
      expect(
        createManualLog(db, { employee_id: 2, type: 'in', timestamp: `2026-07-${day}T08:00:00`, note: 'backfill' }).type,
      ).toBe('in')
      expect(
        createManualLog(db, { employee_id: 2, type: 'out', timestamp: `2026-07-${day}T17:00:00`, note: 'backfill' }).type,
      ).toBe('out')
    }

    const logs = listAttendanceLogs(db, { employeeId: 2 }).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    expect(logs.length).toBe(28) // 13 backfilled days x 2 + day14 IN + day15 OUT
    let expected: 'in' | 'out' = 'in'
    for (const log of logs) {
      expect(log.type).toBe(expected)
      expected = expected === 'in' ? 'out' : 'in'
    }
  })

  it('rejects a manual IN whose immediately preceding existing punch is also IN, regardless of insertion order', () => {
    createManualLog(db, { employee_id: 2, type: 'in', timestamp: '2026-07-05T08:00:00', note: 'backfill' })
    expect(() =>
      createManualLog(db, { employee_id: 2, type: 'in', timestamp: '2026-07-05T09:00:00', note: 'bad' }),
    ).toThrow(/already has an IN punch/)
  })

  it('rejects a manual OUT with no preceding IN', () => {
    expect(() =>
      createManualLog(db, { employee_id: 2, type: 'out', timestamp: '2026-07-05T17:00:00', note: 'bad' }),
    ).toThrow(/no prior IN punch/)
  })

  it('does not reject a backfilled IN merely because a later punch (day 14 device IN) is also IN', () => {
    // The "following" neighbor check is intentionally skipped for manual backfill —
    // a same-type future neighbor is an expected transient mid-backfill state (the
    // gap gets bridged by subsequent inserts), not an error. Any real gap left
    // unresolved is caught by computeAttendanceExceptions()'s missing_punch check
    // before payroll, not blocked here.
    expect(() =>
      createManualLog(db, { employee_id: 2, type: 'in', timestamp: '2026-07-13T08:00:00', note: 'backfill' }),
    ).not.toThrow()
  })

  it('update: blocks turning a log into a duplicate of its immediate neighbor (unlike create, edits check both sides)', () => {
    createManualLog(db, { employee_id: 2, type: 'in', timestamp: '2026-07-05T08:00:00', note: 'x' })
    const outLog = createManualLog(db, { employee_id: 2, type: 'out', timestamp: '2026-07-05T17:00:00', note: 'x' })

    // Editing day5's OUT to IN would make it directly follow day5's own IN with
    // nothing between — a genuine duplicate-neighbor error. Unlike createManualLog
    // (which skips the far-side check to allow progressive backfill), update
    // checks both neighbors since it's a single edit to an otherwise-settled
    // timeline, not a multi-step build.
    expect(() => updateAttendanceLog(db, outLog.id, { type: 'in' })).toThrow(/already has an IN punch/)

    // A genuinely valid edit (just moving the time slightly, still after the IN
    // and still before day-14) still works.
    expect(() => updateAttendanceLog(db, outLog.id, { timestamp: '2026-07-05T18:00:00' })).not.toThrow()
  })

  it('createManualLog and updateAttendanceLog both refuse to touch a closed payroll period', () => {
    db.prepare(`
      INSERT INTO payroll_periods (name, start_date, end_date, status)
      VALUES ('July P1', '2026-07-01', '2026-07-13', 'closed')
    `).run()

    expect(() =>
      createManualLog(db, { employee_id: 2, type: 'in', timestamp: '2026-07-05T08:00:00', note: 'x' }),
    ).toThrow(/closed payroll period/)

    // An edit that would move an existing log's date into the closed range is
    // also blocked, not just edits to logs already dated inside it.
    const movable = createManualLog(db, { employee_id: 2, type: 'in', timestamp: '2026-07-20T08:00:00', note: 'x' })
    expect(() =>
      updateAttendanceLog(db, movable.id, { timestamp: '2026-07-05T08:00:00' }),
    ).toThrow(/closed payroll period/)

    deleteAttendanceLog(db, movable.id)
  })
})
