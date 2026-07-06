// Export IPC handlers (Phase D3).

import { ipcMain, shell } from 'electron'
import type Database from 'better-sqlite3'
import { exportEmployeesToExcel, exportPayrollToExcel, exportAttendanceToExcel } from '../services/export'

export function registerExportHandlers(db: Database.Database): void {
  ipcMain.handle('export:employees', async () => {
    try {
      const { filePath, filename } = await exportEmployeesToExcel(db)
      // Open the file in the default Excel application
      await shell.openPath(filePath)
      return { filePath, filename }
    } catch (err) {
      throw new Error(`Failed to export employees: ${String(err)}`)
    }
  })

  ipcMain.handle('export:payroll', async (_event, runId: number) => {
    try {
      const { filePath, filename } = await exportPayrollToExcel(db, runId)
      await shell.openPath(filePath)
      return { filePath, filename }
    } catch (err) {
      throw new Error(`Failed to export payroll: ${String(err)}`)
    }
  })

  ipcMain.handle('export:attendance', async (_event, filters: unknown) => {
    try {
      const { dateFrom, dateTo } = filters as { dateFrom: string; dateTo: string }
      const { filePath, filename } = await exportAttendanceToExcel(db, dateFrom, dateTo)
      await shell.openPath(filePath)
      return { filePath, filename }
    } catch (err) {
      throw new Error(`Failed to export attendance: ${String(err)}`)
    }
  })
}
