// Hand-rolled migration runner — intentionally small, no library dependency.
// On app startup, reads electron/db/migrations/*.sql in filename order,
// checks schema_migrations table, and applies any not-yet-applied files.

import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

/**
 * Runs all pending migrations against the given database connection.
 * Returns the names of migrations that were applied (empty if already up-to-date).
 */
export function runMigrations(db: Database.Database, migrationsDir: string): string[] {
  // Ensure the schema_migrations table exists before we query it
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Get list of already-applied migrations
  const applied = new Set(
    db
      .prepare('SELECT filename FROM schema_migrations')
      .all()
      .map((row: unknown) => (row as { filename: string }).filename),
  )

  // Read migration files in alphabetical order
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`)
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const appliedNow: string[] = []

  for (const file of files) {
    if (applied.has(file)) continue

    const filePath = path.join(migrationsDir, file)
    const sql = fs.readFileSync(filePath, 'utf-8')

    // Wrap each migration in a transaction so partial application is impossible
    const applyMigration = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(file)
    })

    applyMigration()
    appliedNow.push(file)
  }

  return appliedNow
}
