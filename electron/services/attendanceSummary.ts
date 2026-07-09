// getMonthlyAttendanceSummary — aggregates hours per employee per month.
//
// Rewritten per DEVICE_SYNC_AUDIT.md C1+C3 findings (2026-07-08):
//   OLD: paired IN→OUT globally, called regular/OT per pair, counted daysWorked per pair
//        → double-paid split days (lunch-break = 2 pairs = 2 days); OT sessions counted
//          as regular (pair hours ≤ standard → OT never triggered for a 3h evening session)
//
//   NEW: aggregate per CALENDAR DAY
//     1. Fetch logs with ±1 day margin around the month (fixes M1: cross-midnight sessions)
//     2. Pair consecutive IN→OUT globally per employee (orphan INs/OUTs discarded)
//     3. Attribute each pair to the date of its IN punch
//     4. Filter: only pairs whose IN date falls in the month, not on approved leave
//     5. Per date: dayTotalHours = sum of all pair hours; regular = min(total, standard);
//        OT = max(0, total − standard)  ← D1: hours-based OT rule (locked 2026-07-08)
//     6. days_worked = count of unique dates with dayTotalHours > 0
//
// Session cap (max_session_hours, D4) is applied here: pairs exceeding the cap are
// excluded from hours. The payroll pre-flight gate (D5) blocks the run if open
// attendance_exceptions exist for the month (set up by computeAttendanceExceptions in
// step 3 of the sync overhaul).
//
// The pure computation is isolated in aggregateDailyHours() so unit tests can exercise
// the math without requiring better-sqlite3 (which is compiled against Electron's Node
// and cannot load under the system Node that vitest runs on).

import type Database from 'better-sqlite3'
import type { EmployeeMonthlySummary } from '../../src/shared/types/entities'

// ── Pure computation (unit-testable, no DB) ───────────────────────────────────

export interface PunchLog {
  type: 'in' | 'out'
  timestamp: string // ISO 8601 naive local: "YYYY-MM-DDTHH:MM:SS"
}

export interface DailyAggregation {
  total_regular_hours: number
  total_ot_hours: number
  days_worked: number
}

/**
 * Pure function: given a sorted sequence of punch logs for one employee,
 * aggregate hours per calendar day and split into regular/OT.
 *
 * @param logs          Sorted chronologically. All must belong to one employee.
 * @param monthStart    "YYYY-MM-DD" — only pairs whose IN date ≥ monthStart count.
 * @param monthEnd      "YYYY-MM-DD" — only pairs whose IN date ≤ monthEnd count.
 * @param standardHours Standard daily hours (e.g. 8). D1: OT = excess beyond this.
 * @param leaveDates    Set of "YYYY-MM-DD" approved leave dates; pairs on these days excluded.
 * @param maxSessionHours Session cap (D4). Pairs longer than this are excluded from pay.
 */
export function aggregateDailyHours(
  logs: PunchLog[],
  monthStart: string,
  monthEnd: string,
  standardHours: number,
  leaveDates: Set<string>,
  maxSessionHours: number,
): DailyAggregation {
  // Step 1: Pair consecutive IN→OUT globally (orphan INs/OUTs discarded)
  type Pair = { inDate: string; hours: number }
  const pairs: Pair[] = []
  let currentIn: string | null = null // pending IN timestamp

  for (const log of logs) {
    if (log.type === 'in') {
      currentIn = log.timestamp // overwrite any unresolved IN (orphan IN → discarded)
    } else if (log.type === 'out' && currentIn !== null) {
      const hours = (new Date(log.timestamp).getTime() - new Date(currentIn).getTime()) / (1000 * 60 * 60)
      if (hours > 0 && hours <= maxSessionHours) {
        // Session cap: pairs > maxSessionHours are excluded (flagged as exceptions elsewhere)
        pairs.push({ inDate: currentIn.slice(0, 10), hours })
      }
      currentIn = null
    }
    // Orphan OUT (no pending IN): discard
  }

  // Step 2: Group by IN date, apply month + leave filters
  const hoursPerDay = new Map<string, number>()
  for (const pair of pairs) {
    if (pair.inDate < monthStart || pair.inDate > monthEnd) continue // outside month
    if (leaveDates.has(pair.inDate)) continue // approved leave day
    hoursPerDay.set(pair.inDate, (hoursPerDay.get(pair.inDate) ?? 0) + pair.hours)
  }

  // Step 3: Split each day into regular/OT
  let totalRegularHours = 0
  let totalOtHours = 0
  let daysWorked = 0

  for (const dayTotal of hoursPerDay.values()) {
    if (dayTotal <= 0) continue
    totalRegularHours += Math.min(dayTotal, standardHours)
    totalOtHours += Math.max(0, dayTotal - standardHours)
    daysWorked++
  }

  return {
    total_regular_hours: Math.round(totalRegularHours * 100) / 100,
    total_ot_hours: Math.round(totalOtHours * 100) / 100,
    days_worked: daysWorked,
  }
}

/**
 * Returns the standard daily hours that govern OT classification for an employee.
 * Phase C rule: if the employee has an assigned shift, use shift.standard_hours
 * (shifts are the authoritative source of expected work hours post-Phase C).
 * Fall back to salary_structures.standard_hours_per_day for employees with no
 * shift. Returns null if neither exists — caller skips that employee.
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
  const structure = db.prepare(`
    SELECT standard_hours_per_day
    FROM salary_structures
    WHERE employee_id = ? AND effective_from <= ?
    ORDER BY effective_from DESC
    LIMIT 1
  `).get(employeeId, asOfDate) as { standard_hours_per_day: number } | undefined

  if (structure && structure.standard_hours_per_day > 0) {
    return structure.standard_hours_per_day
  }

  return null
}

/**
 * Returns the set of dates (YYYY-MM-DD) on which an employee has APPROVED leave
 * that overlaps the given month range. Leave days are excluded from work-hours
 * aggregation per pair (not per punch) — see M1 fix in DEVICE_SYNC_AUDIT.md.
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
 * Reads the configured max session cap in hours from payroll_settings.
 * Falls back to 16 h (D4 decision default) if the row or column is missing.
 */
function getMaxSessionHours(db: Database.Database): number {
  const row = db.prepare(
    'SELECT max_session_hours FROM payroll_settings WHERE id = 1',
  ).get() as { max_session_hours?: number } | undefined
  return row?.max_session_hours ?? 16
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
  const pad = (n: number) => String(n).padStart(2, '0')

  const monthStart = `${year}-${pad(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${year}-${pad(month)}-${pad(lastDay)}`

  // ±1 day margin so that IN punches on monthEnd that pair with an OUT on the first
  // day of next month are captured (cross-midnight month-boundary sessions, M1).
  const prevDay = new Date(year, month - 1, 0) // last day of previous month
  const nextDay = new Date(year, month, 1) // first day of next month
  const fetchStart = `${prevDay.getFullYear()}-${pad(prevDay.getMonth() + 1)}-${pad(prevDay.getDate())}`
  const fetchEnd = `${nextDay.getFullYear()}-${pad(nextDay.getMonth() + 1)}-${pad(nextDay.getDate())}`

  // Determine which employees to process
  let employeeIds: number[]
  if (filters.employeeIds && filters.employeeIds.length > 0) {
    employeeIds = filters.employeeIds
  } else {
    const rows = db.prepare(`
      SELECT DISTINCT employee_id FROM attendance_logs
      WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    `).all(monthStart, monthEnd) as Array<{ employee_id: number }>
    employeeIds = rows.map((r) => r.employee_id)
  }

  const maxSessionHours = getMaxSessionHours(db)
  const summaries: EmployeeMonthlySummary[] = []

  for (const employeeId of employeeIds) {
    // Standard daily hours for OT classification: prefer assigned shift (Phase C),
    // fall back to salary structure. Skip if neither exists — can't classify OT.
    const standardHoursPerDay = getStandardHoursForEmployee(db, employeeId, monthEnd)
    if (standardHoursPerDay == null) continue

    // Approved leave days — pairs whose IN date is a leave day are excluded.
    const leaveDates = getApprovedLeaveDates(db, employeeId, monthStart, monthEnd)

    // Fetch logs with ±1 day margin to capture cross-midnight sessions at month ends (M1).
    const logs = db.prepare(`
      SELECT type, timestamp
      FROM attendance_logs
      WHERE employee_id = ? AND date(timestamp) >= ? AND date(timestamp) <= ?
      ORDER BY timestamp ASC
    `).all(employeeId, fetchStart, fetchEnd) as Array<PunchLog>

    if (logs.length === 0) continue

    const result = aggregateDailyHours(
      logs, monthStart, monthEnd, standardHoursPerDay, leaveDates, maxSessionHours,
    )

    if (result.days_worked === 0 && result.total_regular_hours === 0) continue

    summaries.push({ employee_id: employeeId, ...result })
  }

  return summaries
}
