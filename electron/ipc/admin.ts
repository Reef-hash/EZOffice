// Admin IPC handlers — authentication & audit log access.
// Thin handlers: validate input → call service → return result.

import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import * as adminService from '../services/admin'

export function registerAdminHandlers(db: Database.Database): void {
  /**
   * admin:init — create initial admin user (called once on app startup if no admins exist).
   * Validates password strength.
   */
  ipcMain.handle('admin:init', async (_event, data: unknown) => {
    try {
      const { username, password } = data as { username: string; password: string }

      if (!username || !password) {
        throw new Error('Username and password are required')
      }

      const existingCount = adminService.getAdminUserCount(db)
      if (existingCount > 0) {
        throw new Error('Admin user already exists')
      }

      const admin = adminService.createAdminUser(db, username, password)
      return { success: true, admin: { id: admin.id, username: admin.username } }
    } catch (err) {
      throw new Error(`Failed to create admin user: ${String(err)}`)
    }
  })

  /**
   * admin:login — authenticate with username/password.
   * Returns admin ID on success.
   */
  ipcMain.handle('admin:login', async (_event, data: unknown) => {
    try {
      const { username, password } = data as { username: string; password: string }

      if (!username || !password) {
        throw new Error('Username and password are required')
      }

      const result = adminService.authenticateAdmin(db, username, password)

      if (!result.success) {
        throw new Error(result.error || 'Authentication failed')
      }

      return { success: true, adminId: result.adminId }
    } catch (err) {
      throw new Error(`Login failed: ${String(err)}`)
    }
  })

  /**
   * admin:logout — log logout action.
   */
  ipcMain.handle('admin:logout', async (_event, adminId: number) => {
    try {
      adminService.logLogout(db, adminId)
      return { success: true }
    } catch (err) {
      throw new Error(`Failed to log logout: ${String(err)}`)
    }
  })

  /**
   * admin:validatePassword — check if password meets strength requirements.
   * Used by signup form for real-time feedback.
   */
  ipcMain.handle('admin:validatePassword', async (_event, password: string) => {
    try {
      const strength = adminService.validatePasswordStrength(password)
      return { valid: strength.valid, errors: strength.errors }
    } catch (err) {
      throw new Error(`Failed to validate password: ${String(err)}`)
    }
  })

  /**
   * audit:list — get audit log entries (admin-only).
   * Returns up to 1000 most recent entries.
   */
  ipcMain.handle('audit:list', async (_event, filters?: unknown) => {
    try {
      return adminService.getAuditLog(
        db,
        filters as { adminId?: number; tableName?: string; action?: string; limitDays?: number } | undefined,
      )
    } catch (err) {
      throw new Error(`Failed to fetch audit log: ${String(err)}`)
    }
  })
}
