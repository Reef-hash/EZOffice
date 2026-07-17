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

    // SQLite forbids changing PRAGMA foreign_keys *inside* a transaction, and also
    // forbids DROP TABLE on a parent that still has child rows when foreign_keys=ON
    // (error: "FOREIGN KEY constraint failed"). Table-recreate migrations (CREATE new
    // → INSERT…SELECT → DROP old → RENAME) therefore need FKs off for the whole file.
    // Toggle outside the transaction; re-enable after. foreign_key_check runs inside
    // the same transaction (works even with FKs off) so a bad migration rolls back
    // entirely — including the schema_migrations insert — rather than leaving orphans
    // marked as applied.
    const foreignKeysWereOn = Boolean(db.pragma('foreign_keys', { simple: true }))
    db.pragma('foreign_keys = OFF')
    try {
      const applyMigration = db.transaction(() => {
        db.exec(sql)

        const violations = db.prepare('PRAGMA foreign_key_check').all() as Array<{
          table: string
          rowid: number
          parent: string
          fkid: number
        }>
        if (violations.length > 0) {
          const summary = violations
            .slice(0, 5)
            .map((v) => `${v.table}.rowid=${v.rowid} → ${v.parent}`)
            .join('; ')
          throw new Error(
            `Migration ${file} left ${violations.length} foreign-key violation(s): ${summary}`,
          )
        }

        db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(file)
      })
      applyMigration()
    } finally {
      if (foreignKeysWereOn) {
        db.pragma('foreign_keys = ON')
      }
    }

    appliedNow.push(file)
  }

  return appliedNow
}
