-- Migration 0003: Payroll module — salary structures, statutory rate tables, payroll runs.
-- See CLAUDE.md §7 Decision Log (2026-06-26) for the locked schema decisions.
--
-- IMPORTANT: Rate tables (EPF/SOCSO/EIS/PCB) are seeded with commented placeholder rows
-- only. The project owner must enter authoritative figures from the official KWSP/PERKESO/LHDN
-- publications before running payroll for real. The payroll run screen warns if any rate table
-- is empty for the run period.

-- ── Salary Structures ────────────────────────────────────
-- Per-employee, effective-dated. "Current" = latest effective_from ≤ run date.
-- FK RESTRICT — don't lose payroll history if an employee record is deleted.

CREATE TABLE IF NOT EXISTS salary_structures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  effective_from TEXT NOT NULL,
  rate_type TEXT NOT NULL CHECK(rate_type IN ('daily', 'hourly')),
  rate_amount REAL NOT NULL CHECK(rate_amount > 0),
  standard_hours_per_day REAL NOT NULL DEFAULT 8.0 CHECK(standard_hours_per_day > 0),
  subject_to_epf INTEGER NOT NULL DEFAULT 1 CHECK(subject_to_epf IN (0, 1)),
  subject_to_socso INTEGER NOT NULL DEFAULT 1 CHECK(subject_to_socso IN (0, 1)),
  subject_to_eis INTEGER NOT NULL DEFAULT 1 CHECK(subject_to_eis IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_salary_structures_employee_effective
  ON salary_structures(employee_id, effective_from DESC);

-- ── Payroll Settings (singleton) ──────────────────────────
-- One row holds the OT rule. Use id = 1 conventionally and UPSERT.

CREATE TABLE IF NOT EXISTS payroll_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  ot_rule_type TEXT NOT NULL DEFAULT 'flat_addition' CHECK(ot_rule_type IN ('flat_addition', 'multiplier')),
  ot_rule_value REAL NOT NULL DEFAULT 0.50 CHECK(ot_rule_value >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed default OT rule if table is empty (the singleton)
INSERT OR IGNORE INTO payroll_settings (id, ot_rule_type, ot_rule_value)
VALUES (1, 'flat_addition', 0.50);

-- ── EPF Rates ────────────────────────────────────────────
-- Bracket table: wage range → employee/employer contribution percentages.
-- Supports employee categories (e.g. age under 60 vs 60+).
-- effective_from ensures historical runs use the rate that was in force at the time.

CREATE TABLE IF NOT EXISTS epf_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_from TEXT NOT NULL,
  employee_category TEXT NOT NULL DEFAULT 'all',
  wage_from REAL NOT NULL CHECK(wage_from >= 0),
  wage_to REAL CHECK(wage_to IS NULL OR wage_to > wage_from),
  employee_contribution_pct REAL NOT NULL DEFAULT 0 CHECK(employee_contribution_pct >= 0),
  employer_contribution_pct REAL NOT NULL DEFAULT 0 CHECK(employer_contribution_pct >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/*
-- PLACEHOLDER EPF rates — REPLACE with official KWSP Third Schedule figures.
-- Format: (effective_from, employee_category, wage_from, wage_to, employee_pct, employer_pct)

-- Employees under 60, earning ≤ 5000/month:
INSERT INTO epf_rates (effective_from, employee_category, wage_from, wage_to, employee_contribution_pct, employer_contribution_pct) VALUES
('2025-01-01', 'under_60',    0,  500, 0,  13),
('2025-01-01', 'under_60',  500, 1000, 0,  13),
('2025-01-01', 'under_60', 1000, 2000, 11, 13),
('2025-01-01', 'under_60', 2000, 3000, 11, 13),
('2025-01-01', 'under_60', 3000, 4000, 11, 13),
('2025-01-01', 'under_60', 4000, 5000, 11, 13);
*/

-- ── SOCSO Rates ──────────────────────────────────────────
-- Bracket table: wage range → employee/employer contributions (fixed amounts).

CREATE TABLE IF NOT EXISTS socso_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_from TEXT NOT NULL,
  employee_category TEXT NOT NULL DEFAULT 'all',
  wage_from REAL NOT NULL CHECK(wage_from >= 0),
  wage_to REAL CHECK(wage_to IS NULL OR wage_to > wage_from),
  employee_contribution REAL NOT NULL DEFAULT 0 CHECK(employee_contribution >= 0),
  employer_contribution REAL NOT NULL DEFAULT 0 CHECK(employer_contribution >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/*
-- PLACEHOLDER SOCSO rates — REPLACE with official PERKESO Contribution Table.
INSERT INTO socso_rates (effective_from, employee_category, wage_from, wage_to, employee_contribution, employer_contribution) VALUES
('2025-01-01', 'all',    0,   30, 0.00, 1.00),
('2025-01-01', 'all',   30,   50, 0.10, 1.25),
('2025-01-01', 'all',   50,  100, 0.20, 1.75);
*/

-- ── EIS Rates ────────────────────────────────────────────
-- Bracket table: wage range → employee/employer contributions (fixed amounts).

CREATE TABLE IF NOT EXISTS eis_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_from TEXT NOT NULL,
  employee_category TEXT NOT NULL DEFAULT 'all',
  wage_from REAL NOT NULL CHECK(wage_from >= 0),
  wage_to REAL CHECK(wage_to IS NULL OR wage_to > wage_from),
  employee_contribution REAL NOT NULL DEFAULT 0 CHECK(employee_contribution >= 0),
  employer_contribution REAL NOT NULL DEFAULT 0 CHECK(employer_contribution >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/*
-- PLACEHOLDER EIS rates — REPLACE with official PERKESO EIS Contribution Table.
INSERT INTO eis_rates (effective_from, employee_category, wage_from, wage_to, employee_contribution, employer_contribution) VALUES
('2025-01-01', 'all',    0,  100, 0.05, 0.05),
('2025-01-01', 'all',  100,  500, 0.10, 0.10),
('2025-01-01', 'all',  500, 1000, 0.20, 0.20);
*/

-- ── PCB Brackets ─────────────────────────────────────────
-- Schedule lookup: bracket by chargeable income range × category × children count.
-- category: 'single' | 'married_no_spouse_income' | 'married_with_spouse_income'

CREATE TABLE IF NOT EXISTS pcb_brackets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_from TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('single', 'married_no_spouse_income', 'married_with_spouse_income')),
  children_count INTEGER NOT NULL DEFAULT 0 CHECK(children_count >= 0),
  chargeable_income_from REAL NOT NULL CHECK(chargeable_income_from >= 0),
  chargeable_income_to REAL CHECK(chargeable_income_to IS NULL OR chargeable_income_to > chargeable_income_from),
  tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/*
-- PLACEHOLDER PCB brackets — REPLACE with official LHDN PCB Schedule.
-- Format: (effective_from, category, children_count, income_from, income_to, tax_amount)
INSERT INTO pcb_brackets (effective_from, category, children_count, chargeable_income_from, chargeable_income_to, tax_amount) VALUES
('2025-01-01', 'single',                        0,     0,  5000, 0),
('2025-01-01', 'single',                        0,  5000, 10000, 100),
('2025-01-01', 'single',                        0, 10000, 20000, 300),
('2025-01-01', 'married_no_spouse_income',      0,     0,  6000, 0),
('2025-01-01', 'married_no_spouse_income',      0,  6000, 12000, 100),
('2025-01-01', 'married_no_spouse_income',      0, 12000, 24000, 300),
('2025-01-01', 'married_with_spouse_income',    0,     0,  7000, 0),
('2025-01-01', 'married_with_spouse_income',    0,  7000, 14000, 100),
('2025-01-01', 'married_with_spouse_income',    0, 14000, 28000, 300);
*/

-- ── Salary Advances / Loans ──────────────────────────────
-- Per-employee advance tracking. deduction_mode is PER-ADVANCE (not a global setting).
-- Balance decreases each payroll run until 0, then status flips to 'settled'.

CREATE TABLE IF NOT EXISTS salary_advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  amount REAL NOT NULL CHECK(amount > 0),
  date_issued TEXT NOT NULL,
  limit_max REAL NOT NULL CHECK(limit_max >= amount),
  balance_outstanding REAL NOT NULL CHECK(balance_outstanding >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'settled', 'cancelled')),
  deduction_mode TEXT NOT NULL DEFAULT 'full_balance' CHECK(deduction_mode IN ('full_balance', 'fixed_installment')),
  installment_amount REAL CHECK(installment_amount IS NULL OR installment_amount > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_salary_advances_employee
  ON salary_advances(employee_id);

-- ── Payroll Runs ─────────────────────────────────────────
-- One row per payroll period (year + month). Only one run per (year, month).
-- Status: draft → admin reviews → finalized (locks the run permanently).

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL CHECK(year >= 2000 AND year <= 2100),
  month INTEGER NOT NULL CHECK(month >= 1 AND month <= 12),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'finalized')),
  run_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(year, month)
);

-- ── Payroll Run Items ────────────────────────────────────
-- One row per employee per run. ALL monetary/statutory fields are snapshotted —
-- changing a salary_structure or rate table after the fact must NOT affect finalized payslips.
-- FK to payroll_runs = CASCADE (delete run → delete items).
-- FK to employees = RESTRICT.
-- FK to salary_structures = RESTRICT (don't delete the structure row if referenced).

CREATE TABLE IF NOT EXISTS payroll_run_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  salary_structure_id INTEGER REFERENCES salary_structures(id) ON DELETE RESTRICT,

  -- Snapshot of the salary_structure used at calculation time (decision 5 in brief)
  snapshot_rate_type TEXT NOT NULL,
  snapshot_rate_amount REAL NOT NULL,
  snapshot_standard_hours_per_day REAL NOT NULL,
  snapshot_subject_to_epf INTEGER NOT NULL,
  snapshot_subject_to_socso INTEGER NOT NULL,
  snapshot_subject_to_eis INTEGER NOT NULL,

  -- Hours summary
  total_regular_hours REAL NOT NULL DEFAULT 0,
  total_ot_hours REAL NOT NULL DEFAULT 0,

  -- Gross pay breakdown
  gross_regular_pay REAL NOT NULL DEFAULT 0,
  gross_ot_pay REAL NOT NULL DEFAULT 0,
  gross_pay REAL NOT NULL DEFAULT 0,

  -- Statutory deductions (0 if employee was not subject to that item)
  epf_employee REAL NOT NULL DEFAULT 0,
  epf_employer REAL NOT NULL DEFAULT 0,
  socso_employee REAL NOT NULL DEFAULT 0,
  socso_employer REAL NOT NULL DEFAULT 0,
  eis_employee REAL NOT NULL DEFAULT 0,
  eis_employer REAL NOT NULL DEFAULT 0,
  pcb REAL NOT NULL DEFAULT 0,

  -- Salary advance deduction applied this run
  advance_deduction REAL NOT NULL DEFAULT 0,

  -- Net pay (what the employee actually receives)
  net_pay REAL NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_items_run
  ON payroll_run_items(payroll_run_id);
