// Export service — generates Excel files for data export (Phase D3).
// Each export function takes `db`, generates an xlsx file, and returns the file path.

import type Database from 'better-sqlite3'
import { Workbook } from 'exceljs'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

/** Export all employees to Excel. */
export async function exportEmployeesToExcel(db: Database.Database): Promise<{ filePath: string; filename: string }> {
  const employees = db.prepare(`
    SELECT
      e.employee_code,
      e.name,
      e.ic_number,
      e.phone,
      e.email,
      d.name AS department,
      s.name AS shift,
      e.status,
      e.date_joined
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN shifts s ON s.id = e.shift_id
    ORDER BY e.employee_code
  `).all() as Array<{
    employee_code: string
    name: string
    ic_number: string
    phone: string | null
    email: string | null
    department: string | null
    shift: string | null
    status: string
    date_joined: string
  }>

  const workbook = new Workbook()
  const worksheet = workbook.addWorksheet('Employees')

  // Header row
  worksheet.columns = [
    { header: 'Code', key: 'employee_code', width: 12 },
    { header: 'Name', key: 'name', width: 20 },
    { header: 'IC Number', key: 'ic_number', width: 15 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Email', key: 'email', width: 20 },
    { header: 'Department', key: 'department', width: 15 },
    { header: 'Shift', key: 'shift', width: 12 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Date Joined', key: 'date_joined', width: 12 },
  ]

  // Style header row
  worksheet.getRow(1).font = { bold: true }
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D5DF6' } }
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

  // Add data rows
  employees.forEach((emp) => {
    worksheet.addRow(emp)
  })

  return writeWorkbookToFile(workbook, 'employees.xlsx')
}

/** Export payroll run items to Excel. */
export async function exportPayrollToExcel(
  db: Database.Database,
  runId: number,
): Promise<{ filePath: string; filename: string }> {
  const items = db.prepare(`
    SELECT
      e.name AS employee_name,
      e.employee_code,
      i.gross_regular_pay,
      i.gross_ot_pay,
      i.gross_pay,
      i.epf_employee,
      i.socso_employee,
      i.eis_employee,
      i.pcb,
      i.advance_deduction,
      i.net_pay
    FROM payroll_run_items i
    LEFT JOIN employees e ON e.id = i.employee_id
    WHERE i.payroll_run_id = ?
    ORDER BY e.name
  `).all(runId) as Array<{
    employee_name: string
    employee_code: string
    gross_regular_pay: number
    gross_ot_pay: number
    gross_pay: number
    epf_employee: number
    socso_employee: number
    eis_employee: number
    pcb: number
    advance_deduction: number
    net_pay: number
  }>

  const run = db.prepare('SELECT year, month, run_date FROM payroll_runs WHERE id = ?').get(runId) as {
    year: number
    month: number
    run_date: string
  } | undefined

  const workbook = new Workbook()
  const worksheet = workbook.addWorksheet('Payroll')

  // Title
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][run?.month ?? 0] || ''
  worksheet.mergeCells('A1:K1')
  const titleCell = worksheet.getCell('A1')
  titleCell.value = `Payroll Run — ${monthName} ${run?.year}`
  titleCell.font = { bold: true, size: 14 }
  titleCell.alignment = { horizontal: 'center' }

  worksheet.addRow([])

  // Header row
  worksheet.columns = [
    { header: 'Code', key: 'employee_code', width: 12 },
    { header: 'Name', key: 'employee_name', width: 20 },
    { header: 'Regular Pay', key: 'gross_regular_pay', width: 12 },
    { header: 'OT Pay', key: 'gross_ot_pay', width: 12 },
    { header: 'Gross', key: 'gross_pay', width: 12 },
    { header: 'EPF', key: 'epf_employee', width: 10 },
    { header: 'SOCSO', key: 'socso_employee', width: 10 },
    { header: 'EIS', key: 'eis_employee', width: 10 },
    { header: 'PCB', key: 'pcb', width: 10 },
    { header: 'Advance', key: 'advance_deduction', width: 10 },
    { header: 'Net Pay', key: 'net_pay', width: 12 },
  ]

  const headerRow = worksheet.getRow(3)
  headerRow.font = { bold: true }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D5DF6' } }
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }

  // Add data rows
  items.forEach((item) => {
    worksheet.addRow(item)
  })

  // Format currency columns
  const currencyColumns = [3, 4, 5, 6, 7, 8, 9, 10, 11]
  worksheet.eachRow((row) => {
    currencyColumns.forEach((col) => {
      const cell = row.getCell(col)
      if (cell.value && typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00'
      }
    })
  })

  return writeWorkbookToFile(workbook, `payroll_${run?.year}_${String(run?.month ?? 1).padStart(2, '0')}.xlsx`)
}

/** Export attendance logs to Excel. */
export async function exportAttendanceToExcel(
  db: Database.Database,
  dateFrom: string,
  dateTo: string,
): Promise<{ filePath: string; filename: string }> {
  const logs = db.prepare(`
    SELECT
      DATE(a.timestamp) AS date,
      e.name AS employee_name,
      e.employee_code,
      CASE WHEN a.type = 'in' THEN TIME(a.timestamp) ELSE NULL END AS clock_in,
      CASE WHEN a.type = 'out' THEN TIME(a.timestamp) ELSE NULL END AS clock_out,
      s.name AS shift,
      a.status
    FROM attendance_logs a
    LEFT JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE DATE(a.timestamp) BETWEEN ? AND ?
    ORDER BY a.timestamp DESC
  `).all(dateFrom, dateTo) as Array<{
    date: string
    employee_name: string
    employee_code: string
    clock_in: string | null
    clock_out: string | null
    shift: string | null
    status: string
  }>

  const workbook = new Workbook()
  const worksheet = workbook.addWorksheet('Attendance')

  // Header row
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Code', key: 'employee_code', width: 12 },
    { header: 'Employee', key: 'employee_name', width: 20 },
    { header: 'Shift', key: 'shift', width: 12 },
    { header: 'Clock In', key: 'clock_in', width: 12 },
    { header: 'Clock Out', key: 'clock_out', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
  ]

  // Style header row
  worksheet.getRow(1).font = { bold: true }
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D5DF6' } }
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

  // Add data rows
  logs.forEach((log) => {
    worksheet.addRow(log)
  })

  return writeWorkbookToFile(workbook, `attendance_${dateFrom}_to_${dateTo}.xlsx`)
}

/** Helper: Write workbook to temp file and return path. */
async function writeWorkbookToFile(workbook: Workbook, filename: string): Promise<{ filePath: string; filename: string }> {
  const tempDir = path.join(os.tmpdir(), 'ezoffice-exports')

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const filePath = path.join(tempDir, filename)

  // Write file
  await workbook.xlsx.writeFile(filePath)

  return { filePath, filename }
}
