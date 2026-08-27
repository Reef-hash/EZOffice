// Overtime report — per employee, per day, for one payroll period.
//
// Built 2026-08-27 after the phantom-OT incident: the client could see a large OT
// total on the payroll run but had no way to ask "which day, and why". This report
// answers that by putting each day's CLOCKED hours next to the shift's STANDARD hours,
// so an over-generous OT figure traces back to either real hours or a misconfigured
// shift without anyone having to read the database.
//
// Keyed by payroll period rather than year/month (unlike the older late/break reports)
// because the period is the range payroll actually pays on — a period spanning two
// calendar months is exactly the case a month-keyed report reports wrongly.
//
// Lives in its own file rather than attendance.ts, which is already ~1800 lines
// (Claude.md §3: split a file that is doing too many things).

import type Database from 'better-sqlite3'
import type {
  OtReport,
  OtReportRow,
  OtReportDay,
  CalendarDayType,
  AttendanceDayStatus,
  PayrollPeriod,
} from '../../src/shared/types/entities'

interface RawDayRow {
  employee_id: number
  employee_name: string | null
  date: string
  calendar_type: CalendarDayType
  attendance_status: AttendanceDayStatus
  first_in: string | null
  last_out: string | null
  total_clocked_hours: number
  standard_hours: number | null
  ot_hours: number
  rest_day_ot_hours: number
  holiday_ot_hours: number
}

/**
 * Builds the overtime report for a payroll period.
 *
 * Every employee who has daily records in the period is listed, including those with
 * zero overtime — "who had none" is as much a part of an audit as "who had a lot", and
 * an employee silently missing from the report reads as a bug to the person checking it.
 * Only days that actually carry overtime appear in each employee's `days` breakdown.
 */
export function getOtReport(db: Database.Database, payrollPeriodId: number): OtReport {
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?')
    .get(payrollPeriodId) as PayrollPeriod | undefined
  if (!period) throw new Error(`Payroll period ${payrollPeriodId} not found`)

  const rawDays = db.prepare(`
    SELECT
      dar.employee_id,
      e.name AS employee_name,
      dar.date,
      dar.calendar_type,
      dar.attendance_status,
      dar.first_in,
      dar.last_out,
      dar.total_clocked_hours,
      s.standard_hours AS standard_hours,
      dar.ot_hours,
      dar.rest_day_ot_hours,
      dar.holiday_ot_hours
    FROM daily_attendance_records dar
    LEFT JOIN employees e ON e.id = dar.employee_id
    LEFT JOIN shifts s ON s.id = dar.shift_id
    WHERE dar.payroll_period_id = ?
    ORDER BY e.name ASC, dar.date ASC
  `).all(payrollPeriodId) as RawDayRow[]

  // Snapshotted OT pay from the period's payroll run, if one has been calculated.
  // Read from payroll_run_items rather than recomputed so the report always agrees
  // with what the payslip actually says.
  const payRows = db.prepare(`
    SELECT i.employee_id, i.gross_ot_pay
    FROM payroll_run_items i
    INNER JOIN payroll_runs r ON r.id = i.payroll_run_id
    WHERE r.payroll_period_id = ?
  `).all(payrollPeriodId) as Array<{ employee_id: number; gross_ot_pay: number }>
  const payByEmployee = new Map(payRows.map((p) => [p.employee_id, p.gross_ot_pay]))
  const hasRun = payRows.length > 0

  const byEmployee = new Map<number, OtReportRow>()

  for (const raw of rawDays) {
    let row = byEmployee.get(raw.employee_id)
    if (!row) {
      row = {
        employee_id: raw.employee_id,
        employee_name: raw.employee_name ?? `ID ${raw.employee_id}`,
        days_with_ot: 0,
        total_ot_hours: 0,
        total_rest_day_ot_hours: 0,
        total_holiday_ot_hours: 0,
        ot_pay: hasRun ? (payByEmployee.get(raw.employee_id) ?? 0) : null,
        days: [],
      }
      byEmployee.set(raw.employee_id, row)
    }

    const dayOt = raw.ot_hours + raw.rest_day_ot_hours + raw.holiday_ot_hours
    if (dayOt <= 0) continue

    row.days_with_ot += 1
    row.total_ot_hours += raw.ot_hours
    row.total_rest_day_ot_hours += raw.rest_day_ot_hours
    row.total_holiday_ot_hours += raw.holiday_ot_hours

    const day: OtReportDay = {
      date: raw.date,
      calendar_type: raw.calendar_type,
      attendance_status: raw.attendance_status,
      first_in: raw.first_in,
      last_out: raw.last_out,
      total_clocked_hours: raw.total_clocked_hours,
      standard_hours: raw.standard_hours,
      ot_hours: raw.ot_hours,
      rest_day_ot_hours: raw.rest_day_ot_hours,
      holiday_ot_hours: raw.holiday_ot_hours,
    }
    row.days.push(day)
  }

  const round2 = (n: number) => Math.round(n * 100) / 100
  const rows = [...byEmployee.values()]
    .map((r) => ({
      ...r,
      total_ot_hours: round2(r.total_ot_hours),
      total_rest_day_ot_hours: round2(r.total_rest_day_ot_hours),
      total_holiday_ot_hours: round2(r.total_holiday_ot_hours),
    }))
    .sort((a, b) => {
      // Biggest OT first — that is what the person asking "why is OT so high" opens
      // the report to find. Ties fall back to name so the order is stable.
      const totalA = a.total_ot_hours + a.total_rest_day_ot_hours + a.total_holiday_ot_hours
      const totalB = b.total_ot_hours + b.total_rest_day_ot_hours + b.total_holiday_ot_hours
      if (totalA !== totalB) return totalB - totalA
      return a.employee_name.localeCompare(b.employee_name)
    })

  const grandTotalOtHours = round2(rows.reduce(
    (sum, r) => sum + r.total_ot_hours + r.total_rest_day_ot_hours + r.total_holiday_ot_hours,
    0,
  ))
  const grandTotalOtPay = hasRun
    ? round2(rows.reduce((sum, r) => sum + (r.ot_pay ?? 0), 0))
    : null

  return {
    payroll_period_id: period.id,
    period_name: period.name,
    start_date: period.start_date,
    end_date: period.end_date,
    rows,
    grand_total_ot_hours: grandTotalOtHours,
    grand_total_ot_pay: grandTotalOtPay,
  }
}

/**
 * Exports the same report to Excel — one row per employee-day, so the client can sort,
 * filter and total it themselves. A flat sheet is deliberate: nested/merged rows look
 * tidier but are painful to pivot, and pivoting is the whole point of handing someone
 * a spreadsheet rather than a screenshot.
 */
export async function exportOtReportExcel(
  db: Database.Database,
  payrollPeriodId: number,
  outputDir: string,
): Promise<{ filePath: string; filename: string }> {
  const report = getOtReport(db, payrollPeriodId)

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('OT Report')

  sheet.mergeCells('A1:J1')
  sheet.getCell('A1').value =
    `Overtime Report — ${report.period_name} (${report.start_date} to ${report.end_date})`
  sheet.getCell('A1').font = { bold: true, size: 14 }

  sheet.getRow(2).values = []
  sheet.columns = [
    { header: 'Employee', key: 'employee_name', width: 22 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Day Type', key: 'calendar_type', width: 16 },
    { header: 'First In', key: 'first_in', width: 10 },
    { header: 'Last Out', key: 'last_out', width: 10 },
    { header: 'Clocked Hrs', key: 'total_clocked_hours', width: 12 },
    { header: 'Std Hrs', key: 'standard_hours', width: 10 },
    { header: 'OT Hrs', key: 'ot_hours', width: 10 },
    { header: 'Rest Day OT', key: 'rest_day_ot_hours', width: 12 },
    { header: 'Holiday OT', key: 'holiday_ot_hours', width: 12 },
  ]

  const headerRow = sheet.getRow(3)
  headerRow.values = sheet.columns.map((c: { header: string }) => c.header)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D5DF6' } }

  const timeOnly = (iso: string | null) => (iso ? iso.slice(11, 16) : '')

  for (const row of report.rows) {
    for (const day of row.days) {
      sheet.addRow({
        employee_name: row.employee_name,
        date: day.date,
        calendar_type: day.calendar_type,
        first_in: timeOnly(day.first_in),
        last_out: timeOnly(day.last_out),
        total_clocked_hours: day.total_clocked_hours,
        standard_hours: day.standard_hours ?? '',
        ot_hours: day.ot_hours,
        rest_day_ot_hours: day.rest_day_ot_hours,
        holiday_ot_hours: day.holiday_ot_hours,
      })
    }
  }

  const totalRow = sheet.addRow({
    employee_name: 'TOTAL',
    ot_hours: report.grand_total_ot_hours,
  })
  totalRow.font = { bold: true }

  const safeName = report.period_name.replace(/[^a-zA-Z0-9-_]/g, '_')
  const filename = `OT-Report-${safeName}.xlsx`
  const path = await import('node:path')
  const fs = await import('node:fs')
  fs.mkdirSync(outputDir, { recursive: true })
  const filePath = path.join(outputDir, filename)
  await workbook.xlsx.writeFile(filePath)

  return { filePath, filename }
}
