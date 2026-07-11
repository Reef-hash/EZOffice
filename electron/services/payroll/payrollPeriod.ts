// Payroll Period service — date range definitions for payroll grouping.
// Periods are non-overlapping and follow the lifecycle:
//   open → processing → finalized → closed
//
// Phase 6: Finalization auto-locks daily_attendance_records.
// Closed periods also lock attendance_logs within the date range.

import type Database from 'better-sqlite3'
import type { PayrollPeriod } from '../../../src/shared/types/entities'
import type { CreatePayrollPeriodInput, UpdatePayrollPeriodStatusInput } from '../../../src/shared/types/inputs'

export function listPayrollPeriods(db: Database.Database): PayrollPeriod[] {
  return db.prepare('SELECT * FROM payroll_periods ORDER BY start_date DESC').all() as PayrollPeriod[]
}

export function getPayrollPeriodById(db: Database.Database, id: number): PayrollPeriod | null {
  const row = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(id) as PayrollPeriod | undefined
  return row ?? null
}

export function createPayrollPeriod(
  db: Database.Database,
  input: CreatePayrollPeriodInput,
): PayrollPeriod {
  const overlap = db.prepare(`
    SELECT COUNT(*) AS cnt FROM payroll_periods
    WHERE start_date <= ? AND end_date >= ?
  `).get(input.end_date, input.start_date) as { cnt: number }

  if (overlap.cnt > 0) {
    throw new Error('Payroll period overlaps with an existing period')
  }

  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO payroll_periods (name, start_date, end_date, status, created_at, updated_at)
    VALUES (@name, @start_date, @end_date, 'open', @now, @now)
  `).run({
    name: input.name,
    start_date: input.start_date,
    end_date: input.end_date,
    now,
  })
  return db.prepare('SELECT * FROM payroll_periods WHERE id = ?')
    .get(result.lastInsertRowid) as PayrollPeriod
}

/**
 * Phase 6: Transition a payroll period's status with side effects.
 *
 *   open → processing    : (none, recorded in processed_at)
 *   processing → finalized : daily_attendance_records in this period are locked (is_finalized = 1)
 *   finalized → closed     : attendance_logs in this period's date range are also locked
 */
export function updatePayrollPeriodStatus(
  db: Database.Database,
  id: number,
  input: UpdatePayrollPeriodStatusInput,
): PayrollPeriod {
  const existing = getPayrollPeriodById(db, id)
  if (!existing) throw new Error(`Payroll period with id ${id} not found`)

  const validTransitions: Record<string, string[]> = {
    open: ['processing'],
    processing: ['open', 'finalized'],
    finalized: ['closed'],
    closed: [],
  }

  const allowed = validTransitions[existing.status] ?? []
  if (!allowed.includes(input.status)) {
    throw new Error(
      `Cannot transition from '${existing.status}' to '${input.status}'. ` +
      `Allowed: ${allowed.join(', ') || 'none'}`,
    )
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status: input.status,
    finalized_at: input.status === 'finalized' ? now : existing.finalized_at,
    finalized_by: input.status === 'finalized' ? (input.finalized_by ?? null) : existing.finalized_by,
    processed_at: input.status === 'processing' ? now : existing.processed_at,
    updated_at: now,
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE payroll_periods
      SET status = @status, processed_at = @processed_at,
          finalized_at = @finalized_at, finalized_by = @finalized_by,
          updated_at = @updated_at
      WHERE id = @id
    `).run({ ...updates, id })

    // Phase 6: Lock daily_attendance_records when finalizing
    if (input.status === 'finalized') {
      db.prepare(`
        UPDATE daily_attendance_records
        SET is_finalized = 1, updated_at = ?
        WHERE payroll_period_id = ?
      `).run(now, id)
    }

    // Phase 6: Lock attendance_logs when closing the period
    if (input.status === 'closed') {
      // When a period is closed, relevant attendance_logs can no longer be edited.
      // We add a note to each log in the period's date range, and future edits
      // will be rejected by the service-layer guard (isDateInClosedPeriod).
      db.prepare(`
        UPDATE attendance_logs
        SET note = CASE
          WHEN note IS NULL OR note = '' THEN '[LOCKED: period closed]'
          WHEN note NOT LIKE '%[LOCKED: period closed]%' THEN note || ' [LOCKED: period closed]'
          ELSE note
        END,
        updated_at = ?
        WHERE date(timestamp) >= ? AND date(timestamp) <= ?
      `).run(now, existing.start_date, existing.end_date)
    }
  })()

  return getPayrollPeriodById(db, id)!
}

/**
 * Phase 6: Re-open a finalized or closed period.
 * Sets status back to 'processing', unfinalizes daily_records,
 * and removes lock notes from attendance_logs (if closed).
 * Requires an admin confirmation step on the UI side.
 */
export function reopenPayrollPeriod(
  db: Database.Database,
  id: number,
): PayrollPeriod {
  const existing = getPayrollPeriodById(db, id)
  if (!existing) throw new Error(`Payroll period with id ${id} not found`)
  if (existing.status !== 'finalized' && existing.status !== 'closed') {
    throw new Error(`Cannot reopen period with status '${existing.status}' (only finalized or closed)`)
  }

  const now = new Date().toISOString()

  db.transaction(() => {
    db.prepare(`
      UPDATE payroll_periods
      SET status = 'processing', updated_at = ?
      WHERE id = ?
    `).run(now, id)

    // Unfinalize daily records for this period
    db.prepare(`
      UPDATE daily_attendance_records
      SET is_finalized = 0, updated_at = ?
      WHERE payroll_period_id = ?
    `).run(now, id)

    // Remove lock notes from attendance_logs in the period's date range
    db.prepare(`
      UPDATE attendance_logs
      SET note = CASE
        WHEN note IS NULL THEN NULL
        WHEN note = '[LOCKED: period closed]' THEN NULL
        ELSE TRIM(REPLACE(note, ' [LOCKED: period closed]', ''))
      END,
      updated_at = ?
      WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    `).run(now, existing.start_date, existing.end_date)
  })()

  return getPayrollPeriodById(db, id)!
}

/**
 * Phase 6: Returns true if any closed payroll period contains the given date.
 * Used by attendance.ts to guard log edits in closed periods.
 */
export function isDateInClosedPeriod(db: Database.Database, date: string): boolean {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM payroll_periods
    WHERE status = 'closed' AND start_date <= ? AND end_date >= ?
  `).get(date, date) as { cnt: number }
  return row.cnt > 0
}

/**
 * Phase 6: Returns all periods (finalized or closed) that contain the given date.
 * Used by attendance.ts for user-facing error messages.
 */
export function getLockedPeriodsContainingDate(db: Database.Database, date: string): PayrollPeriod[] {
  return db.prepare(`
    SELECT * FROM payroll_periods
    WHERE status IN ('finalized', 'closed') AND start_date <= ? AND end_date >= ?
    ORDER BY start_date ASC
  `).all(date, date) as PayrollPeriod[]
}

export function deletePayrollPeriod(db: Database.Database, id: number): void {
  const existing = getPayrollPeriodById(db, id)
  if (!existing) throw new Error(`Payroll period with id ${id} not found`)
  if (existing.status !== 'open') {
    throw new Error(`Cannot delete payroll period with status '${existing.status}' (only 'open' periods can be deleted)`)
  }
  const result = db.prepare('DELETE FROM payroll_periods WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Payroll period with id ${id} not found`)
  }
}
