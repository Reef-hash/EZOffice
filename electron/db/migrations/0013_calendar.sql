-- Migration 0013: Phase 1 — Company Calendar
-- See docs/hrms-architecture-proposal.md §4 for full design.
--
-- Three tables:
--   company_calendar_profiles  — singleton that defines the default working week
--   employee_calendar_profiles — per-employee override (nullable = use company default)
--   calendar_events            — date-specific exceptions (public holidays, etc.)

-- ── Company Calendar Profile ──────────────────────────────────
-- Singleton: the system creates one row on first migration, admin edits it.
-- Seven boolean columns for each day of the week — clear, no bitmask.

CREATE TABLE IF NOT EXISTS company_calendar_profiles (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL DEFAULT 'Standard Malaysian',
  monday_is_working  INTEGER NOT NULL DEFAULT 1,
  tuesday_is_working INTEGER NOT NULL DEFAULT 1,
  wednesday_is_working INTEGER NOT NULL DEFAULT 1,
  thursday_is_working INTEGER NOT NULL DEFAULT 1,
  friday_is_working  INTEGER NOT NULL DEFAULT 1,
  saturday_is_working INTEGER NOT NULL DEFAULT 0,
  sunday_is_working  INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO company_calendar_profiles (name) VALUES ('Standard Malaysian');

-- ── Employee Calendar Profile ─────────────────────────────────
-- Per-employee override. NULL = inherit company default.
-- effective_from/effective_to allow schedule changes over time.
-- UNIQUE(employee_id, effective_from) prevents overlapping active periods.

CREATE TABLE IF NOT EXISTS employee_calendar_profiles (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id           INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  monday_is_working     INTEGER NOT NULL DEFAULT 1,
  tuesday_is_working    INTEGER NOT NULL DEFAULT 1,
  wednesday_is_working  INTEGER NOT NULL DEFAULT 1,
  thursday_is_working   INTEGER NOT NULL DEFAULT 1,
  friday_is_working     INTEGER NOT NULL DEFAULT 1,
  saturday_is_working   INTEGER NOT NULL DEFAULT 0,
  sunday_is_working     INTEGER NOT NULL DEFAULT 0,
  effective_from        TEXT    NOT NULL,  -- YYYY-MM-DD inclusive
  effective_to          TEXT,               -- YYYY-MM-DD inclusive, NULL = ongoing
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_emp_cal_profiles_employee
  ON employee_calendar_profiles(employee_id);

-- ── Calendar Events ────────────────────────────────────────────
-- Date-specific exceptions. One row per (event_date, event_type).
-- event_type determines priority during resolution (see §4.4 of HRMS proposal).

CREATE TABLE IF NOT EXISTS calendar_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type    TEXT    NOT NULL CHECK(event_type IN (
    'public_holiday', 'company_holiday', 'special_working_day',
    'half_day', 'emergency_closure', 'company_event'
  )),
  name          TEXT    NOT NULL,              -- Human-readable (e.g. "Hari Merdeka")
  event_date    TEXT    NOT NULL,              -- YYYY-MM-DD
  description   TEXT,
  is_recurring  INTEGER NOT NULL DEFAULT 0,    -- 1 = repeats yearly
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_date_type
  ON calendar_events(event_date, event_type);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date
  ON calendar_events(event_date);

-- ── Seed: Malaysian public holidays 2026 ───────────────────────
-- Hari Raya and other Islamic holidays are estimates (moon-sighting dependent).
INSERT OR IGNORE INTO calendar_events (event_type, name, event_date, is_recurring) VALUES
  ('public_holiday', 'Hari Merdeka',             '2026-08-31', 1),
  ('public_holiday', 'Malaysia Day',             '2026-09-16', 1),
  ('public_holiday', 'Deepavali',                '2026-11-08', 0),
  ('public_holiday', 'Christmas Day',            '2026-12-25', 1),
  ('public_holiday', 'New Year',                 '2027-01-01', 1),
  ('public_holiday', 'Thaipusam',                '2026-01-29', 0),
  ('public_holiday', 'Chinese New Year Day 1',   '2026-02-17', 0),
  ('public_holiday', 'Chinese New Year Day 2',   '2026-02-18', 0),
  ('public_holiday', 'Nuzul Al-Quran',           '2026-03-05', 0),
  ('public_holiday', 'Hari Raya Puasa Day 1',    '2026-03-31', 0),
  ('public_holiday', 'Hari Raya Puasa Day 2',    '2026-04-01', 0),
  ('public_holiday', 'Labour Day',               '2026-05-01', 1),
  ('public_holiday', 'Wesak Day',                '2026-05-31', 0),
  ('public_holiday', 'Agong Birthday',           '2026-06-08', 0),
  ('public_holiday', 'Hari Raya Haji Day 1',     '2026-06-26', 0),
  ('public_holiday', 'Hari Raya Haji Day 2',     '2026-06-27', 0),
  ('public_holiday', 'Awal Muharram',            '2026-07-17', 0),
  ('public_holiday', 'Prophet Muhammad Birthday','2026-09-25', 0);
