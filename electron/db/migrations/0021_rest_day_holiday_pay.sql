-- Migration 0021: Pay for work performed on rest days and public/company holidays.
--
-- Bug (2026-08-27): the processing engine recorded a full day's punches on a rest day
-- (weekly_off) or public holiday but credited ZERO paid hours — attendanceProcessor.ts
-- Stage 10 only assigned regular_hours/ot_hours when attendance_status was
-- present/late/early_out. An employee who worked a full 9-hour Sunday, or Merdeka Day,
-- was paid RM0 for it. Confirmed by repro before this fix.
--
-- Employment Act 1955 treatment (the model implemented here — the MULTIPLIERS are
-- configurable in Payroll Settings because company policy may exceed the statutory
-- minimum, and the exact statutory figures should be confirmed with the employer's
-- accountant):
--
--   Rest day (s.60(3)) — for the ordinary-hours portion:
--     * worked <= half the normal hours  -> half a day's wages
--     * worked >  half the normal hours  -> one full day's wages
--     (both implemented by crediting a fixed number of HOURS in the processing engine,
--      so the "half day" / "full day" tiers survive into payroll as plain hours)
--     * hours beyond the normal day      -> overtime at rest_day_ot_multiplier (2.0)
--
--   Public/company holiday (s.60D(3)) — any work performed:
--     * ordinary-hours portion           -> holiday_multiplier (2.0) => two days' wages
--     * hours beyond the normal day      -> overtime at holiday_ot_multiplier (3.0)
--
-- Monthly-rate employees are unaffected: triggerProcessing() excludes them from
-- attendance processing entirely (2026-07-17 decision), so they never produce these rows.

-- ── daily_attendance_records: hours worked on non-working days ────────────────
-- Kept separate from regular_hours/ot_hours because they are paid at different
-- multipliers — folding them into the existing buckets would silently pay rest-day
-- work at the ordinary rate.
-- Plain ADD COLUMN (no CHECK constraint change) — safe, no table recreate needed,
-- unlike the salary_structures widening in 0017 (see the 0.2.9/0.2.10 incidents).

ALTER TABLE daily_attendance_records ADD COLUMN rest_day_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE daily_attendance_records ADD COLUMN rest_day_ot_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE daily_attendance_records ADD COLUMN holiday_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE daily_attendance_records ADD COLUMN holiday_ot_hours REAL NOT NULL DEFAULT 0;

-- ── payroll_settings: configurable premium multipliers ───────────────────────
-- Applied to the employee's ordinary hourly rate. Seeded to the Employment Act 1955
-- minimums; an employer paying above the minimum edits these under Payroll -> Settings.
-- rest_day_multiplier is 1.0 because the HOURS credited already encode the half-day /
-- full-day tier — 8 credited hours x 1.0 x hourly rate = exactly one day's wages.

ALTER TABLE payroll_settings ADD COLUMN rest_day_multiplier REAL NOT NULL DEFAULT 1.0 CHECK(rest_day_multiplier >= 0);
ALTER TABLE payroll_settings ADD COLUMN rest_day_ot_multiplier REAL NOT NULL DEFAULT 2.0 CHECK(rest_day_ot_multiplier >= 0);
ALTER TABLE payroll_settings ADD COLUMN holiday_multiplier REAL NOT NULL DEFAULT 2.0 CHECK(holiday_multiplier >= 0);
ALTER TABLE payroll_settings ADD COLUMN holiday_ot_multiplier REAL NOT NULL DEFAULT 3.0 CHECK(holiday_ot_multiplier >= 0);

-- ── payroll_run_items: snapshot the resulting pay ────────────────────────────
-- Same snapshot discipline as every other payroll_run_items column: a finalized
-- payslip must not change if a setting or rate is edited afterward. Each column holds
-- the ordinary-hours portion PLUS the overtime portion for that day type.

ALTER TABLE payroll_run_items ADD COLUMN rest_day_pay REAL NOT NULL DEFAULT 0;
ALTER TABLE payroll_run_items ADD COLUMN holiday_pay REAL NOT NULL DEFAULT 0;
