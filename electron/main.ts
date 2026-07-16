// EZOffice Electron main process.
// Creates the BrowserWindow, initializes the database, runs migrations,
// registers IPC handlers, then loads the Vite renderer.

// Loads .env into process.env (EZOFFICE_LICENSING_API_URL / EZOFFICE_SUPABASE_*)
// before any module reads it. Must run before the licensing config is used.
import 'dotenv/config'

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

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'
import path from 'node:path'
import { getDb, resolveDbPath, closeDb } from './db/connection'
import { runMigrations } from './db/migrate'
import { registerMasterDataHandlers } from './ipc/masterData'
import { registerAttendanceHandlers } from './ipc/attendance'
import { registerPayrollHandlers } from './ipc/payroll'
import { registerAdminHandlers } from './ipc/admin'
import { registerSettingsHandlers } from './ipc/settings'
import { registerExportHandlers } from './ipc/export'
import { registerLicenseHandlers } from './ipc/license'
import { registerCalendarHandlers } from './ipc/calendar'
import * as adminService from './services/admin'
import * as licenseService from './services/license'

// Persistent crash/error logging — writes to userData/logs/main.log so a
// crash reported after the fact (app already closed, no DevTools available)
// still leaves a trail. `initialize({ spyRendererConsole: true })` also
// forwards renderer console.log/warn/error into the same file, and
// `eventLogger` captures render-process-gone/child-process-gone/
// plugin-crashed/unresponsive by default — exactly the events a sudden,
// unexplained crash would otherwise leave no record of.
log.initialize({ preload: true, spyRendererConsole: true })
log.errorHandler.startCatching({ showDialog: true })
log.eventLogger.startLogging()

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
  // are in electron/db/migrations/ (source tree). Vite only bundles the .ts
  // import graph, so .sql files never land inside dist-electron/ — in
  // production they're copied to resourcesPath via electron-builder's
  // `extraResources` (see package.json build.extraResources) instead.
  const migrationsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'db/migrations')
    : path.resolve(__dirname, '..', 'electron', 'db', 'migrations')

  const applied = runMigrations(db, migrationsDir)
  if (applied.length > 0) {
    log.info(`[DB] Applied migrations: ${applied.join(', ')}`)
  }

  // Register all IPC handlers — must happen before the renderer loads
  registerAdminHandlers(db)
  registerMasterDataHandlers(db)
  registerAttendanceHandlers(db)
  registerPayrollHandlers(db)
  registerSettingsHandlers(db)
  registerExportHandlers(db)
  registerLicenseHandlers(db)
  registerCalendarHandlers(db)

  // Check if this is first-time setup (no admin users yet)
  const adminCount = adminService.getAdminUserCount(db)
  if (adminCount === 0) {
    log.info('[DB] No admin users found. App will show signup screen on first launch.')
  }

  // Fire-and-forget: opportunistically refresh the cached license decision if
  // the revalidation interval has elapsed and we're online. Must never block
  // window creation — a network failure here is silent by design (see
  // revalidateIfDue's own docs). Errors are still logged for support triage.
  licenseService.revalidateIfDue(db).catch((err) => {
    log.warn('[License] Background revalidation failed (non-fatal):', err)
  })
}

function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    log.info('[Updater] Skipping update check in development mode')
    return
  }

  try {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    const mainWindow = BrowserWindow.getAllWindows()[0]

    autoUpdater.on('checking-for-update', () => {
      log.info('[Updater] Checking for update...')
    })

    autoUpdater.on('update-available', (info) => {
      log.info(`[Updater] Update available: ${info.version}`)
      mainWindow?.webContents.send('updater:status', { status: 'available', version: info.version })
    })

    autoUpdater.on('update-not-available', () => {
      log.info('[Updater] Update not available')
    })

    autoUpdater.on('error', (err) => {
      log.error('[Updater] Error in auto-updater:', err)
    })

    autoUpdater.on('download-progress', (progressObj) => {
      mainWindow?.webContents.send('updater:progress', { percent: Math.round(progressObj.percent * 100) / 100 })
    })

    autoUpdater.on('update-downloaded', (info) => {
      log.info(`[Updater] Update downloaded: ${info.version}`)
      mainWindow?.webContents.send('updater:status', { status: 'downloaded', version: info.version })
    })

    // Listen for renderer requesting a download to start
    ipcMain.handle('updater:download', async () => {
      autoUpdater.downloadUpdate()
    })

    // Listen for renderer requesting install and restart
    ipcMain.handle('updater:install', () => {
      autoUpdater.quitAndInstall()
    })

    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[Updater] Failed to check for updates:', err)
    })
  } catch (err) {
    log.error('[Updater] Failed to initialize auto-updater:', err)
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
}).catch((err) => {
  // Without this, a startup failure (bad migration, corrupt DB, missing
  // packaged resource) is an unhandled rejection: no window ever opens and
  // no error is visible anywhere — the app just silently does nothing. Show
  // it to whoever is looking at the screen so it can be reported, instead of
  // failing silently per CLAUDE.md §3.
  log.error('[Startup] Fatal error during initialization:', err)
  dialog.showErrorBox(
    'EZOffice failed to start',
    `An error occurred while starting EZOffice:\n\n${err instanceof Error ? err.stack || err.message : String(err)}\n\nPlease report this to support.`
  )
  app.quit()
})

app.on('window-all-closed', () => {
  closeDb()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
