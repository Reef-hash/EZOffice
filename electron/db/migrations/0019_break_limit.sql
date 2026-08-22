-- Migration 0019: Rest/lunch break limit tracking.
--
-- Confirmed with the project owner: employees clock OUT/IN for lunch/rest
-- (two sessions/day), and the client wants visibility on who exceeds the
-- allowed break duration. See docs/OT_CALCULATION_PLAN.md for the full
-- context that led to this.
--
-- shifts.break_minutes is the ALLOWED/scheduled break duration for that
-- shift (default 60 min), separate from standard_hours (the target NET
-- working hours, which already excludes break time since break time is
-- naturally not counted — it falls in the gap between two IN/OUT sessions).
--
-- daily_attendance_records.break_hours already existed (added in 0015) but
-- was always hardcoded to 0 by the processing engine — it is now actually
-- populated with the real gap time between sessions on a day.
-- break_minutes_over is new: 0 when the employee's actual break was within
-- the shift's allowance, otherwise how many minutes they went over.

ALTER TABLE shifts ADD COLUMN break_minutes INTEGER NOT NULL DEFAULT 60 CHECK(break_minutes >= 0);

ALTER TABLE daily_attendance_records ADD COLUMN break_minutes_over INTEGER NOT NULL DEFAULT 0 CHECK(break_minutes_over >= 0);
