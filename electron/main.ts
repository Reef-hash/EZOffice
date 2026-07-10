// EZOffice Electron main process.
// Creates the BrowserWindow, initializes the database, runs migrations,
// registers IPC handlers, then loads the Vite renderer.

// Polyfill __filename and __dirname BEFORE any other imports.
// native CJS modules (better-sqlite3) reference these globals at require-time.
// Object.defineProperty is a visible side-effect — bundlers must preserve it.
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
Object.defineProperty(globalThis, '__filename', {
  value: fileURLToPath(import.meta.url),
  writable: false,
  configurable: true,
})
Object.defineProperty(globalThis, '__dirname', {
  value: dirname(fileURLToPath(import.meta.url)),
  writable: false,
  configurable: true,
})

import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { getDb, resolveDbPath, closeDb } from './db/connection'
import { runMigrations } from './db/migrate'
import { registerMasterDataHandlers } from './ipc/masterData'
import { registerAttendanceHandlers } from './ipc/attendance'
import { registerPayrollHandlers } from './ipc/payroll'
import { registerAdminHandlers } from './ipc/admin'
import { registerSettingsHandlers } from './ipc/settings'
import { registerExportHandlers } from './ipc/export'
import * as adminService from './services/admin'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'EZOffice',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Remove the default menu bar for a cleaner desktop-app feel
  mainWindow.setMenuBarVisibility(false)

  // Load the renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    // Development: load from Vite dev server
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    // Production: load the built index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Initialize database and run migrations before the app is ready to show windows
function initDatabase(): void {
  // In production, use Electron's userData path for the DB file
  const dbPath = app.isPackaged
    ? resolveDbPath(app.getPath('userData'))
    : resolveDbPath()

  const db = getDb(dbPath)

  // In dev mode, the bundled output lives in dist-electron/, but migrations
  // are in electron/db/migrations/ (source tree). In production both live side
  // by side as part of the packaged app.
  const migrationsDir = app.isPackaged
    ? path.join(__dirname, 'db/migrations')
    : path.resolve(__dirname, '..', 'electron', 'db', 'migrations')

  const applied = runMigrations(db, migrationsDir)
  if (applied.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[DB] Applied migrations: ${applied.join(', ')}`)
  }

  // Register all IPC handlers — must happen before the renderer loads
  registerAdminHandlers(db)
  registerMasterDataHandlers(db)
  registerAttendanceHandlers(db)
  registerPayrollHandlers(db)
  registerSettingsHandlers(db)
  registerExportHandlers(db)

  // Check if this is first-time setup (no admin users yet)
  const adminCount = adminService.getAdminUserCount(db)
  if (adminCount === 0) {
    // eslint-disable-next-line no-console
    console.log('[DB] No admin users found. App will show signup screen on first launch.')
  }
}

function setupAutoUpdater(): void {
  // Only check for updates when packaged (production)
  if (!app.isPackaged) {
    // eslint-disable-next-line no-console
    console.log('[Updater] Skipping update check in development mode')
    return
  }

  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      // eslint-disable-next-line no-console
      console.log('[Updater] Checking for update...')
    })

    autoUpdater.on('update-available', (info) => {
      // eslint-disable-next-line no-console
      console.log(`[Updater] Update available: ${info.version}`)
    })

    autoUpdater.on('update-not-available', () => {
      // eslint-disable-next-line no-console
      console.log('[Updater] Update not available')
    })

    autoUpdater.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[Updater] Error in auto-updater:', err)
    })

    autoUpdater.on('download-progress', (progressObj) => {
      // eslint-disable-next-line no-console
      console.log(`[Updater] Download progress: ${progressObj.percent}%`)
    })

    autoUpdater.on('update-downloaded', (info) => {
      // eslint-disable-next-line no-console
      console.log(`[Updater] Update downloaded: ${info.version}. Will install on quit.`)
    })

    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[Updater] Failed to check for updates:', err)
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Updater] Failed to initialize auto-updater:', err)
  }
}

app.whenReady().then(() => {
  initDatabase()
  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    // On macOS, re-create a window when the dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  closeDb()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
