-- Migration 0015: Phase 3 — Attendance Processing Engine
-- See docs/hrms-architecture-proposal.md §7 for the 12-stage pipeline design.
-- Two tables:
--   processing_runs             — audit trail of each engine execution
--   daily_attendance_records    — processed attendance, one row per employee per day

-- ── processing_runs ──────────────────────────────────────────
-- Tracks each execution of the processing engine for auditability.
-- Links to the payroll_period that was processed.

CREATE TABLE IF NOT EXISTS processing_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id   INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  status              TEXT    NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
  started_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT,
  total_employees     INTEGER NOT NULL DEFAULT 0,
  total_days          INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_processing_runs_period
  ON processing_runs(payroll_period_id);

-- ── daily_attendance_records ─────────────────────────────────
-- One row per employee per day. This is the single source of truth
-- for "what happened on this date for this employee."
-- Payroll reads ONLY from this table, never from attendance_logs.

CREATE TABLE IF NOT EXISTS daily_attendance_records (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id           INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  date                  TEXT    NOT NULL,                     -- YYYY-MM-DD
  payroll_period_id     INTEGER REFERENCES payroll_periods(id) ON DELETE SET NULL,
  processing_run_id     INTEGER REFERENCES processing_runs(id) ON DELETE SET NULL,
  calendar_type         TEXT    NOT NULL CHECK(calendar_type IN (
    'working_day', 'weekly_off', 'public_holiday', 'company_holiday',
    'special_working_day', 'half_day', 'emergency_closure', 'company_event'
  )),
  leave_type            TEXT CHECK(leave_type IN ('annual', 'sick', 'unpaid')),
  leave_record_id       INTEGER REFERENCES leave_records(id) ON DELETE SET NULL,
  shift_id              INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  attendance_status     TEXT    NOT NULL DEFAULT 'absent' CHECK(attendance_status IN (
    'present', 'late', 'excused_late', 'early_out', 'absent',
    'on_leave', 'holiday', 'weekly_off', 'emergency_closure', 'no_show'
  )),
  first_in              TEXT,                                 -- ISO timestamp of first IN punch
  last_out              TEXT,                                 -- ISO timestamp of last OUT punch
  session_count         INTEGER NOT NULL DEFAULT 0,
  total_clocked_hours   REAL    NOT NULL DEFAULT 0,
  break_hours           REAL    NOT NULL DEFAULT 0,
  regular_hours         REAL    NOT NULL DEFAULT 0,
  ot_hours              REAL    NOT NULL DEFAULT 0,
  minutes_late          INTEGER NOT NULL DEFAULT 0,
  minutes_early_out     INTEGER NOT NULL DEFAULT 0,
  is_finalized          INTEGER NOT NULL DEFAULT 0,           -- 0=editable, 1=locked
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id, date, processing_run_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_records_employee_date
  ON daily_attendance_records(employee_id, date);

CREATE INDEX IF NOT EXISTS idx_daily_records_period
  ON daily_attendance_records(payroll_period_id);
