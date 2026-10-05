// Regression coverage for device-sync IN/OUT typing against existing logs.
// Bug: syncFromDeviceEthernet() assigned IN/OUT by position within the download
// batch only. An admin's manual IN at 09:00 followed by a device punch at 13:00
// (out for lunch) made the device punch "first of the day" → IN, and every later
// punch that day flipped with it. Same failure when a day was split across two
// syncs (the watermark drops the morning punches from the second batch).
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { assignDevicePunchTypes } from '../attendance'

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

function insertLog(db: Database.Database, type: 'in' | 'out', timestamp: string, source: 'manual' | 'device'): void {
  db.prepare(`
    INSERT INTO attendance_logs (employee_id, type, timestamp, source, created_at, updated_at)
    VALUES (2, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(type, timestamp, source)
}

const punch = (timestamp: string) => ({ employeeId: 2, timestamp })

describe('assignDevicePunchTypes', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb() })

  it('continues after a manual IN: the first device punch of the day is OUT (the reported case)', () => {
    insertLog(db, 'in', '2026-10-05T09:00:00', 'manual')
    const { typed } = assignDevicePunchTypes(db, [
      punch('2026-10-05T13:00:00'),
      punch('2026-10-05T14:00:00'),
      punch('2026-10-05T18:00:00'),
    ])
    expect(typed.map((p) => p.type)).toEqual(['out', 'in', 'out'])
  })

  it('continues a day split across two syncs', () => {
    insertLog(db, 'in', '2026-10-05T09:00:00', 'device')
    insertLog(db, 'out', '2026-10-05T13:00:00', 'device')
    const { typed } = assignDevicePunchTypes(db, [punch('2026-10-05T14:00:00'), punch('2026-10-05T18:00:00')])
    expect(typed.map((p) => p.type)).toEqual(['in', 'out'])
  })

  it('interleaves with a manual entry later in the day', () => {
    insertLog(db, 'out', '2026-10-05T13:00:00', 'manual')
    const { typed } = assignDevicePunchTypes(db, [punch('2026-10-05T09:00:00'), punch('2026-10-05T14:00:00')])
    expect(typed.map((p) => p.type)).toEqual(['in', 'in'])
  })

  it('skips a device punch already captured manually (±60 s) without it taking a slot', () => {
    insertLog(db, 'in', '2026-10-05T09:00:00', 'manual')
    const { typed, duplicates } = assignDevicePunchTypes(db, [
      punch('2026-10-05T09:00:30'),
      punch('2026-10-05T13:00:00'),
    ])
    expect(duplicates).toBe(1)
    expect(typed).toEqual([{ employeeId: 2, timestamp: '2026-10-05T13:00:00', type: 'out' }])
  })

  it('starts each day fresh with IN, unaffected by the previous day', () => {
    insertLog(db, 'in', '2026-10-04T09:00:00', 'manual')
    const { typed } = assignDevicePunchTypes(db, [punch('2026-10-05T09:00:00'), punch('2026-10-05T18:00:00')])
    expect(typed.map((p) => p.type)).toEqual(['in', 'out'])
  })
})
