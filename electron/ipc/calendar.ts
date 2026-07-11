// Calendar IPC handlers — thin handlers: validate input → call service → return result.
// Follows the exact same pattern as electron/ipc/attendance.ts.

import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  updateCompanyCalendarProfileSchema,
  createCalendarEventSchema,
  updateCalendarEventSchema,
  createEmployeeCalendarProfileSchema,
} from '../../src/shared/types/inputs'
import * as calendarService from '../services/calendar'

export function registerCalendarHandlers(db: Database.Database): void {
  // ── Company Profile ──────────────────────────────────────

  ipcMain.handle('calendar:getCompanyProfile', async () => {
    try {
      return calendarService.getCompanyCalendarProfile(db)
    } catch (err) {
      throw new Error(`Failed to get company calendar profile: ${String(err)}`)
    }
  })

  ipcMain.handle('calendar:updateCompanyProfile', async (_event, data: unknown) => {
    try {
      const input = updateCompanyCalendarProfileSchema.parse(data)
      return calendarService.updateCompanyCalendarProfile(db, input)
    } catch (err) {
      throw new Error(`Failed to update company calendar profile: ${String(err)}`)
    }
  })

  // ── Employee Profile ─────────────────────────────────────

  ipcMain.handle('calendar:getEmployeeProfile', async (_event, employeeId: number) => {
    try {
      return calendarService.getEmployeeCalendarProfile(db, employeeId)
    } catch (err) {
      throw new Error(`Failed to get employee calendar profile: ${String(err)}`)
    }
  })

  ipcMain.handle('calendar:setEmployeeProfile', async (_event, data: unknown) => {
    try {
      const input = createEmployeeCalendarProfileSchema.parse(data)
      return calendarService.setEmployeeCalendarProfile(db, input)
    } catch (err) {
      throw new Error(`Failed to set employee calendar profile: ${String(err)}`)
    }
  })

  ipcMain.handle('calendar:deleteEmployeeProfile', async (_event, employeeId: number) => {
    try {
      return calendarService.deleteEmployeeCalendarProfile(db, employeeId)
    } catch (err) {
      throw new Error(`Failed to delete employee calendar profile: ${String(err)}`)
    }
  })

  // ── Calendar Events ──────────────────────────────────────

  ipcMain.handle('calendar:listEvents', async (_event, filters?: unknown) => {
    try {
      return calendarService.listCalendarEvents(
        db,
        filters as { year?: number; month?: number } | undefined,
      )
    } catch (err) {
      throw new Error(`Failed to list calendar events: ${String(err)}`)
    }
  })

  ipcMain.handle('calendar:getEventById', async (_event, id: number) => {
    try {
      return calendarService.getCalendarEventById(db, id)
    } catch (err) {
      throw new Error(`Failed to get calendar event ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('calendar:createEvent', async (_event, data: unknown) => {
    try {
      const input = createCalendarEventSchema.parse(data)
      return calendarService.createCalendarEvent(db, input)
    } catch (err) {
      throw new Error(`Failed to create calendar event: ${String(err)}`)
    }
  })

  ipcMain.handle('calendar:updateEvent', async (_event, id: number, data: unknown) => {
    try {
      const input = updateCalendarEventSchema.parse(data)
      return calendarService.updateCalendarEvent(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update calendar event ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('calendar:deleteEvent', async (_event, id: number) => {
    try {
      return calendarService.deleteCalendarEvent(db, id)
    } catch (err) {
      throw new Error(`Failed to delete calendar event ${id}: ${String(err)}`)
    }
  })

  // ── Day Resolution ───────────────────────────────────────

  ipcMain.handle('calendar:resolveDay', async (_event, employeeId: number, date: string) => {
    try {
      return calendarService.resolveCalendarDay(db, employeeId, date)
    } catch (err) {
      throw new Error(`Failed to resolve calendar day: ${String(err)}`)
    }
  })

  ipcMain.handle('calendar:resolveMonth', async (_event, employeeId: number, year: number, month: number) => {
    try {
      return calendarService.resolveCalendarMonth(db, employeeId, year, month)
    } catch (err) {
      throw new Error(`Failed to resolve calendar month: ${String(err)}`)
    }
  })

  ipcMain.handle('calendar:resolveAllEmployees', async (_event, year: number, month: number) => {
    try {
      return calendarService.resolveCalendarForAllEmployees(db, year, month)
    } catch (err) {
      throw new Error(`Failed to resolve calendar for all employees: ${String(err)}`)
    }
  })
}
