-- Migration 0023: snapshot the wage EPF was actually calculated against.
-- Requested by the project owner: when a monthly + attendance_required salary
-- structure has a shortfall (migration 0022), EPF is calculated on the shortfall-net
-- basic, not the full contracted amount — but the payslip previously only showed the
-- final EPF ringgit figure, not the wage it came from. The admin needs that wage
-- figure to key into KWSP's own portal/table when submitting, without re-deriving it
-- by hand from the shortfall.

ALTER TABLE payroll_run_items ADD COLUMN epf_wage_base REAL NOT NULL DEFAULT 0;
