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
    // Get the employee's salary structure active at the END of the month
    // (the one that governs pay for this period)
    const structure = getEffectiveSalaryStructure(db, employeeId, monthEnd)
    // If no salary structure exists, skip this employee — no way to classify OT
    if (!structure) continue

    const standardHoursPerDay = structure.standard_hours_per_day

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
    let totalRegularHours = 0
    let totalOtHours = 0
    let daysWorked = 0

    let currentIn: Date | null = null

    for (const log of logs) {
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
