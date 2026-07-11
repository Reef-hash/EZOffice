-- Migration 0014: Phase 2 — Payroll Periods
-- See docs/hrms-architecture-proposal.md §5 for full design.
--
-- Payroll Periods define date ranges that group attendance for payroll calculation.
-- Examples: 26 Jun – 25 Jul, 1 Jul – 31 Jul.
-- Periods are non-overlapping and follow a lifecycle:
--   open → processing → finalized → closed

CREATE TABLE IF NOT EXISTS payroll_periods (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,                 -- e.g. "July 2026 Payroll"
  start_date      TEXT    NOT NULL,                 -- YYYY-MM-DD inclusive
  end_date        TEXT    NOT NULL,                 -- YYYY-MM-DD inclusive
  status          TEXT    NOT NULL DEFAULT 'open' CHECK(status IN (
    'open', 'processing', 'finalized', 'closed'
  )),
  processed_at    TEXT,                             -- When processing engine last ran
  finalized_at    TEXT,                             -- When the period was locked
  finalized_by    INTEGER REFERENCES admin_users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK(start_date < end_date)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_dates
  ON payroll_periods(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_status
  ON payroll_periods(status);
