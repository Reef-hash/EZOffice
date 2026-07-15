-- Migration 0016: Company-wide default annual/sick leave entitlement (days per year).
-- Locked decision (2026-07-15): a single company-wide default lives on payroll_settings
-- (same singleton pattern as grace_period_minutes), applied to all employees via
-- initializeYearlyLeaveEntitlements(); per-employee balances in
-- employee_leave_entitlements (added in 0009) remain individually overridable —
-- the default only fills a year's row if one doesn't already exist for that employee.

ALTER TABLE payroll_settings
ADD COLUMN default_annual_leave_days REAL NOT NULL DEFAULT 14 CHECK(default_annual_leave_days >= 0);

ALTER TABLE payroll_settings
ADD COLUMN default_sick_leave_days REAL NOT NULL DEFAULT 14 CHECK(default_sick_leave_days >= 0);
