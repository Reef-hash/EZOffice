-- Migration 0018: Ad-hoc per-run sales commission for payroll.
--
-- Commission varies per employee per month (sales-based) and only applies to some
-- employees, so it is NOT a recurring field on salary_structures — it is entered
-- per payroll run, per employee, before the run is calculated.
--
-- payroll_run_commissions is the admin-entered input (mutable while the run is a draft).
-- payroll_run_items.commission is the snapshot of what was actually applied at
-- calculation time — same snapshot discipline as every other payroll_run_items column
-- (a finalized payslip must not change if the commission entry is edited afterward).
--
-- Commission IS subject to EPF/SOCSO/EIS/PCB (Third Schedule, EPF Act 1991 — commission
-- is listed as "wages"; only overtime, service charge, gratuity, traveling allowance,
-- director's fee, and retrenchment/termination benefits are excluded). The calculation
-- engine folds commission into gross_pay before the statutory base is computed.

CREATE TABLE IF NOT EXISTS payroll_run_commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  amount REAL NOT NULL CHECK(amount >= 0),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_commissions_run
  ON payroll_run_commissions(payroll_run_id);

-- Snapshot column on payroll_run_items — a plain ADD COLUMN is safe here (no CHECK
-- constraint change, unlike the salary_structures rate_type widening in 0017), so no
-- table recreation is needed.
ALTER TABLE payroll_run_items ADD COLUMN commission REAL NOT NULL DEFAULT 0;
