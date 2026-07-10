// License activation IPC handlers (docs/LICENSE_INTEGRATION_AUDIT.md).
// Thin handlers: validate input with Zod, call the service, return result.
// Every mutating handler re-throws with context — no silent failures.

import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { sendActivationOtpSchema, verifyActivationOtpSchema } from '../../src/shared/types/inputs'
import * as licenseService from '../services/license'

export function registerLicenseHandlers(db: Database.Database): void {
  ipcMain.handle('license:getState', async () => {
    try {
      return licenseService.getLicenseState(db)
    } catch (err) {
      throw new Error(`Failed to read license state: ${String(err)}`)
    }
  })

  ipcMain.handle('license:checkGrace', async () => {
    try {
      return licenseService.checkGraceWindow(db)
    } catch (err) {
      throw new Error(`Failed to check license grace window: ${String(err)}`)
    }
  })

  ipcMain.handle('license:sendOtp', async (_event, data: unknown) => {
    try {
      const input = sendActivationOtpSchema.parse(data)
      await licenseService.sendActivationOtp(input.email)
      return { sent: true }
    } catch (err) {
      throw new Error(`Failed to send activation code: ${String(err)}`)
    }
  })

  ipcMain.handle('license:verifyOtp', async (_event, data: unknown) => {
    try {
      const input = verifyActivationOtpSchema.parse(data)
      return await licenseService.verifyOtpAndActivate(db, input.email, input.token)
    } catch (err) {
      throw new Error(`Activation failed: ${String(err)}`)
    }
  })
}
