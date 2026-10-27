-- Migration 0030: how much of a scheduled salary advance deduction was carried forward.
--
-- Payroll now caps the advance deduction at a share of the employee's net pay
-- (see advanceDeduction.ts). The part that did not fit stays on the advance's
-- balance and is deducted in a later run. This snapshots that carried-forward
-- amount on the run item so the run screen and the payslip can show it, instead
-- of the admin having to work it out from the advance's balance afterwards.

ALTER TABLE payroll_run_items ADD COLUMN advance_deferred REAL NOT NULL DEFAULT 0;
