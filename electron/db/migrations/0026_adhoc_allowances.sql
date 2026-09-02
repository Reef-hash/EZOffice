-- Migration 0026: Ad-hoc per-run allowances (variable, multiple per employee).
--
-- Background: some allowances vary month to month and are computed from a
-- quantity x rate formula, e.g. "Buka Pagar" (gate-opening) allowance = number
-- of trips x RM5. Distinct from migration 0025's fixed_allowance on
-- salary_structures, which is a single RECURRING amount added every run — this
-- is entered fresh each payroll run, and an employee can have SEVERAL
-- differently-named ad-hoc allowances in the same run (confirmed via
-- AskUserQuestion in this session's chat, alongside the EPF/SOCSO/EIS exclusion
-- decision below).
--
-- Same statutory treatment as the recurring fixed_allowance: excluded from
-- EPF/SOCSO/EIS, included in gross/net/PCB.

CREATE TABLE IF NOT EXISTS payroll_run_allowances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Run-specific ad-hoc data, not master data — vanishes with the run, same
  -- reasoning as payroll_run_commissions (CASCADE, not RESTRICT).
  payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  -- Optional quantity x rate_per_unit basis (e.g. 35 trips x RM5). Both nullable:
  -- an entry can supply these two (amount is server-computed from them, same
  -- pattern as payroll_run_commissions.sales_amount/commission_rate) or supply
  -- `amount` directly as a flat one-off figure.
  quantity REAL CHECK(quantity IS NULL OR quantity >= 0),
  rate_per_unit REAL CHECK(rate_per_unit IS NULL OR rate_per_unit >= 0),
  amount REAL NOT NULL CHECK(amount >= 0),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_allowances_run_employee
  ON payroll_run_allowances(payroll_run_id, employee_id);

-- Snapshot: the SUM of this employee's ad-hoc allowance entries for this run,
-- folded into gross pay by calculatePayrollRun the same way commission is. The
-- itemized per-entry breakdown (each with its own description) is read
-- directly from payroll_run_allowances for display (payslip/UI) — not
-- duplicated here, since that table is itself frozen from edits once the run
-- is finalized (see adhocAllowances.ts assertRunIsDraft), preserving historical
-- accuracy the same way payroll_run_commissions already does.
ALTER TABLE payroll_run_items ADD COLUMN adhoc_allowance_total REAL NOT NULL DEFAULT 0;
