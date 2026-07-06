// Settings IPC handlers (Phase D1).

import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { updateCompanySettingsSchema } from '../../src/shared/types/inputs'
import * as settingsService from '../services/settings'

export function registerSettingsHandlers(db: Database.Database): void {
  ipcMain.handle('settings:getCompany', async () => {
    try {
      return settingsService.getCompanySettings(db)
    } catch (err) {
      throw new Error(`Failed to get company settings: ${String(err)}`)
    }
  })

  ipcMain.handle('settings:updateCompany', async (_event, data: unknown) => {
    try {
      const input = updateCompanySettingsSchema.parse(data)
      return settingsService.updateCompanySettings(db, input)
    } catch (err) {
      throw new Error(`Failed to update company settings: ${String(err)}`)
    }
  })
}
