-- Migration 0028: Manual corrections to a salary advance's balance / total issued.
--
-- Background: v0.7.0's first top-up UI let an admin put an advance into a wrong
-- state (see CLAUDE.md decision log, 2026-09-26). Editing the row directly would
-- leave no trace of why the money owed changed, so every correction is recorded
-- here with before/after values and a mandatory reason.

CREATE TABLE IF NOT EXISTS salary_advance_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  salary_advance_id INTEGER NOT NULL REFERENCES salary_advances(id) ON DELETE CASCADE,
  balance_before REAL NOT NULL,
  balance_after REAL NOT NULL CHECK(balance_after >= 0),
  amount_before REAL NOT NULL,
  amount_after REAL NOT NULL CHECK(amount_after > 0),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_salary_advance_adjustments_advance
  ON salary_advance_adjustments(salary_advance_id);
