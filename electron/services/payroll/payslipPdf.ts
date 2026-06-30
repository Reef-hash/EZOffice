// Payslip PDF Generator — generates single-employee payslip PDFs via pdfmake.
// Called by the payroll run orchestrator's printPayslip IPC handler, which writes the
// returned buffer to disk and opens it (Electron `shell`/`app` access stays in the IPC
// layer — this service only produces bytes, so it's testable without Electron running).

import type { Content, Style } from 'pdfmake/interfaces'
import path from 'node:path'
import fs from 'node:fs'
import type Database from 'better-sqlite3'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake/build/pdfmake') as Record<string, unknown>

let fontsRegistered = false
function ensureFontsRegistered(): void {
  if (fontsRegistered) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PdfFonts = require('pdfmake/build/vfs_fonts')
  const vfsData = PdfFonts.pdfMake?.vfs || PdfFonts.vfs || PdfFonts
  if (!vfsData) {
    throw new Error('Failed to load pdfmake fonts: vfs data not found in vfs_fonts module')
  }
  PdfPrinter.vfs = vfsData
  fontsRegistered = true
}

interface PayslipData {
  employee_name: string
  employee_code: string
  ic_number: string
  department_name: string | null
  year: number
  month: number
  run_date: string
  total_regular_hours: number
  total_ot_hours: number
  gross_regular_pay: number
  gross_ot_pay: number
  gross_pay: number
  epf_employee: number
  epf_employer: number
  socso_employee: number
  socso_employer: number
  eis_employee: number
  eis_employer: number
  pcb: number
  advance_deduction: number
  net_pay: number
}

/** Query a single payroll run item (the payslip source data), joined with employee/department/run details. */
function getRunItemWithEmployeeDetails(
  db: Database.Database,
  runId: number,
  employeeId: number,
): PayslipData | null {
  const row = db.prepare(`
    SELECT
      e.name AS employee_name,
      e.employee_code,
      e.ic_number,
      d.name AS department_name,
      r.year,
      r.month,
      r.run_date,
      i.total_regular_hours, i.total_ot_hours,
      i.gross_regular_pay, i.gross_ot_pay, i.gross_pay,
      i.epf_employee, i.epf_employer,
      i.socso_employee, i.socso_employer,
      i.eis_employee, i.eis_employer,
      i.pcb, i.advance_deduction, i.net_pay
    FROM payroll_run_items i
    LEFT JOIN employees e ON e.id = i.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN payroll_runs r ON r.id = i.payroll_run_id
    WHERE i.payroll_run_id = ? AND i.employee_id = ?
  `).get(runId, employeeId) as PayslipData | undefined
  return row ?? null
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Generates a payslip PDF for a single employee in a payroll run, and writes it to `outputDir`.
 * Returns the written file's path so the caller (IPC layer) can open it.
 */
export async function generatePayslipPdf(
  db: Database.Database,
  runId: number,
  employeeId: number,
  outputDir: string,
): Promise<{ filePath: string; filename: string }> {
  const item = getRunItemWithEmployeeDetails(db, runId, employeeId)
  if (!item) {
    throw new Error(`No payslip found for employee ${employeeId} in run ${runId}`)
  }

  const monthLabel = MONTH_NAMES[item.month - 1]
  const periodLabel = `${monthLabel} ${item.year}`
  const totalDeductions =
    item.epf_employee + item.socso_employee + item.eis_employee + item.pcb + item.advance_deduction

  ensureFontsRegistered()

  const content: Content[] = [
      // ── Header ──
      { text: 'EZOffice', style: 'header' },
      { text: 'Payslip', style: 'subheader' },
      { text: periodLabel, style: 'period' },
      { text: `Generated: ${new Date(item.run_date).toLocaleDateString()}`, style: 'generated', margin: [0, 0, 0, 12] },

      // ── Employee Info ──
      { text: 'Employee Details', style: 'sectionHeader' },
      {
        columns: [
          {
            width: '50%',
            table: {
              widths: ['35%', '65%'],
              body: [
                ['Name', item.employee_name],
                ['Code', item.employee_code],
                ['IC Number', item.ic_number],
              ],
            },
            layout: 'noBorders',
          },
          {
            width: '50%',
            table: {
              widths: ['35%', '65%'],
              body: [
                ['Department', item.department_name ?? '-'],
                ['Period', periodLabel],
              ],
            },
            layout: 'noBorders',
          },
        ],
        margin: [0, 6, 0, 14],
      },

      // ── Earnings ──
      { text: 'Earnings', style: 'sectionHeader' },
      {
        table: {
          headerRows: 1,
          widths: ['*', 100, 120],
          body: [
            [
              { text: 'Description', style: 'tableHeader' },
              { text: 'Hours', style: 'tableHeader' },
              { text: 'Amount (RM)', style: 'tableHeader' },
            ],
            ['Regular Pay', item.total_regular_hours, item.gross_regular_pay.toFixed(2)],
            ['Overtime', item.total_ot_hours, item.gross_ot_pay.toFixed(2)],
            [
              { text: 'Gross Pay', style: 'bold', colSpan: 2 },
              {},
              { text: item.gross_pay.toFixed(2), style: 'bold' },
            ],
          ],
        },
        margin: [0, 6, 0, 14],
      },

      // ── Deductions ──
      { text: 'Deductions', style: 'sectionHeader' },
      {
        table: {
          headerRows: 1,
          widths: ['*', 100, 120],
          body: [
            [
              { text: 'Description', style: 'tableHeader' },
              { text: 'Employee', style: 'tableHeader' },
              { text: 'Employer', style: 'tableHeader' },
            ],
            ['EPF', item.epf_employee.toFixed(2), item.epf_employer.toFixed(2)],
            ['SOCSO', item.socso_employee.toFixed(2), item.socso_employer.toFixed(2)],
            ['EIS', item.eis_employee.toFixed(2), item.eis_employer.toFixed(2)],
            ['PCB (Income Tax)', item.pcb.toFixed(2), '-'],
            ['Salary Advance', item.advance_deduction.toFixed(2), '-'],
            [
              { text: 'Total Deductions', style: 'bold', colSpan: 2 },
              {},
              { text: totalDeductions.toFixed(2), style: 'bold' },
            ],
          ],
        },
        margin: [0, 6, 0, 14],
      },

      // ── Net Pay ──
      {
        text: `Net Pay: RM ${item.net_pay.toFixed(2)}`,
        style: 'netPay',
        margin: [0, 10, 0, 0],
      },

      // ── Disclaimer ──
      { text: 'This is a computer-generated payslip. No signature is required.', style: 'disclaimer', margin: [0, 20, 0, 0] },
    ]

  const styles: Record<string, Style> = {
    header: { fontSize: 20, bold: true, color: '#18181b' },
    subheader: { fontSize: 14, color: '#6d5df6', margin: [0, 2, 0, 2] },
    period: { fontSize: 12, bold: true, color: '#0f172a', margin: [0, 0, 0, 2] },
    generated: { fontSize: 9, color: '#9ca3af' },
    sectionHeader: { fontSize: 11, bold: true, color: '#374151', margin: [0, 10, 0, 4], decoration: 'underline' },
    tableHeader: { fontSize: 9, bold: true, color: '#374151', fillColor: '#f1f5f9' },
    bold: { bold: true },
    netPay: { fontSize: 16, bold: true, color: '#0f766e', alignment: 'right' },
    disclaimer: { fontSize: 8, color: '#9ca3af', italics: true, alignment: 'center' },
  }

  const buffer = await (PdfPrinter as Record<string, unknown> & {
    createPdf: (docDef: unknown) => { getBuffer: () => Promise<Buffer> }
  }).createPdf({
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 50],
    content,
    styles,
    defaultStyle: { fontSize: 10, color: '#1e293b' },
  }).getBuffer()

  fs.mkdirSync(outputDir, { recursive: true })
  const safeName = item.employee_name.replace(/[^a-zA-Z0-9]/g, '_')
  const filename = `payslip_${item.year}_${String(item.month).padStart(2, '0')}_${safeName}.pdf`
  const filePath = path.join(outputDir, filename)
  fs.writeFileSync(filePath, buffer)

  return { filePath, filename }
}
