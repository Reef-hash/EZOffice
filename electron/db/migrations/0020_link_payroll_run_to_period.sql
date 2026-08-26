-- Migration 0020: Link payroll_runs to payroll_periods.
--
-- Bug: calculatePayrollRun() computed hours by plain calendar month (year-01 to
-- year-lastday) instead of the actual custom-date payroll period (e.g. 26 Jul - 25 Aug)
-- the admin defined in Payroll Periods. Attendance was correctly processed for the real
-- period range into daily_attendance_records, but the payroll run then only queried the
-- slice of those records that also fell inside the plain calendar month of its `month`
-- column - silently dropping days that spilled into the adjacent month (e.g. 26-31 Jul
-- for an "August" run). See CLAUDE.md decision log 2026-08-26 for the full incident.
--
-- Fix: payroll_runs now carries payroll_period_id, and calculatePayrollRun() (rewritten
-- in electron/services/payroll/payrollRun.ts) uses payroll_periods.start_date/end_date
-- directly for every date-range-dependent calculation (hours summary, working-day
-- count, public holidays, statutory as-of-date, open-exceptions gate) instead of
-- deriving a calendar month from year/month.
--
-- year/month are KEPT (not dropped) - still used as a display label and by statutory
-- rate/PCB lookups elsewhere. Going forward they are DERIVED from
-- payroll_periods.end_date at creation time rather than being the source of truth for
-- which attendance days belong to the run.
--
-- UNIQUE(year, month) is replaced by UNIQUE(payroll_period_id): two different payroll
-- periods can legitimately end in the same calendar month (e.g. semi-monthly periods),
-- which the old constraint would have wrongly blocked; "one run per period" is the
-- invariant that actually matters now.
--
-- DROP TABLE payroll_runs fails under PRAGMA foreign_keys=ON while payroll_run_items
-- still reference it (same class of issue as the 0.2.10 incident on salary_structures -
-- see the 2026-07-17 decision log entry). electron/db/migrate.ts already disables FKs
-- around each migration file and re-validates with PRAGMA foreign_key_check afterward,
-- so no special handling is needed here.

CREATE TABLE IF NOT EXISTS payroll_runs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id INTEGER REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  year INTEGER NOT NULL CHECK(year >= 2000 AND year <= 2100),
  month INTEGER NOT NULL CHECK(month >= 1 AND month <= 12),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'finalized')),
  run_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(payroll_period_id)
);

-- Named columns (not SELECT *) per the 0017/0.2.9 lesson - never rely on positional
-- copy across a table recreate.
INSERT INTO payroll_runs_new (id, payroll_period_id, year, month, status, run_date, created_at, updated_at)
SELECT id, NULL, year, month, status, run_date, created_at, updated_at
FROM payroll_runs;

DROP TABLE payroll_runs;

ALTER TABLE payroll_runs_new RENAME TO payroll_runs;

CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(payroll_period_id);

-- Best-effort backfill: link an existing legacy run to a payroll_period only when
-- exactly one period's end_date falls in that run's calendar month - an unambiguous
-- match (this is exactly the common case: a period like "26 Jul - 25 Aug" ends in
-- August, and a run was created for calendar August). Ambiguous (0 or >1 candidates)
-- is left NULL; calculatePayrollRun() refuses to recalculate a run with no linked
-- period and tells the admin to delete and recreate it against the correct period,
-- rather than silently guessing.
UPDATE payroll_runs
SET payroll_period_id = (
  SELECT pp.id FROM payroll_periods pp
  WHERE strftime('%Y-%m', pp.end_date) = printf('%04d-%02d', payroll_runs.year, payroll_runs.month)
)
WHERE payroll_period_id IS NULL
  AND (
    SELECT COUNT(*) FROM payroll_periods pp
    WHERE strftime('%Y-%m', pp.end_date) = printf('%04d-%02d', payroll_runs.year, payroll_runs.month)
  ) = 1;
