// SQLite database connection — singleton, per Claude.md §4.
// `PRAGMA foreign_keys = ON` on every connection.
// DB file: dev → ./data/ezoffice.dev.db; prod → app.getPath('userData')/ezoffice.db

import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

let db: Database.Database | null = null

/** Returns the resolved database file path based on environment. */
export function resolveDbPath(userDataPath?: string): string {
  // Production: Electron's userData directory
  if (userDataPath) {
    const dbDir = path.join(userDataPath, 'data')
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    return path.join(dbDir, 'ezoffice.db')
  }
  // Development: local data directory, gitignored
  const dbDir = path.resolve(process.cwd(), 'data')
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  return path.join(dbDir, 'ezoffice.dev.db')
}

/** Returns the singleton database connection, creating it if it doesn't exist. */
export function getDb(dbPath?: string): Database.Database {
  if (db) return db

  const resolvedPath = dbPath ?? resolveDbPath()
  db = new Database(resolvedPath)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  // Enforce foreign keys — Claude.md §4 requirement
  db.pragma('foreign_keys = ON')

  return db
}

/** Close the database connection. Useful for app shutdown / testing. */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
