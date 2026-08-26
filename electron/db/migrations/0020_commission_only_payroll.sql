-- Migration 0020: Commission-only employees + separate payroll pay-groups/pay-dates.
--
-- Background: some employees are paid purely from commission (e.g. RM12,690 trip
-- total x 20% = RM2,538) with NO base salary, and are paid on a different day of
-- the month (e.g. the 1st) from attendance-based employees (e.g. the 26th). Their
-- gross pay must never have a fake "base salary" added to it, and EPF/SOCSO/EIS
-- must be calculated off an explicit contribution base (e.g. RM1,700) instead of
-- the commission amount itself. See docs/COMMISSION_PAYROLL_PLAN.md.
--
-- 1. salary_structures.rate_type gains 'commission_only'. For this rate_type,
--    rate_amount is repurposed (same overloading pattern as 0017's 'monthly') to
--    hold the employee's RECURRING DEFAULT statutory contribution base — NOT a
--    salary. It is never added to gross pay. HR can override it per payroll run
--    via payroll_run_commissions.statutory_base_override.
--
-- 2. payroll_runs gains pay_group ('attendance' | 'commission_only') and pay_date.
--    The uniqueness rule changes from one run per (year, month) to one run per
--    (year, month, pay_group), so an attendance run and a commission run can both
--    exist for the same payroll month without colliding.
--
-- 3. payroll_run_commissions gains statutory_base_override (nullable) — a per-run
--    override of the employee's recurring default base.
--
-- 4. payroll_run_items gains statutory_base — the actual wage base that was used
--    for EPF/SOCSO/EIS calculation on this snapshot (informational/audit column;
--    it does not change how epf/socso/eis/net_pay were already computed).

-- ── salary_structures: widen rate_type CHECK ────────────────────────────────
-- Table recreate required (SQLite can't ALTER an existing CHECK constraint).
-- Column list is explicit on both sides of INSERT/SELECT (not `SELECT *`) —
-- see the 0.2.9/0.2.10 incidents in CLAUDE.md: this table's physical column
-- order does not necessarily match declaration order once ALTER TABLE ADD
-- COLUMN has been used historically (pcb_category/pcb_children_count).

CREATE TABLE IF NOT EXISTS salary_structures_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  effective_from TEXT NOT NULL,
  rate_type TEXT NOT NULL CHECK(rate_type IN ('daily', 'hourly', 'monthly', 'commission_only')),
  rate_amount REAL NOT NULL CHECK(rate_amount > 0),
  standard_hours_per_day REAL NOT NULL DEFAULT 8.0 CHECK(standard_hours_per_day > 0),
  subject_to_epf INTEGER NOT NULL DEFAULT 1 CHECK(subject_to_epf IN (0, 1)),
  subject_to_socso INTEGER NOT NULL DEFAULT 1 CHECK(subject_to_socso IN (0, 1)),
  subject_to_eis INTEGER NOT NULL DEFAULT 1 CHECK(subject_to_eis IN (0, 1)),
  pcb_category TEXT NOT NULL DEFAULT 'single' CHECK(pcb_category IN ('single', 'married_no_spouse_income', 'married_with_spouse_income')),
  pcb_children_count INTEGER NOT NULL DEFAULT 0 CHECK(pcb_children_count >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO salary_structures_new (
  id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
  subject_to_epf, subject_to_socso, subject_to_eis, pcb_category, pcb_children_count,
  created_at, updated_at
)
SELECT
  id, employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
  subject_to_epf, subject_to_socso, subject_to_eis, pcb_category, pcb_children_count,
  created_at, updated_at
FROM salary_structures;

DROP TABLE salary_structures;

ALTER TABLE salary_structures_new RENAME TO salary_structures;

CREATE INDEX IF NOT EXISTS idx_salary_structures_employee_effective
  ON salary_structures(employee_id, effective_from DESC);

-- ── payroll_runs: add pay_group + pay_date, widen uniqueness ────────────────
-- Table recreate required (UNIQUE constraint change). FKs from payroll_run_items
-- and payroll_run_commissions reference this table by name, unaffected by the
-- rename-back. pay_date backfills to the existing run_date for pre-existing rows.

CREATE TABLE IF NOT EXISTS payroll_runs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL CHECK(year >= 2000 AND year <= 2100),
  month INTEGER NOT NULL CHECK(month >= 1 AND month <= 12),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'finalized')),
  run_date TEXT NOT NULL,
  pay_group TEXT NOT NULL DEFAULT 'attendance' CHECK(pay_group IN ('attendance', 'commission_only')),
  pay_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(year, month, pay_group)
);

INSERT INTO payroll_runs_new (
  id, year, month, status, run_date, pay_group, pay_date, created_at, updated_at
)
SELECT
  id, year, month, status, run_date, 'attendance', run_date, created_at, updated_at
FROM payroll_runs;

DROP TABLE payroll_runs;

ALTER TABLE payroll_runs_new RENAME TO payroll_runs;

-- ── payroll_run_commissions: per-run statutory base override ────────────────
-- Plain ADD COLUMN is safe (no CHECK constraint change, nullable, no recreate needed).
ALTER TABLE payroll_run_commissions ADD COLUMN statutory_base_override REAL
  CHECK(statutory_base_override IS NULL OR statutory_base_override >= 0);

-- ── payroll_run_items: snapshot the actual statutory base used ──────────────
-- Informational/audit column only — does not change how epf/socso/eis/net_pay
-- were already computed. Defaults to 0 for historical rows (never recalculated).
ALTER TABLE payroll_run_items ADD COLUMN statutory_base REAL NOT NULL DEFAULT 0;
