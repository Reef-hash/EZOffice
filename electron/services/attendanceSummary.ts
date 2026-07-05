// getMonthlyAttendanceSummary — aggregates hours per employee per month.
// This was deferred from Phase 2 (attendance.ts line ~268) because it depends on
// salary_structures.standard_hours_per_day for OT classification.
//
// Logic:
//  1. Get the active salary structure for each employee during the target month
//  2. Get attendance logs for the month, ordered chronologically
//  3. Pair consecutive IN→OUT punches per employee/day
//  4. Hours in each pair ≤ standard_hours_per_day → regular; excess → OT
//  5. Sum per employee

import type Database from 'better-sqlite3'
import type { EmployeeMonthlySummary } from '../../src/shared/types/entities'

/**
 * Get the salary structure effective for a given employee on a given date.
 * Returns the single most recent structure whose effective_from ≤ asOfDate.
 */
function getEffectiveSalaryStructure(
  db: Database.Database,
  employeeId: number,
  asOfDate: string,
): { rate_type: string; rate_amount: number; standard_hours_per_day: number } | null {
  const row = db.prepare(`
    SELECT rate_type, rate_amount, standard_hours_per_day
    FROM salary_structures
    WHERE employee_id = ? AND effective_from <= ?
    ORDER BY effective_from DESC
    LIMIT 1
  `).get(employeeId, asOfDate) as
    { rate_type: string; rate_amount: number; standard_hours_per_day: number } | undefined
  return row ?? null
}

/**
 * Get the standard daily hours that govern OT classification for an employee.
 * Phase C rule: if the employee has an assigned shift, use shift.standard_hours
 * (shifts are the authoritative source of expected work hours post-Phase C).
 * Fall back to salary_structures.standard_hours_per_day for employees with no
 * shift (e.g. salaried staff not on a fixed shift). Returns null if neither
 * exists — caller skips that employee (can't classify OT without a baseline).
 */
function getStandardHoursForEmployee(
  db: Database.Database,
  employeeId: number,
  asOfDate: string,
): number | null {
  // 1. Assigned shift (Phase C) — authoritative when present
  const shiftRow = db.prepare(`
    SELECT s.standard_hours
    FROM employees e
    LEFT JOIN shifts s ON s.id = e.shift_id
    WHERE e.id = ?
  `).get(employeeId) as { standard_hours: number | null } | undefined

  if (shiftRow && shiftRow.standard_hours != null && shiftRow.standard_hours > 0) {
    return shiftRow.standard_hours
  }

  // 2. Fall back to salary structure
  const structure = getEffectiveSalaryStructure(db, employeeId, asOfDate)
  if (structure && structure.standard_hours_per_day > 0) {
    return structure.standard_hours_per_day
  }

  return null
}

/**
 * Returns the set of dates (YYYY-MM-DD) on which an employee has APPROVED leave
 * that overlaps the given month range. Approved leave days are excluded from
 * days_worked and hours aggregation — the employee was not expected to work,
 * so their punches on those days (if any) are not counted as regular work.
 */
function getApprovedLeaveDates(
  db: Database.Database,
  employeeId: number,
  monthStart: string,
  monthEnd: string,
): Set<string> {
  const rows = db.prepare(`
    SELECT date_from, date_to
    FROM leave_records
    WHERE employee_id = ? AND status = 'approved'
      AND date_from <= ? AND date_to >= ?
  `).all(employeeId, monthEnd, monthStart) as Array<{ date_from: string; date_to: string }>

  const dates = new Set<string>()
  for (const row of rows) {
    // Walk date_from → date_to inclusive, adding each date that falls in the month
    const from = new Date(row.date_from + 'T00:00:00')
    const to = new Date(row.date_to + 'T00:00:00')
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10)
      if (iso >= monthStart && iso <= monthEnd) {
        dates.add(iso)
      }
    }
  }
  return dates
}

/**
 * Aggregates monthly attendance for one or more employees.
 *
 * @param employeeIds — if omitted, aggregates ALL employees who have attendance logs in the month
 * @returns one summary per employee
 */
export function getMonthlyAttendanceSummary(
  db: Database.Database,
  filters: { employeeIds?: number[]; year: number; month: number },
): EmployeeMonthlySummary[] {
  const { year, month } = filters
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`

  // Compute month end: last day of the month
  const lastDay = new Date(year, month, 0).getDate() // month is 1-based here, day 0 = last day of prev
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Determine which employees to process
  let employeeIds: number[]
  if (filters.employeeIds && filters.employeeIds.length > 0) {
    employeeIds = filters.employeeIds
  } else {
    // Get all employees who have attendance in the month
    const rows = db.prepare(`
      SELECT DISTINCT employee_id FROM attendance_logs
      WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    `).all(monthStart, monthEnd) as Array<{ employee_id: number }>
    employeeIds = rows.map((r) => r.employee_id)
  }

  const summaries: EmployeeMonthlySummary[] = []

  for (const employeeId of employeeIds) {
    // Standard daily hours for OT classification: prefer assigned shift (Phase C),
    // fall back to salary structure. Skip if neither exists — can't classify OT.
    const standardHoursPerDay = getStandardHoursForEmployee(db, employeeId, monthEnd)
    if (standardHoursPerDay == null) continue

    // Approved leave days in this month — punches on these days are not counted
    // as worked days/hours (employee was on approved leave, not expected to work).
    const leaveDates = getApprovedLeaveDates(db, employeeId, monthStart, monthEnd)

    // Fetch ALL attendance logs for this employee in the month, ordered chronologically
    const logs = db.prepare(`
      SELECT type, timestamp
      FROM attendance_logs
      WHERE employee_id = ? AND date(timestamp) >= ? AND date(timestamp) <= ?
      ORDER BY timestamp ASC
    `).all(employeeId, monthStart, monthEnd) as Array<{ type: string; timestamp: string }>

    if (logs.length === 0) continue

    // Pair consecutive IN→OUT punches.
    // Isolated INs (missing OUT) or isolated OUTs (missing IN) are ignored.
    // Punches on approved-leave days are skipped entirely.
    let totalRegularHours = 0
    let totalOtHours = 0
    let daysWorked = 0

    let currentIn: Date | null = null

    for (const log of logs) {
      const logDate = log.timestamp.slice(0, 10) // YYYY-MM-DD
      if (leaveDates.has(logDate)) {
        // On an approved leave day — don't pair these punches
        currentIn = null
        continue
      }

      if (log.type === 'in') {
        // If there's already a pending IN without a matching OUT, discard it (orphan IN)
        currentIn = new Date(log.timestamp)
      } else if (log.type === 'out' && currentIn !== null) {
        // We have a complete IN→OUT pair
        const outTime = new Date(log.timestamp)
        const hoursWorked = (outTime.getTime() - currentIn.getTime()) / (1000 * 60 * 60)

        // Sanity: ignore pairs where out is before in or duration is zero/negative
        if (hoursWorked > 0) {
          const regular = Math.min(hoursWorked, standardHoursPerDay)
          const ot = Math.max(0, hoursWorked - standardHoursPerDay)

          totalRegularHours += regular
          totalOtHours += ot
          daysWorked++
        }

        currentIn = null // reset for next pair
      }
      // If type is 'out' but currentIn is null, it's an orphan OUT — ignore
    }

    summaries.push({
      employee_id: employeeId,
      total_regular_hours: Math.round(totalRegularHours * 100) / 100,
      total_ot_hours: Math.round(totalOtHours * 100) / 100,
      days_worked: daysWorked,
    })
  }

  return summaries
}
