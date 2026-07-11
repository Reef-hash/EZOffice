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

import { app, BrowserWindow, dialog } from 'electron'
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
import { registerLicenseHandlers } from './ipc/license'
import { registerCalendarHandlers } from './ipc/calendar'
import * as adminService from './services/admin'
import * as licenseService from './services/license'

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
  registerLicenseHandlers(db)
  registerCalendarHandlers(db)

  // Check if this is first-time setup (no admin users yet)
  const adminCount = adminService.getAdminUserCount(db)
  if (adminCount === 0) {
    // eslint-disable-next-line no-console
    console.log('[DB] No admin users found. App will show signup screen on first launch.')
  }

  // Fire-and-forget: opportunistically refresh the cached license decision if
  // the revalidation interval has elapsed and we're online. Must never block
  // window creation — a network failure here is silent by design (see
  // revalidateIfDue's own docs). Errors are still logged for support triage.
  licenseService.revalidateIfDue(db).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[License] Background revalidation failed (non-fatal):', err)
  })
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
}).catch((err) => {
  // Without this, a startup failure (bad migration, corrupt DB, missing
  // packaged resource) is an unhandled rejection: no window ever opens and
  // no error is visible anywhere — the app just silently does nothing. Show
  // it to whoever is looking at the screen so it can be reported, instead of
  // failing silently per CLAUDE.md §3.
  // eslint-disable-next-line no-console
  console.error('[Startup] Fatal error during initialization:', err)
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
