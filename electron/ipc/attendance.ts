// Attendance IPC handlers — thin handlers: validate input → call service → return result.
// Follows the exact same pattern as electron/ipc/masterData.ts.

import { ipcMain, app, shell } from 'electron'
import path from 'node:path'
import type Database from 'better-sqlite3'
import {
  clockActionSchema,
  createAttendanceLogSchema,
  updateAttendanceLogSchema,
  createShiftSchema,
  updateShiftSchema,
  assignShiftSchema,
  validateClockSchema,
  createLeaveRequestSchema,
  leaveBalanceSchema,
  leaveListSchema,
  excuseLateSchema,
  lateReportSchema,
  monthlySummarySchema,
} from '../../src/shared/types/inputs'
import * as attendanceService from '../services/attendance'

export function registerAttendanceHandlers(db: Database.Database): void {
  ipcMain.handle('attendance:list', async (_event, filters?: unknown) => {
    try {
      return attendanceService.listAttendanceLogs(
        db,
        filters as { employeeId?: number; dateFrom?: string; dateTo?: string } | undefined,
      )
    } catch (err) {
      throw new Error(`Failed to list attendance logs: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:get', async (_event, id: number) => {
    try {
      return attendanceService.getAttendanceLogById(db, id)
    } catch (err) {
      throw new Error(`Failed to get attendance log ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:getLastForEmployee', async (_event, employeeId: number) => {
    try {
      return attendanceService.getLastLogForEmployee(db, employeeId)
    } catch (err) {
      throw new Error(`Failed to get last log for employee ${employeeId}: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:clockIn', async (_event, data: unknown) => {
    try {
      const input = clockActionSchema.parse(data)
      return attendanceService.clockIn(db, input.employee_id, input.timestamp)
    } catch (err) {
      throw new Error(`Failed to clock in: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:clockOut', async (_event, data: unknown) => {
    try {
      const input = clockActionSchema.parse(data)
      return attendanceService.clockOut(db, input.employee_id, input.timestamp)
    } catch (err) {
      throw new Error(`Failed to clock out: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:create', async (_event, data: unknown) => {
    try {
      const input = createAttendanceLogSchema.parse(data)
      return attendanceService.createManualLog(db, input)
    } catch (err) {
      throw new Error(`Failed to create attendance log: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateAttendanceLogSchema.parse(data)
      return attendanceService.updateAttendanceLog(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update attendance log ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:delete', async (_event, id: number) => {
    try {
      return attendanceService.deleteAttendanceLog(db, id)
    } catch (err) {
      throw new Error(`Failed to delete attendance log ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:syncFromDevice', async (_event) => {
    try {
      // Read device settings from payroll_settings singleton
      const settings = db.prepare(`
        SELECT device_ip, device_port FROM payroll_settings WHERE id = 1
      `).get() as { device_ip: string | null; device_port: number } | undefined

      if (!settings?.device_ip) {
        throw new Error('Device IP not configured. Configure in Device Settings first.')
      }

      const port = settings.device_port || 4370
      return await attendanceService.syncFromDeviceEthernet(db, settings.device_ip, port)
    } catch (err) {
      throw new Error(`Device sync failed: ${String(err)}`)
    }
  })

  // ── Phase C (C1): Shifts ──────────────────────────────

  ipcMain.handle('attendance:listShifts', async () => {
    try {
      return attendanceService.listShifts(db)
    } catch (err) {
      throw new Error(`Failed to list shifts: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:getShiftById', async (_event, id: number) => {
    try {
      return attendanceService.getShiftById(db, id)
    } catch (err) {
      throw new Error(`Failed to get shift ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:createShift', async (_event, data: unknown) => {
    try {
      const input = createShiftSchema.parse(data)
      return attendanceService.createShift(db, input)
    } catch (err) {
      throw new Error(`Failed to create shift: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:updateShift', async (_event, id: number, data: unknown) => {
    try {
      const input = updateShiftSchema.parse(data)
      return attendanceService.updateShift(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update shift ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:deleteShift', async (_event, id: number) => {
    try {
      return attendanceService.deleteShift(db, id)
    } catch (err) {
      throw new Error(`Failed to delete shift ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:assignShift', async (_event, data: unknown) => {
    try {
      const input = assignShiftSchema.parse(data)
      return attendanceService.assignShiftToEmployee(db, input.employee_id, input.shift_id)
    } catch (err) {
      throw new Error(`Failed to assign shift: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:validateClock', async (_event, data: unknown) => {
    try {
      const input = validateClockSchema.parse(data)
      return attendanceService.validateClockAgainstShift(db, input.employee_id, input.timestamp)
    } catch (err) {
      throw new Error(`Failed to validate clock: ${String(err)}`)
    }
  })

  // ── Phase C (C2): Leave ───────────────────────────────

  ipcMain.handle('attendance:getLeaveBalance', async (_event, data: unknown) => {
    try {
      const input = leaveBalanceSchema.parse(data)
      return attendanceService.getEmployeeLeaveBalance(db, input.employee_id, input.year)
    } catch (err) {
      throw new Error(`Failed to get leave balance: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:createLeaveRequest', async (_event, data: unknown) => {
    try {
      const input = createLeaveRequestSchema.parse(data)
      return attendanceService.createLeaveRequest(db, input)
    } catch (err) {
      throw new Error(`Failed to create leave request: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:approveLeave', async (_event, id: number) => {
    try {
      return attendanceService.approveLeave(db, id)
    } catch (err) {
      throw new Error(`Failed to approve leave ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:rejectLeave', async (_event, id: number) => {
    try {
      return attendanceService.rejectLeave(db, id)
    } catch (err) {
      throw new Error(`Failed to reject leave ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:listLeave', async (_event, filters?: unknown) => {
    try {
      const f = leaveListSchema.parse(filters ?? {})
      return attendanceService.listLeaveRecords(db, f)
    } catch (err) {
      throw new Error(`Failed to list leave records: ${String(err)}`)
    }
  })

  // ── Phase C (C3): Late detection ──────────────────────

  ipcMain.handle('attendance:excuseLate', async (_event, data: unknown) => {
    try {
      const input = excuseLateSchema.parse(data)
      return attendanceService.excuseLateEntry(db, input.log_id)
    } catch (err) {
      throw new Error(`Failed to excuse late entry: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:getLateReport', async (_event, data: unknown) => {
    try {
      const input = lateReportSchema.parse(data)
      return attendanceService.getLateReport(db, input.year, input.month)
    } catch (err) {
      throw new Error(`Failed to get late report: ${String(err)}`)
    }
  })

  // ── Phase C (C4): Monthly calendar + Excel export ─────

  ipcMain.handle('attendance:getMonthlyCalendar', async (_event, data: unknown) => {
    try {
      const input = monthlySummarySchema.parse(data)
      return attendanceService.getMonthlyCalendar(db, input.employee_id, input.year, input.month)
    } catch (err) {
      throw new Error(`Failed to get monthly calendar: ${String(err)}`)
    }
  })

  ipcMain.handle('attendance:exportMonthly', async (_event, data: unknown) => {
    try {
      const input = lateReportSchema.parse(data)
      // Output dir: <userData>/exports/attendance — keeps Electron-specific path
      // resolution out of the service layer (same pattern as payslipPdf).
      const outputDir = path.join(app.getPath('userData'), 'exports', 'attendance')
      const result = await attendanceService.exportMonthlyAttendanceExcel(
        db,
        input.year,
        input.month,
        outputDir,
      )
      // Open the generated file for the admin — mirrors the payslip PDF flow.
      await shell.openPath(result.filePath)
      return result
    } catch (err) {
      throw new Error(`Failed to export monthly attendance: ${String(err)}`)
    }
  })
}
