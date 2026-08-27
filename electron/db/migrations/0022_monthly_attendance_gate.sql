-- Migration 0022: Monthly salary gated on attendance.
-- See CLAUDE.md decision log 2026-08-27 ("Basic tetap + syarat attendance") for the
-- full design discussion this implements.
--
-- A monthly-rate employee can now optionally have their fixed basic salary depend on
-- actually meeting the required daily hours (per their shift), rather than being paid
-- in full regardless of attendance (the existing rate_type='monthly' behaviour, which
-- is unchanged when this flag is 0). Shortfall is deducted pro-rata by the hour, never
-- by a hardcoded whole day — an "absent" day and a "left 30 minutes early" day are the
-- SAME formula (shortfall = required_hours - regular_hours), not special-cased.

ALTER TABLE salary_structures
  ADD COLUMN attendance_required INTEGER NOT NULL DEFAULT 0 CHECK(attendance_required IN (0, 1));

-- Snapshot of the shift threshold used for THAT day, so the shortfall calculation at
-- payroll time doesn't need to re-derive is_half_day/shift assignment after the fact
-- (both can legitimately change later). 0 for weekly_off/holiday/emergency_closure days
-- — those are never part of the attendance requirement, regardless of hours worked
-- there (which are paid separately, at a premium, if worked at all).
ALTER TABLE daily_attendance_records
  ADD COLUMN required_hours REAL NOT NULL DEFAULT 0;

-- Snapshotted onto payroll_run_items so a payslip can show the full contracted basic
-- and the attendance deduction as separate line items, never silently folded into one
-- number — see the payslip PDF changes in the same commit as this migration.
ALTER TABLE payroll_run_items ADD COLUMN basic_salary_snapshot REAL NOT NULL DEFAULT 0;
ALTER TABLE payroll_run_items ADD COLUMN attendance_shortfall_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE payroll_run_items ADD COLUMN attendance_shortfall_amount REAL NOT NULL DEFAULT 0;
