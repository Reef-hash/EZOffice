// Attendance IPC handlers — thin handlers: validate input → call service → return result.
// Follows the exact same pattern as electron/ipc/masterData.ts.

import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  clockActionSchema,
  createAttendanceLogSchema,
  updateAttendanceLogSchema,
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
}
