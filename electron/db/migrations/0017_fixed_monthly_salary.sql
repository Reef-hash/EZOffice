-- Migration 0017: Add fixed monthly salary support to salary_structures.
--
-- Adds 'monthly' to the rate_type CHECK constraint so salary_structures.rate_type
-- can be 'daily', 'hourly', or 'monthly'. When rate_type = 'monthly', the existing
-- rate_amount column holds the fixed monthly salary (e.g. 1700.00).
--
-- No new columns needed — rate_amount is already semantically overloaded per rate_type
-- (daily rate for 'daily', hourly rate for 'hourly', monthly salary for 'monthly').
--
-- Attendance processing engine will skip monthly employees (no attendance needed).
-- Payroll run engine uses rate_amount directly as gross pay (no hours-based math).

-- SQLite does not support ALTER TABLE ... ALTER CHECK. Recreate the table with the
-- new constraint. Schema includes all columns (including pcb_* from 0005_pcb_profile.sql).
--
-- DROP TABLE salary_structures fails under PRAGMA foreign_keys=ON whenever
-- payroll_run_items rows still reference it (0.2.10 crash). The migration runner
-- (electron/db/migrate.ts) temporarily disables FKs around each migration file
-- and re-checks with PRAGMA foreign_key_check before marking the file applied.

CREATE TABLE IF NOT EXISTS salary_structures_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  effective_from TEXT NOT NULL,
  rate_type TEXT NOT NULL CHECK(rate_type IN ('daily', 'hourly', 'monthly')),
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

-- Column lists are explicit (not SELECT *) because the source table's actual
-- physical column order has pcb_category/pcb_children_count appended at the END
-- (they were added via ALTER TABLE ADD COLUMN in 0005_pcb_profile.sql, which always
-- appends), while salary_structures_new declares them in the middle. A positional
-- `SELECT *` silently shifted created_at/updated_at values into the pcb_category/
-- pcb_children_count columns, tripping the pcb_category CHECK constraint on any
-- upgrade where salary_structures already had rows.
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
