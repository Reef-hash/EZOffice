// Attendance Processing Engine — the 12-stage pipeline.
// See docs/hrms-architecture-proposal.md §7 for the full design.
//
// Consumes: attendance_logs, company calendar, leave_records, shifts
// Produces: daily_attendance_records

import type Database from 'better-sqlite3'
import type { ProcessingRun, DailyAttendanceRecord, AttendanceDayStatus } from '../../src/shared/types/entities'
import { resolveCalendarDay } from './calendar'

/** Returns minutes between two "HH:MM" strings (b - a). */
function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  return (bh * 60 + bm) - (ah * 60 + am)
}

// ── Public API ───────────────────────────────────────────────

/**
 * Triggers the processing engine for a payroll period.
 * Runs all 12 stages and persists Daily Attendance Records.
 */
export function triggerProcessing(
  db: Database.Database,
  payrollPeriodId: number,
  employeeIds?: number[],
): ProcessingRun {
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(payrollPeriodId) as
    { id: number; start_date: string; end_date: string; name: string } | undefined
  if (!period) throw new Error(`Payroll period ${payrollPeriodId} not found`)

  // Create the processing run record
  const runResult = db.prepare(`
    INSERT INTO processing_runs (payroll_period_id, status, started_at)
    VALUES (?, 'running', datetime('now'))
  `).run(payrollPeriodId)
  const runId = runResult.lastInsertRowid as number

  try {
    // Determine which employees to process
    // Exclude employees whose most recent salary structure has rate_type = 'monthly'
    // (monthly employees don't track attendance — their pay is fixed)
    let employees: Array<{ id: number }>
    if (employeeIds && employeeIds.length > 0) {
      // Filter out monthly employees from the explicit list
      const monthlyIds = db.prepare(`
        SELECT ss.employee_id FROM salary_structures ss
        INNER JOIN (
          SELECT employee_id, MAX(effective_from) AS max_ef
          FROM salary_structures
          WHERE effective_from <= ?
          GROUP BY employee_id
        ) latest ON latest.employee_id = ss.employee_id AND latest.max_ef = ss.effective_from
        WHERE ss.rate_type = 'monthly'
      `).all(period.end_date) as Array<{ employee_id: number }>
      const monthlyIdSet = new Set(monthlyIds.map((m) => m.employee_id))
      employees = employeeIds.filter((id) => !monthlyIdSet.has(id)).map((id) => ({ id }))
    } else {
      employees = db.prepare(`
        SELECT e.id FROM employees e
        WHERE e.status = 'active'
          AND (
            -- Employee has no salary structure at all → include (not yet configured)
            NOT EXISTS (SELECT 1 FROM salary_structures ss WHERE ss.employee_id = e.id AND ss.effective_from <= ?)
            OR
            -- Employee's most recent salary structure as of period end is NOT monthly
            (
              SELECT ss2.rate_type FROM salary_structures ss2
              WHERE ss2.employee_id = e.id AND ss2.effective_from <= ?
              ORDER BY ss2.effective_from DESC
              LIMIT 1
            ) != 'monthly'
          )
      `).all(period.end_date, period.end_date) as Array<{ id: number }>
    }

    let totalDays = 0

    // Run the pipeline inside a transaction
    db.transaction(() => {
      for (const emp of employees) {
        const records = processEmployee(db, emp.id, period.start_date, period.end_date, runId, payrollPeriodId)
        for (const record of records) {
          db.prepare(`
            INSERT INTO daily_attendance_records
              (employee_id, date, payroll_period_id, processing_run_id,
               calendar_type, leave_type, leave_record_id, shift_id,
               attendance_status, first_in, last_out, session_count,
               total_clocked_hours, break_hours, regular_hours, ot_hours,
               minutes_late, minutes_early_out, is_finalized, created_at, updated_at)
            VALUES
              (@employee_id, @date, @payroll_period_id, @processing_run_id,
               @calendar_type, @leave_type, @leave_record_id, @shift_id,
               @attendance_status, @first_in, @last_out, @session_count,
               @total_clocked_hours, @break_hours, @regular_hours, @ot_hours,
               @minutes_late, @minutes_early_out, 0, @now, @now)
          `).run(record)
        }
        totalDays += records.length
      }
    })()

    // Mark the run as completed
    db.prepare(`
      UPDATE processing_runs
      SET status = 'completed', completed_at = datetime('now'),
          total_employees = ?, total_days = ?
      WHERE id = ?
    `).run(employees.length, totalDays, runId)

    return db.prepare('SELECT * FROM processing_runs WHERE id = ?').get(runId) as ProcessingRun
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    db.prepare(`
      UPDATE processing_runs SET status = 'failed', completed_at = datetime('now'), error_message = ? WHERE id = ?
    `).run(msg, runId)
    throw new Error(`Processing failed: ${msg}`)
  }
}

export function listProcessingRuns(db: Database.Database, payrollPeriodId: number): ProcessingRun[] {
  return db.prepare(`
    SELECT * FROM processing_runs WHERE payroll_period_id = ? ORDER BY created_at DESC
  `).all(payrollPeriodId) as ProcessingRun[]
}

export function getProcessingRun(db: Database.Database, id: number): ProcessingRun | null {
  const row = db.prepare('SELECT * FROM processing_runs WHERE id = ?').get(id) as ProcessingRun | undefined
  return row ?? null
}

export function getDailyRecords(
  db: Database.Database,
  employeeId: number,
  dateFrom: string,
  dateTo: string,
): DailyAttendanceRecord[] {
  return db.prepare(`
    SELECT * FROM daily_attendance_records
    WHERE employee_id = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `).all(employeeId, dateFrom, dateTo) as DailyAttendanceRecord[]
}

export function getDailyRecordsByPeriod(
  db: Database.Database,
  payrollPeriodId: number,
  employeeId?: number,
): DailyAttendanceRecord[] {
  const conditions = ['payroll_period_id = ?']
  const params: unknown[] = [payrollPeriodId]
  if (employeeId !== undefined) {
    conditions.push('dar.employee_id = ?')
    params.push(employeeId)
  }
  return db.prepare(`
    SELECT dar.*, e.name AS employee_name
    FROM daily_attendance_records dar
    LEFT JOIN employees e ON e.id = dar.employee_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY dar.employee_id ASC, dar.date ASC
  `).all(...params) as DailyAttendanceRecord[]
}

/**
 * Replaces the old getMonthlyAttendanceSummary() — Payroll reads from daily_attendance_records.
 * Aggregates per employee for a given month: sum of regular_hours, ot_hours, days_worked.
 * Falls back to zeroed values if no records exist for an employee.
 */
export function getMonthlySummaryFromDailyRecords(
  db: Database.Database,
  filters: { employeeIds?: number[]; year: number; month: number },
): Array<{ employee_id: number; total_regular_hours: number; total_ot_hours: number; days_worked: number }> {
  const { year, month, employeeIds } = filters
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthStart = `${year}-${pad(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${year}-${pad(month)}-${pad(lastDay)}`

  const conditions = ['dar.date >= ?', 'dar.date <= ?']
  const params: unknown[] = [monthStart, monthEnd]

  if (employeeIds && employeeIds.length > 0) {
    conditions.push(`dar.employee_id IN (${employeeIds.map(() => '?').join(',')})`)
    params.push(...employeeIds)
  }

  const rows = db.prepare(`
    SELECT
      dar.employee_id,
      COALESCE(SUM(dar.regular_hours), 0) AS total_regular_hours,
      COALESCE(SUM(dar.ot_hours), 0) AS total_ot_hours,
      COUNT(DISTINCT CASE WHEN dar.attendance_status IN ('present', 'late', 'early_out', 'excused_late') THEN dar.date END) AS days_worked
    FROM daily_attendance_records dar
    WHERE ${conditions.join(' AND ')}
    GROUP BY dar.employee_id
  `).all(...params) as Array<{ employee_id: number; total_regular_hours: number; total_ot_hours: number; days_worked: number }>

  return rows
}

// ── Per-Employee Processing Pipeline ──────────────────────────

function processEmployee(
  db: Database.Database,
  employeeId: number,
  periodStart: string,
  periodEnd: string,
  runId: number,
  payrollPeriodId: number,
): Array<Record<string, unknown>> {
  const pad = (n: number) => String(n).padStart(2, '0')

  // Stage 1: Collect raw logs for the entire period range (±1 day for cross-midnight)
  const prevDay = new Date(periodStart + 'T00:00:00')
  prevDay.setDate(prevDay.getDate() - 1)
  const fetchStart = `${prevDay.getFullYear()}-${pad(prevDay.getMonth() + 1)}-${pad(prevDay.getDate())}`

  const nextDay = new Date(periodEnd + 'T00:00:00')
  nextDay.setDate(nextDay.getDate() + 1)
  const fetchEnd = `${nextDay.getFullYear()}-${pad(nextDay.getMonth() + 1)}-${pad(nextDay.getDate())}`

  const logs = db.prepare(`
    SELECT id, type, timestamp, source, shift_id, status
    FROM attendance_logs
    WHERE employee_id = ? AND date(timestamp) >= ? AND date(timestamp) <= ?
    ORDER BY timestamp ASC
  `).all(employeeId, fetchStart, fetchEnd) as Array<{
    id: number; type: string; timestamp: string; source: string; shift_id: number | null; status: string
  }>

  // Stage 2: Normalize timestamps — all should already be naive ISO from the service layer.
  // No timezone conversion needed — the app stores naive local timestamps consistently.

  // Stage 3: Validate — check alternation and detect anomalies
  // Absorbs the existing attendanceExceptions.ts logic.
  const validationIssues: string[] = []
  let currentIn: { id: number; timestamp: string } | null = null
  const unpairedIns: Array<{ id: number; timestamp: string }> = []

  for (const log of logs) {
    if (log.type === 'in') {
      if (currentIn) {
        // Double IN — the previous IN is now orphaned
        unpairedIns.push(currentIn)
        validationIssues.push(`Orphan IN at ${currentIn.timestamp}`)
      }
      currentIn = { id: log.id, timestamp: log.timestamp }
    } else if (log.type === 'out') {
      if (currentIn) {
        // Clean IN→OUT pair — consume the IN
        currentIn = null
      } else {
        // Orphan OUT — no matching IN
        validationIssues.push(`Orphan OUT at ${log.timestamp}`)
      }
    }
  }
  if (currentIn) {
    unpairedIns.push(currentIn)
    validationIssues.push(`Unmatched IN at ${currentIn.timestamp}`)
  }

  // Stage 4: Pair sessions — group INTO IN→OUT pairs per employee across the full range
  type Pair = { inTimestamp: string; inId: number; outTimestamp: string | null; outId: number | null }
  const pairs: Pair[] = []
  let pendingIn: { id: number; timestamp: string } | null = null

  for (const log of logs) {
    if (log.type === 'in') {
      pendingIn = { id: log.id, timestamp: log.timestamp }
    } else if (log.type === 'out' && pendingIn) {
      pairs.push({
        inTimestamp: pendingIn.timestamp,
        inId: pendingIn.id,
        outTimestamp: log.timestamp,
        outId: log.id,
      })
      pendingIn = null
    }
  }

  // Stage 5: Calculate hours per session
  const maxSessionHours = (db.prepare(
    "SELECT max_session_hours FROM payroll_settings WHERE id = 1",
  ).get() as { max_session_hours?: number } | undefined)?.max_session_hours ?? 16

  type Session = { date: string; hours: number }
  const sessions: Session[] = []
  for (const pair of pairs) {
    if (!pair.outTimestamp) continue
    const hours = (new Date(pair.outTimestamp).getTime() - new Date(pair.inTimestamp).getTime()) / (1000 * 60 * 60)
    if (hours > 0 && hours <= maxSessionHours) {
      sessions.push({ date: pair.inTimestamp.slice(0, 10), hours })
    }
  }

  // Get approved leave records for this employee in the period
  const leaveRecords = db.prepare(`
    SELECT id, leave_type, date_from, date_to FROM leave_records
    WHERE employee_id = ? AND status = 'approved'
      AND date_from <= ? AND date_to >= ?
  `).all(employeeId, periodEnd, periodStart) as Array<{ id: number; leave_type: string; date_from: string; date_to: string }>

  // Get employee's default shift
  const empShift = db.prepare(`
    SELECT s.* FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = ?
  `).get(employeeId) as { id: number; start_time: string; end_time: string; standard_hours: number } | undefined

  const now = new Date().toISOString()
  const records: Array<Record<string, unknown>> = []

  // Iterate through each day in the period
  const startDate = new Date(periodStart + 'T00:00:00')
  const endDate = new Date(periodEnd + 'T00:00:00')

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    // Stage 6: Resolve Calendar — use the Phase 1 calendar service
    const calendarDay = resolveCalendarDay(db, employeeId, dateStr)

    // Stage 7: Resolve Leave
    let leaveType: string | null = null
    let leaveRecordId: number | null = null
    for (const lr of leaveRecords) {
      if (dateStr >= lr.date_from && dateStr <= lr.date_to) {
        leaveType = lr.leave_type
        leaveRecordId = lr.id
        break
      }
    }

    // Stage 8: Resolve Holiday — apply priority from the proposal §8
    // If employee has approved leave, that overrides holiday/weekly off
    // If it's an emergency closure, status is emergency_closure regardless
    const isNonWorkingBase = calendarDay.day_type === 'weekly_off'
      || calendarDay.day_type === 'public_holiday'
      || calendarDay.day_type === 'company_holiday'
      || calendarDay.day_type === 'emergency_closure'

    // Stage 9: Resolve Attendance Status — decision tree from §7
    let attendanceStatus: AttendanceDayStatus
    let minutesLate = 0
    let minutesEarlyOut = 0

    if (calendarDay.day_type === 'emergency_closure') {
      attendanceStatus = 'emergency_closure'
    } else if (leaveType) {
      attendanceStatus = 'on_leave'
    } else if (isNonWorkingBase && calendarDay.day_type !== 'special_working_day') {
      if (calendarDay.day_type === 'weekly_off') attendanceStatus = 'weekly_off'
      else attendanceStatus = 'holiday'
    } else {
      // Working day — evaluate punches
      const dayLogs = logs.filter((l) => l.timestamp.slice(0, 10) === dateStr)
      const dayIns = dayLogs.filter((l) => l.type === 'in')
      const dayOuts = dayLogs.filter((l) => l.type === 'out')

      if (dayIns.length === 0) {
        attendanceStatus = 'absent'
      } else {
        // Check lateness if employee has a shift
        if (empShift) {
          const firstInTime = dayIns[0].timestamp.slice(11, 16)
          const minutesBetween = (h1: string, h2: string): number => {
            const [ah, am] = h1.split(':').map(Number)
            const [bh, bm] = h2.split(':').map(Number)
            return (bh * 60 + bm) - (ah * 60 + am)
          }
          const grace = (db.prepare(
            "SELECT grace_period_minutes FROM payroll_settings WHERE id = 1",
          ).get() as { grace_period_minutes?: number } | undefined)?.grace_period_minutes ?? 15
          const raw = minutesBetween(empShift.start_time, firstInTime)
          minutesLate = Math.max(0, raw - grace)
        }

        // Check early out if employee has a shift and has at least one OUT
        if (empShift && dayOuts.length > 0) {
          const lastOutTime = dayOuts[dayOuts.length - 1].timestamp.slice(11, 16)
          const raw = minutesBetween(lastOutTime, empShift.end_time)
          minutesEarlyOut = Math.max(0, raw)
        }

        if (minutesLate > 0 && minutesEarlyOut > 0) {
          attendanceStatus = 'late' // late is primary
        } else if (minutesLate > 0) {
          attendanceStatus = 'late'
        } else if (minutesEarlyOut > 0) {
          attendanceStatus = 'early_out'
        } else {
          attendanceStatus = 'present'
        }
      }
    }

    // Stage 10: Calculate Final Hours — regular/OT split
    const currentDaySessions = sessions.filter((s) => s.date === dateStr)
    const totalClockedHours = currentDaySessions.reduce((sum, s) => sum + s.hours, 0)
    const standardHours = empShift?.standard_hours ?? 8
    const isHalfDay = calendarDay.is_half_day
    const threshold = isHalfDay ? standardHours / 2 : standardHours

    let regularHours = 0
    let otHours = 0

    if (attendanceStatus === 'present' || attendanceStatus === 'late' || attendanceStatus === 'early_out') {
      regularHours = Math.min(totalClockedHours, threshold)
      otHours = Math.max(0, totalClockedHours - threshold)
    }

    // Stage 10 continued: aggregate from day sessions
    const firstIn = logs.filter((l) => l.timestamp.slice(0, 10) === dateStr && l.type === 'in')
    const lastOut = logs.filter((l) => l.timestamp.slice(0, 10) === dateStr && l.type === 'out')
    const sessionCount = currentDaySessions.length

    // Stage 11: Build the Daily Record
    records.push({
      employee_id: employeeId,
      date: dateStr,
      payroll_period_id: payrollPeriodId,
      processing_run_id: runId,
      calendar_type: calendarDay.day_type,
      leave_type: leaveType,
      leave_record_id: leaveRecordId,
      shift_id: empShift?.id ?? null,
      attendance_status: attendanceStatus,
      first_in: firstIn.length > 0 ? firstIn[0].timestamp : null,
      last_out: lastOut.length > 0 ? lastOut[lastOut.length - 1].timestamp : null,
      session_count: sessionCount,
      total_clocked_hours: Math.round(totalClockedHours * 100) / 100,
      break_hours: 0,
      regular_hours: Math.round(regularHours * 100) / 100,
      ot_hours: Math.round(otHours * 100) / 100,
      minutes_late: minutesLate,
      minutes_early_out: minutesEarlyOut,
      now,
    })
  }

  return records
}
