-- Migration 0005: Admin authentication & audit logging (Phase A).
-- See CLAUDE.md §7 Decision Log (2026-06-29) for the locked scope.

-- ── Admin Users ──────────────────────────────────────────
-- Single admin per installation (Phase A). Passwords hashed with bcrypt.
-- active flag for future "disable account" functionality.

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);

-- ── Audit Log ────────────────────────────────────────────
-- Track all mutations (create, update, delete) with admin who made the change.
-- details column is JSON: {old_values: {...}, new_values: {...}}
-- Immutable (never delete or update audit logs).

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'login', 'logout')),
  table_name TEXT,  -- NULL for login/logout actions
  record_id INTEGER,  -- NULL for login/logout actions
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  details TEXT  -- JSON string of changes
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin_timestamp
  ON audit_log(admin_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_table
  ON audit_log(table_name, record_id);
