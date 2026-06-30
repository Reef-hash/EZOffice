-- Migration 0008: Add public_holidays table for Malaysian public holidays.
-- Used by workingDaysInMonth() in payrollRun.ts to correctly exclude holidays from
-- the working-day count when computing statutory bracket wages for daily-rate employees.
-- date is the PRIMARY KEY (no id column needed — the calendar date is the natural key).
-- Add state-specific holidays for your state via the app or directly in this table.

CREATE TABLE IF NOT EXISTS public_holidays (
  date TEXT PRIMARY KEY,  -- YYYY-MM-DD
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── 2024 Malaysia national public holidays ───────────────────────────────────
-- Islamic holidays are determined by moon sighting; dates below are official gazetted
-- dates for 2024 (Peninsular Malaysia). Adjust if your state observes different dates.
INSERT OR IGNORE INTO public_holidays (date, name, created_at, updated_at) VALUES
('2024-01-01', 'New Year''s Day',                                  datetime('now'), datetime('now')),
('2024-02-10', 'Chinese New Year (Day 1)',                         datetime('now'), datetime('now')),
('2024-02-11', 'Chinese New Year (Day 2)',                         datetime('now'), datetime('now')),
('2024-04-10', 'Hari Raya Aidilfitri (Day 1)',                     datetime('now'), datetime('now')),
('2024-04-11', 'Hari Raya Aidilfitri (Day 2)',                     datetime('now'), datetime('now')),
('2024-05-01', 'Labour Day',                                       datetime('now'), datetime('now')),
('2024-05-22', 'Wesak Day',                                        datetime('now'), datetime('now')),
('2024-06-03', 'Yang di-Pertuan Agong''s Birthday',                datetime('now'), datetime('now')),
('2024-06-17', 'Hari Raya Aidiladha (Day 1)',                      datetime('now'), datetime('now')),
('2024-06-18', 'Hari Raya Aidiladha (Day 2)',                      datetime('now'), datetime('now')),
('2024-08-31', 'National Day (Hari Merdeka)',                      datetime('now'), datetime('now')),
('2024-09-07', 'Maal Hijrah (Awal Muharram)',                      datetime('now'), datetime('now')),
('2024-09-16', 'Malaysia Day',                                     datetime('now'), datetime('now')),
('2024-10-16', 'Maulidur Rasul (Prophet''s Birthday)',             datetime('now'), datetime('now')),
('2024-12-25', 'Christmas Day',                                    datetime('now'), datetime('now'));

-- ── 2025 Malaysia national public holidays ───────────────────────────────────
INSERT OR IGNORE INTO public_holidays (date, name, created_at, updated_at) VALUES
('2025-01-01', 'New Year''s Day',                                  datetime('now'), datetime('now')),
('2025-01-29', 'Chinese New Year (Day 1)',                         datetime('now'), datetime('now')),
('2025-01-30', 'Chinese New Year (Day 2)',                         datetime('now'), datetime('now')),
('2025-03-31', 'Hari Raya Aidilfitri (Day 1)',                     datetime('now'), datetime('now')),
('2025-04-01', 'Hari Raya Aidilfitri (Day 2)',                     datetime('now'), datetime('now')),
('2025-05-01', 'Labour Day',                                       datetime('now'), datetime('now')),
('2025-05-12', 'Wesak Day',                                        datetime('now'), datetime('now')),
('2025-06-02', 'Yang di-Pertuan Agong''s Birthday',                datetime('now'), datetime('now')),
('2025-06-07', 'Hari Raya Aidiladha (Day 1)',                      datetime('now'), datetime('now')),
('2025-06-08', 'Hari Raya Aidiladha (Day 2)',                      datetime('now'), datetime('now')),
('2025-06-27', 'Maal Hijrah (Awal Muharram)',                      datetime('now'), datetime('now')),
('2025-08-31', 'National Day (Hari Merdeka)',                      datetime('now'), datetime('now')),
('2025-09-05', 'Maulidur Rasul (Prophet''s Birthday)',             datetime('now'), datetime('now')),
('2025-09-16', 'Malaysia Day',                                     datetime('now'), datetime('now')),
('2025-12-25', 'Christmas Day',                                    datetime('now'), datetime('now'));
