// Coverage for the auto-deduct break rule (2026-08-27), added on the project owner's
// explicit "masukkan auto deduct" instruction after confirming employees clock a single
// continuous session (never punching out for lunch) and standard_hours could not
// safely be corrected to the true net figure without it — doing so first would have
// reproduced the exact "OT too expensive" complaint that started this investigation.
//
// Rule (attendanceProcessor.ts Stage 10): for a day with exactly ONE session that
// clocks MORE than the shift's threshold, assume the shift's allowed break
// (shift.break_minutes) is inside that span and deduct it before computing regular/OT
// hours. A day with 2+ sessions (an explicit lunch punch) is never touched — the gap
// between sessions already excludes the break naturally. A single session at or under
// the threshold is never touched either — there is no ambiguous excess to explain.
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import { triggerProcessing, getDailyRecordsByPeriod } from '../attendanceProcessor'

const migrationsDir = path.resolve(process.cwd(), 'electron/db/migrations')

function makeDb(standardHours: number, breakMinutes: number): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrationsDir)
  db.prepare(`INSERT INTO departments (id,name) VALUES (1,'Ops')`).run()
  db.prepare(`
    INSERT INTO shifts (id,name,start_time,end_time,standard_hours,break_minutes)
    VALUES (100,'Client Shift','09:00','18:00',?,?)
  `).run(standardHours, breakMinutes)
  db.prepare(`
    INSERT INTO employees (id,employee_code,name,ic_number,department_id,status,date_joined,shift_id)
    VALUES (2,'E2','Worker','900101-01-0002',1,'active','2020-01-01',100)
  `).run()
  db.prepare(`
    INSERT INTO payroll_periods (id,name,start_date,end_date,status)
    VALUES (1,'P','2026-08-10','2026-08-11','open')
  `).run()
  return db
}

function punch(db: Database.Database, inTime: string, outTime: string): void {
  db.prepare(`INSERT INTO attendance_logs (employee_id,type,timestamp,source,created_at,updated_at)
    VALUES (2,'in',?, 'manual',datetime('now'),datetime('now'))`).run(`2026-08-10T${inTime}:00`)
  db.prepare(`INSERT INTO attendance_logs (employee_id,type,timestamp,source,created_at,updated_at)
    VALUES (2,'out',?, 'manual',datetime('now'),datetime('now'))`).run(`2026-08-10T${outTime}:00`)
}

function processedDay(db: Database.Database) {
  triggerProcessing(db, 1, [2])
  return getDailyRecordsByPeriod(db, 1, 2).find((r) => r.date === '2026-08-10')!
}

describe('auto-deduct break (Stage 10)', () => {
  it('the reported client scenario: 9-6 shift, 1hr break, single session, standard_hours=8 -> zero phantom OT', () => {
    const db = makeDb(8, 60)
    punch(db, '09:00', '18:00') // 9h clocked, no lunch punch
    const rec = processedDay(db)

    expect(rec.total_clocked_hours).toBe(9) // raw
    expect(rec.regular_hours).toBe(8)
    expect(rec.ot_hours).toBe(0) // the whole point — no phantom OT from the unpunched break
    expect(rec.break_hours).toBeCloseTo(1, 2) // assumed break, shown honestly
    expect(rec.break_minutes_over).toBe(0) // exactly the allowance, not flagged
  })

  it('does not double-deduct when the employee DOES punch for lunch (2 sessions)', () => {
    const db = makeDb(8, 60)
    punch(db, '09:00', '13:00')
    punch(db, '14:00', '18:00') // 8h clocked across two sessions, 1h real gap
    const rec = processedDay(db)

    expect(rec.total_clocked_hours).toBe(8)
    expect(rec.regular_hours).toBe(8)
    expect(rec.ot_hours).toBe(0)
    expect(rec.break_hours).toBeCloseTo(1, 2) // from the real gap, not an assumption
  })

  it('does not assume a break for a single session at or under the threshold', () => {
    const db = makeDb(8, 60)
    punch(db, '09:00', '17:00') // exactly 8h, no excess to explain
    const rec = processedDay(db)

    expect(rec.regular_hours).toBe(8)
    expect(rec.ot_hours).toBe(0)
    expect(rec.break_hours).toBe(0)
  })

  it('still reports genuine overtime beyond the assumed break', () => {
    const db = makeDb(8, 60)
    punch(db, '09:00', '19:00') // 10h clocked - 1h assumed break = 9h pay-hours -> 1h real OT
    const rec = processedDay(db)

    expect(rec.regular_hours).toBe(8)
    expect(rec.ot_hours).toBe(1)
  })

  it('a shift with break_minutes=0 (no scheduled break) is a no-op — the existing per-shift config is the opt-out', () => {
    const db = makeDb(8, 0)
    punch(db, '09:00', '18:00') // 9h clocked, single session, no break configured at all
    const rec = processedDay(db)

    expect(rec.regular_hours).toBe(8)
    expect(rec.ot_hours).toBe(1) // genuinely 1h beyond an 8h day with no break to assume
    expect(rec.break_hours).toBe(0)
  })

  it('never goes negative when the assumed break exceeds the excess over threshold', () => {
    // threshold=1h, break=10h: 2h clocked > 1h threshold fires the deduction, but
    // 2h - 10h would be negative — floored at 0, not a negative pay-hours figure.
    const db = makeDb(1, 600)
    punch(db, '09:00', '11:00') // 2h clocked, single session
    const rec = processedDay(db)

    expect(rec.regular_hours).toBe(0)
    expect(rec.ot_hours).toBe(0)
  })
})
