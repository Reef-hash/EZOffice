// Payroll IPC handlers — thin handlers: validate input → call service → return result.
// Follows the exact same pattern as electron/ipc/attendance.ts and masterData.ts.

import { app, ipcMain, shell } from 'electron'
import path from 'node:path'
import type Database from 'better-sqlite3'
import {
  createSalaryStructureSchema,
  updateSalaryStructureSchema,
  updatePayrollSettingsSchema,
  createEpfRateSchema,
  updateEpfRateSchema,
  createSocsoRateSchema,
  updateSocsoRateSchema,
  createEisRateSchema,
  updateEisRateSchema,
  createPcbBracketSchema,
  updatePcbBracketSchema,
  createSalaryAdvanceSchema,
  updateSalaryAdvanceSchema,
  createPayrollRunSchema,
  createPayrollPeriodSchema,
  updatePayrollPeriodStatusSchema,
} from '../../src/shared/types/inputs'
import { getMonthlyAttendanceSummary } from '../services/attendanceSummary'
import * as salaryStructureService from '../services/payroll/salaryStructure'
import * as payrollSettingsService from '../services/payroll/settings'
import * as statutoryRatesService from '../services/payroll/statutoryRates'
import { checkRateTablesForRun } from '../services/payroll/statutoryRates'
import * as salaryAdvancesService from '../services/payroll/salaryAdvances'
import * as payrollRunService from '../services/payroll/payrollRun'
import { generatePayslipPdf } from '../services/payroll/payslipPdf'
import * as payrollPeriodService from '../services/payroll/payrollPeriod'

export function registerPayrollHandlers(db: Database.Database): void {
  // ── Attendance Monthly Summary (executed by Payroll, lives in attendance namespace) ──

  ipcMain.handle('attendance:getMonthlySummary', async (_event, filters: unknown) => {
    try {
      const f = filters as { employeeIds?: number[]; year: number; month: number }
      return getMonthlyAttendanceSummary(db, f)
    } catch (err) {
      throw new Error(`Failed to get monthly attendance summary: ${String(err)}`)
    }
  })

  // ── Salary Structures ─────────────────────────────────

  ipcMain.handle('payroll:salaryStructures:list', async (_event, employeeId?: number) => {
    try {
      return salaryStructureService.listSalaryStructures(db, employeeId)
    } catch (err) {
      throw new Error(`Failed to list salary structures: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:salaryStructures:get', async (_event, id: number) => {
    try {
      return salaryStructureService.getSalaryStructureById(db, id)
    } catch (err) {
      throw new Error(`Failed to get salary structure ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:salaryStructures:getCurrent', async (_event, employeeId: number, asOfDate?: string) => {
    try {
      return salaryStructureService.getCurrentSalaryStructure(db, employeeId, asOfDate)
    } catch (err) {
      throw new Error(`Failed to get current salary structure for employee ${employeeId}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:salaryStructures:create', async (_event, data: unknown) => {
    try {
      const input = createSalaryStructureSchema.parse(data)
      return salaryStructureService.createSalaryStructure(db, input)
    } catch (err) {
      throw new Error(`Failed to create salary structure: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:salaryStructures:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateSalaryStructureSchema.parse(data)
      return salaryStructureService.updateSalaryStructure(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update salary structure ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:salaryStructures:delete', async (_event, id: number) => {
    try {
      return salaryStructureService.deleteSalaryStructure(db, id)
    } catch (err) {
      throw new Error(`Failed to delete salary structure ${id}: ${String(err)}`)
    }
  })

  // ── Payroll Settings ──────────────────────────────────

  ipcMain.handle('payroll:settings:get', async () => {
    try {
      return payrollSettingsService.getPayrollSettings(db)
    } catch (err) {
      throw new Error(`Failed to get payroll settings: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:settings:update', async (_event, data: unknown) => {
    try {
      const input = updatePayrollSettingsSchema.parse(data)
      return payrollSettingsService.updatePayrollSettings(db, input)
    } catch (err) {
      throw new Error(`Failed to update payroll settings: ${String(err)}`)
    }
  })

  // ── EPF Rates ─────────────────────────────────────────

  ipcMain.handle('payroll:epfRates:list', async () => {
    try { return statutoryRatesService.listEpfRates(db) } catch (err) {
      throw new Error(`Failed to list EPF rates: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:epfRates:create', async (_event, data: unknown) => {
    try {
      const input = createEpfRateSchema.parse(data)
      return statutoryRatesService.createEpfRate(db, input)
    } catch (err) {
      throw new Error(`Failed to create EPF rate: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:epfRates:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateEpfRateSchema.parse(data)
      return statutoryRatesService.updateEpfRate(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update EPF rate ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:epfRates:delete', async (_event, id: number) => {
    try { return statutoryRatesService.deleteEpfRate(db, id) } catch (err) {
      throw new Error(`Failed to delete EPF rate ${id}: ${String(err)}`)
    }
  })

  // ── SOCSO Rates ───────────────────────────────────────

  ipcMain.handle('payroll:socsoRates:list', async () => {
    try { return statutoryRatesService.listSocsoRates(db) } catch (err) {
      throw new Error(`Failed to list SOCSO rates: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:socsoRates:create', async (_event, data: unknown) => {
    try {
      const input = createSocsoRateSchema.parse(data)
      return statutoryRatesService.createSocsoRate(db, input)
    } catch (err) {
      throw new Error(`Failed to create SOCSO rate: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:socsoRates:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateSocsoRateSchema.parse(data)
      return statutoryRatesService.updateSocsoRate(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update SOCSO rate ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:socsoRates:delete', async (_event, id: number) => {
    try { return statutoryRatesService.deleteSocsoRate(db, id) } catch (err) {
      throw new Error(`Failed to delete SOCSO rate ${id}: ${String(err)}`)
    }
  })

  // ── EIS Rates ─────────────────────────────────────────

  ipcMain.handle('payroll:eisRates:list', async () => {
    try { return statutoryRatesService.listEisRates(db) } catch (err) {
      throw new Error(`Failed to list EIS rates: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:eisRates:create', async (_event, data: unknown) => {
    try {
      const input = createEisRateSchema.parse(data)
      return statutoryRatesService.createEisRate(db, input)
    } catch (err) {
      throw new Error(`Failed to create EIS rate: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:eisRates:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateEisRateSchema.parse(data)
      return statutoryRatesService.updateEisRate(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update EIS rate ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:eisRates:delete', async (_event, id: number) => {
    try { return statutoryRatesService.deleteEisRate(db, id) } catch (err) {
      throw new Error(`Failed to delete EIS rate ${id}: ${String(err)}`)
    }
  })

  // ── PCB Brackets ──────────────────────────────────────

  ipcMain.handle('payroll:pcbBrackets:list', async () => {
    try { return statutoryRatesService.listPcbBrackets(db) } catch (err) {
      throw new Error(`Failed to list PCB brackets: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:pcbBrackets:create', async (_event, data: unknown) => {
    try {
      const input = createPcbBracketSchema.parse(data)
      return statutoryRatesService.createPcbBracket(db, input)
    } catch (err) {
      throw new Error(`Failed to create PCB bracket: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:pcbBrackets:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updatePcbBracketSchema.parse(data)
      return statutoryRatesService.updatePcbBracket(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update PCB bracket ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:pcbBrackets:delete', async (_event, id: number) => {
    try { return statutoryRatesService.deletePcbBracket(db, id) } catch (err) {
      throw new Error(`Failed to delete PCB bracket ${id}: ${String(err)}`)
    }
  })

  // ── Salary Advances ───────────────────────────────────

  ipcMain.handle('payroll:salaryAdvances:list', async (_event, employeeId?: number) => {
    try { return salaryAdvancesService.listSalaryAdvances(db, employeeId) } catch (err) {
      throw new Error(`Failed to list salary advances: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:salaryAdvances:get', async (_event, id: number) => {
    try { return salaryAdvancesService.getSalaryAdvanceById(db, id) } catch (err) {
      throw new Error(`Failed to get salary advance ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:salaryAdvances:create', async (_event, data: unknown) => {
    try {
      const input = createSalaryAdvanceSchema.parse(data)
      return salaryAdvancesService.createSalaryAdvance(db, input)
    } catch (err) {
      throw new Error(`Failed to create salary advance: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:salaryAdvances:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateSalaryAdvanceSchema.parse(data)
      return salaryAdvancesService.updateSalaryAdvance(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update salary advance ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:salaryAdvances:delete', async (_event, id: number) => {
    try { return salaryAdvancesService.deleteSalaryAdvance(db, id) } catch (err) {
      throw new Error(`Failed to delete salary advance ${id}: ${String(err)}`)
    }
  })

  // ── Payroll Runs ──────────────────────────────────────

  ipcMain.handle('payroll:runs:list', async () => {
    try { return payrollRunService.listPayrollRuns(db) } catch (err) {
      throw new Error(`Failed to list payroll runs: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:runs:get', async (_event, id: number) => {
    try { return payrollRunService.getPayrollRunById(db, id) } catch (err) {
      throw new Error(`Failed to get payroll run ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:runs:create', async (_event, data: unknown) => {
    try {
      const input = createPayrollRunSchema.parse(data)
      return payrollRunService.createPayrollRun(db, input)
    } catch (err) {
      throw new Error(`Failed to create payroll run: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:runs:calculate', async (_event, id: number) => {
    try {
      return payrollRunService.calculatePayrollRun(db, id)
    } catch (err) {
      throw new Error(`Failed to calculate payroll run ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:runs:items', async (_event, runId: number) => {
    try { return payrollRunService.getPayrollRunItems(db, runId) } catch (err) {
      throw new Error(`Failed to get payroll run items for run ${runId}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:runs:checkRateTables', async () => {
    try { return checkRateTablesForRun(db) } catch (err) {
      throw new Error(`Failed to check rate tables: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:runs:finalize', async (_event, id: number) => {
    try { return payrollRunService.finalizePayrollRun(db, id) } catch (err) {
      throw new Error(`Failed to finalize payroll run ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:runs:printPayslip', async (_event, runId: number, employeeId: number) => {
    try {
      const payslipsDir = path.join(app.getPath('userData'), 'payslips')
      const result = await generatePayslipPdf(db, runId, employeeId, payslipsDir)
      await shell.openPath(result.filePath)
      return result
    } catch (err) {
      throw new Error(`Failed to print payslip: ${String(err)}`)
    }
  })

  // ── Payroll Periods ──────────────────────────────────────

  ipcMain.handle('payroll:periods:list', async () => {
    try {
      return payrollPeriodService.listPayrollPeriods(db)
    } catch (err) {
      throw new Error(`Failed to list payroll periods: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:periods:get', async (_event, id: number) => {
    try {
      return payrollPeriodService.getPayrollPeriodById(db, id)
    } catch (err) {
      throw new Error(`Failed to get payroll period ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:periods:create', async (_event, data: unknown) => {
    try {
      const input = createPayrollPeriodSchema.parse(data)
      return payrollPeriodService.createPayrollPeriod(db, input)
    } catch (err) {
      throw new Error(`Failed to create payroll period: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:periods:updateStatus', async (_event, id: number, data: unknown) => {
    try {
      const input = updatePayrollPeriodStatusSchema.parse(data)
      return payrollPeriodService.updatePayrollPeriodStatus(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update payroll period status: ${String(err)}`)
    }
  })

  ipcMain.handle('payroll:periods:delete', async (_event, id: number) => {
    try {
      return payrollPeriodService.deletePayrollPeriod(db, id)
    } catch (err) {
      throw new Error(`Failed to delete payroll period ${id}: ${String(err)}`)
    }
  })

  // ── Phase 6: Re-open ────────────────────────────────────

  ipcMain.handle('payroll:periods:reopen', async (_event, id: number) => {
    try {
      return payrollPeriodService.reopenPayrollPeriod(db, id)
    } catch (err) {
      throw new Error(`Failed to reopen payroll period ${id}: ${String(err)}`)
    }
  })
}
