-- Migration 0011: Sync overhaul — per DEVICE_SYNC_AUDIT.md (2026-07-08).
-- Adds sync configuration columns to payroll_settings, a device_sync_log table
-- for persistent sync results (H4), and attendance_exceptions table (H2/D5).

-- ── payroll_settings additions ───────────────────────────────────────────────

-- D3: configurable punch debounce window; two punches from the same employee
-- within this many minutes collapse to the first (absorbs device bounce/double-tap).
ALTER TABLE payroll_settings
ADD COLUMN punch_debounce_minutes INTEGER NOT NULL DEFAULT 2;

-- D4: session cap; IN→OUT pairs longer than this many hours are excluded from pay
-- and flagged as attendance exceptions.
ALTER TABLE payroll_settings
ADD COLUMN max_session_hours REAL NOT NULL DEFAULT 16;

-- H1: watermark; ISO timestamp of the newest punch successfully inserted in the
-- last sync. Next sync skips device logs older than this (optimisation — DB dedup
-- is still the correctness mechanism). NULL = no sync has run yet (full pull).
ALTER TABLE payroll_settings
ADD COLUMN device_last_synced_at TEXT;

-- ── device_sync_log ──────────────────────────────────────────────────────────
-- Rolling log of sync runs; the renderer shows the last result so admins can
-- review errors after the toast has disappeared (H4 requirement).

CREATE TABLE IF NOT EXISTS device_sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_ip   TEXT    NOT NULL,
  started_at  TEXT    NOT NULL,       -- ISO 8601 naive local timestamp
  inserted    INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT,                   -- JSON array of error strings; NULL if no errors
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── attendance_exceptions ────────────────────────────────────────────────────
-- One row per identified anomaly for an employee's day.
-- status:
--   open      = needs admin attention (payroll blocks when any open exception exists)
--   resolved  = admin fixed the underlying punches; auto-cleared on re-check
--   dismissed = admin acknowledged and decided to leave as-is (with a note)
-- D5: calculatePayrollRun refuses while any 'open' exception exists in the run month.

CREATE TABLE IF NOT EXISTS attendance_exceptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year            INTEGER NOT NULL,
  month           INTEGER NOT NULL,
  date            TEXT    NOT NULL,   -- YYYY-MM-DD: the day this exception applies to
  exception_type  TEXT    NOT NULL CHECK(exception_type IN (
    'missing_punch',      -- odd number of punches on this day
    'over_long_session',  -- a session exceeded max_session_hours
    'punch_on_leave'      -- employee punched while on approved leave
  )),
  description     TEXT    NOT NULL,  -- human-readable summary for the admin
  status          TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
  note            TEXT,              -- admin note when dismissing or resolving
  related_log_ids TEXT,              -- JSON array of attendance_log ids involved
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_employee_month
  ON attendance_exceptions(employee_id, year, month);

CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_status_month
  ON attendance_exceptions(status, year, month);
