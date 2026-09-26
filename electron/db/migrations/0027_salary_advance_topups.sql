-- Migration 0027: Top-ups on an existing salary advance.
--
-- Background: an employee with an active advance (e.g. RM500 still outstanding)
-- asks for more money (RM1,000). Opening a second advance means two fixed
-- installments are deducted every payroll run (previewAdvanceDeductions sums one
-- installment per active advance). Topping up the existing advance keeps a single
-- installment and a single balance.
--
-- The top-up itself mutates salary_advances.amount / balance_outstanding; this
-- table only records WHEN and HOW MUCH was added, so the advance's principal is
-- never an unexplained number that changed after the fact.

CREATE TABLE IF NOT EXISTS salary_advance_topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- History of a specific advance — goes with it if the (settled) advance is deleted.
  salary_advance_id INTEGER NOT NULL REFERENCES salary_advances(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK(amount > 0),
  date_issued TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_salary_advance_topups_advance
  ON salary_advance_topups(salary_advance_id);
