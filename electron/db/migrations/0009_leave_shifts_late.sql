-- Migration 0009: Phase C — Leave Management (C1), Shift Settings (C2), Late Detection (C3).
-- The three are coupled at the schema level (shifts table is created here and referenced by
-- employees + attendance_logs; attendance_logs gains a `status` column populated from shift
-- times + grace period), so they ship in one migration rather than three.
-- See CLAUDE.md §7 Decision Log (2026-07-05) for the locked decisions.

-- ── C2: Shifts ───────────────────────────────────────────
-- Reusable shift definitions referenced by employees (their default shift) and by
-- attendance_logs (a snapshot of which shift a punch was recorded under, for audit).
-- start_time/end_time are "HH:MM" 24h strings — naive local time, no timezone, matching
-- the rest of the app's local-time convention (see attendance.ts nowLocalISO).
-- Night shifts that cross midnight (e.g. 22:00→06:00) are supported by the validation
-- logic in the service layer; the columns themselves are plain strings.

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  start_time TEXT NOT NULL,                -- "HH:MM" 24h
  end_time TEXT NOT NULL,                  -- "HH:MM" 24h
  standard_hours REAL NOT NULL CHECK(standard_hours > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default shifts so the admin can start assigning immediately.
INSERT OR IGNORE INTO shifts (name, start_time, end_time, standard_hours) VALUES
('Morning',   '08:00', '17:00', 8.0),
('Afternoon', '13:00', '22:00', 8.0),
('Night',     '22:00', '06:00', 8.0);

-- ── C1: Leave ────────────────────────────────────────────
-- Per-employee yearly entitlement balances. One row per (employee, leave_type, year).
-- `balance` is decremented when a leave request is approved; the admin can top it up
-- by editing this row. Unpaid leave has no cap (balance is informational only).

CREATE TABLE IF NOT EXISTS employee_leave_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL CHECK(leave_type IN ('annual', 'sick', 'unpaid')),
  balance REAL NOT NULL DEFAULT 0 CHECK(balance >= 0),
  year INTEGER NOT NULL CHECK(year >= 2000 AND year <= 2100),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id, leave_type, year)
);

CREATE INDEX IF NOT EXISTS idx_leave_entitlements_employee_year
  ON employee_leave_entitlements(employee_id, year);

-- Leave requests. date_from/date_to are inclusive "YYYY-MM-DD" strings.
-- status: 'pending' (admin hasn't decided) → 'approved' (counts against balance, excluded
-- from payroll hours) or 'rejected' (no effect). Only 'approved' leave affects payroll.

CREATE TABLE IF NOT EXISTS leave_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type TEXT NOT NULL CHECK(leave_type IN ('annual', 'sick', 'unpaid')),
  date_from TEXT NOT NULL,                  -- YYYY-MM-DD inclusive
  date_to TEXT NOT NULL,                    -- YYYY-MM-DD inclusive
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_leave_records_employee_dates
  ON leave_records(employee_id, date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_leave_records_status
  ON leave_records(status);

-- ── C2 + C3: attendance_logs additions ───────────────────
-- shift_id: snapshot of the shift the employee was assigned to AT THE TIME of the punch.
-- Nullable because (a) the employee may have no assigned shift, and (b) historical rows
-- predate this column. Kept as a FK to shifts with ON DELETE SET NULL so deleting a shift
-- definition never destroys historical punch records — the snapshot column just goes null.
-- status: populated by validateAttendanceStatus() on clock-in. 'absent' is set by the
-- monthly summary/report layer for days with no IN punch, not by clock-in itself.

ALTER TABLE attendance_logs ADD COLUMN shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL;
ALTER TABLE attendance_logs ADD COLUMN status TEXT NOT NULL DEFAULT 'on-time'
  CHECK(status IN ('on-time', 'late', 'absent', 'excused-late'));

-- ── C2: employees.shift_id ───────────────────────────────
-- The employee's default shift. Nullable = standard 9–5 / no enforced shift.
-- ON DELETE SET NULL so removing a shift definition doesn't lose the employee record.

ALTER TABLE employees ADD COLUMN shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL;

-- ── C3: payroll_settings.grace_period_minutes ────────────
-- How many minutes after shift start a clock-in still counts as 'on-time'.
-- Default 15 (common Malaysian SME grace period). The late report uses this.

ALTER TABLE payroll_settings ADD COLUMN grace_period_minutes INTEGER NOT NULL DEFAULT 15 CHECK(grace_period_minutes >= 0);