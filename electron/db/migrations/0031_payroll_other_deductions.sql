-- Migration 0031: ad-hoc "other deductions" on a payroll run.
--
-- A one-off or catch-up deduction an admin enters per employee per run with its own
-- label — e.g. "Caruman tertunggak SOCSO/EIS Jan–Sep" (the employee's share of
-- contributions the company paid but never deducted). Before this, the only way to
-- recover such an amount was to disguise it as a salary advance, which showed up on
-- the payslip as money the employee had borrowed.
--
-- Same shape and lifecycle as payroll_run_allowances (0026): run-specific input, so
-- CASCADE from the run, editable only while the run is a draft, itemized rows stay
-- here and only their sum is snapshotted onto payroll_run_items. Unlike an
-- allowance there is no quantity x rate basis: the admin states the exact amount.

CREATE TABLE IF NOT EXISTS payroll_run_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  description TEXT NOT NULL CHECK(length(trim(description)) > 0),
  amount REAL NOT NULL CHECK(amount > 0),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_deductions_run_employee
  ON payroll_run_deductions(payroll_run_id, employee_id);

ALTER TABLE payroll_run_items ADD COLUMN other_deduction_total REAL NOT NULL DEFAULT 0;
