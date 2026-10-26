-- Migration 0029: built-in PERKESO contribution tables + LINDUNG 24 Jam.
--
-- 1. SOCSO (Act 4, first category) and EIS (Act 800) tables now ship with the app, so
--    admins no longer type ~65 bracket rows by hand. Rows are tagged source='builtin';
--    rows an admin adds stay 'manual' and act as overrides (a later effective_from wins
--    in the lookup). Built-in rows are read-only in the service layer — a rate change
--    from PERKESO ships as a new migration with a new effective_from, so payroll runs
--    for earlier dates keep using the rates in force at that time.
--
-- 2. LINDUNG 24 Jam (Skim Kemalangan Bukan Bencana Kerja, Akta 4 pindaan 2026) —
--    employee-only contribution, Fasa 1 = 0.75% from 2026-06-01, RM6,000 ceiling.
--    Contributions are opt-out for local employees since July 2026 (mandatory for
--    foreign workers), hence a per-employee flag on salary_structures, default ON.
--    Fasa 2 (1.00%) / Fasa 3 (1.25%) amounts are NOT seeded: PERKESO has not yet
--    published those tables, and guessing contribution amounts is not acceptable.
--
-- Bracket semantics (applies to every row here): PERKESO tables read "exceeding
-- wage_from but not exceeding wage_to", i.e. wage_from < wage <= wage_to. See
-- lookupBracket in electron/services/payroll/statutoryRates.ts.
--
-- Data provenance (see CLAUDE.md Decision Log 2026-10-26):
--   - LINDUNG RM1,600.01–RM6,000 rows match PERKESO's own "Jadual Kadar Faedah
--     LINDUNG 24 Jam" (Fasa 1) exactly; rows below RM1,600 are derived from a
--     secondary published table and are not yet checked against an official PERKESO
--     contribution schedule.
--   - SOCSO/EIS rows come from two independent published copies of the 1 Oct 2024
--     schedule that agree row for row, and every RM100 band from RM200 up matches the
--     statutory rate formula (see perkesoBuiltinTables.test.ts). Not yet checked
--     against PERKESO's official PDF, which could not be fetched from the build host.

ALTER TABLE socso_rates ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('builtin', 'manual'));
ALTER TABLE eis_rates ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('builtin', 'manual'));

CREATE TABLE IF NOT EXISTS lindung_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_from TEXT NOT NULL,
  employee_category TEXT NOT NULL DEFAULT 'all',
  wage_from REAL NOT NULL CHECK(wage_from >= 0),
  wage_to REAL CHECK(wage_to IS NULL OR wage_to > wage_from),
  employee_contribution REAL NOT NULL DEFAULT 0 CHECK(employee_contribution >= 0),
  -- Always 0 under the current scheme (employee-only); kept so the table has the same
  -- shape as socso_rates/eis_rates and shares their lookup and UI.
  employer_contribution REAL NOT NULL DEFAULT 0 CHECK(employer_contribution >= 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('builtin', 'manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE salary_structures ADD COLUMN subject_to_lindung INTEGER NOT NULL DEFAULT 1 CHECK(subject_to_lindung IN (0, 1));

-- Snapshotted like every other statutory line — a finalized payslip never changes.
ALTER TABLE payroll_run_items ADD COLUMN snapshot_subject_to_lindung INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_run_items ADD COLUMN lindung_employee REAL NOT NULL DEFAULT 0;

INSERT INTO socso_rates (effective_from, employee_category, wage_from, wage_to, employee_contribution, employer_contribution, source) VALUES
('2024-10-01', 'all', 0, 30, 0.10, 0.40, 'builtin'),
('2024-10-01', 'all', 30, 50, 0.20, 0.70, 'builtin'),
('2024-10-01', 'all', 50, 70, 0.30, 1.10, 'builtin'),
('2024-10-01', 'all', 70, 100, 0.40, 1.50, 'builtin'),
('2024-10-01', 'all', 100, 140, 0.60, 2.10, 'builtin'),
('2024-10-01', 'all', 140, 200, 0.85, 2.95, 'builtin'),
('2024-10-01', 'all', 200, 300, 1.25, 4.35, 'builtin'),
('2024-10-01', 'all', 300, 400, 1.75, 6.15, 'builtin'),
('2024-10-01', 'all', 400, 500, 2.25, 7.85, 'builtin'),
('2024-10-01', 'all', 500, 600, 2.75, 9.65, 'builtin'),
('2024-10-01', 'all', 600, 700, 3.25, 11.35, 'builtin'),
('2024-10-01', 'all', 700, 800, 3.75, 13.15, 'builtin'),
('2024-10-01', 'all', 800, 900, 4.25, 14.85, 'builtin'),
('2024-10-01', 'all', 900, 1000, 4.75, 16.65, 'builtin'),
('2024-10-01', 'all', 1000, 1100, 5.25, 18.35, 'builtin'),
('2024-10-01', 'all', 1100, 1200, 5.75, 20.15, 'builtin'),
('2024-10-01', 'all', 1200, 1300, 6.25, 21.85, 'builtin'),
('2024-10-01', 'all', 1300, 1400, 6.75, 23.65, 'builtin'),
('2024-10-01', 'all', 1400, 1500, 7.25, 25.35, 'builtin'),
('2024-10-01', 'all', 1500, 1600, 7.75, 27.15, 'builtin'),
('2024-10-01', 'all', 1600, 1700, 8.25, 28.85, 'builtin'),
('2024-10-01', 'all', 1700, 1800, 8.75, 30.65, 'builtin'),
('2024-10-01', 'all', 1800, 1900, 9.25, 32.35, 'builtin'),
('2024-10-01', 'all', 1900, 2000, 9.75, 34.15, 'builtin'),
('2024-10-01', 'all', 2000, 2100, 10.25, 35.85, 'builtin'),
('2024-10-01', 'all', 2100, 2200, 10.75, 37.65, 'builtin'),
('2024-10-01', 'all', 2200, 2300, 11.25, 39.35, 'builtin'),
('2024-10-01', 'all', 2300, 2400, 11.75, 41.15, 'builtin'),
('2024-10-01', 'all', 2400, 2500, 12.25, 42.85, 'builtin'),
('2024-10-01', 'all', 2500, 2600, 12.75, 44.65, 'builtin'),
('2024-10-01', 'all', 2600, 2700, 13.25, 46.35, 'builtin'),
('2024-10-01', 'all', 2700, 2800, 13.75, 48.15, 'builtin'),
('2024-10-01', 'all', 2800, 2900, 14.25, 49.85, 'builtin'),
('2024-10-01', 'all', 2900, 3000, 14.75, 51.65, 'builtin'),
('2024-10-01', 'all', 3000, 3100, 15.25, 53.35, 'builtin'),
('2024-10-01', 'all', 3100, 3200, 15.75, 55.15, 'builtin'),
('2024-10-01', 'all', 3200, 3300, 16.25, 56.85, 'builtin'),
('2024-10-01', 'all', 3300, 3400, 16.75, 58.65, 'builtin'),
('2024-10-01', 'all', 3400, 3500, 17.25, 60.35, 'builtin'),
('2024-10-01', 'all', 3500, 3600, 17.75, 62.15, 'builtin'),
('2024-10-01', 'all', 3600, 3700, 18.25, 63.85, 'builtin'),
('2024-10-01', 'all', 3700, 3800, 18.75, 65.65, 'builtin'),
('2024-10-01', 'all', 3800, 3900, 19.25, 67.35, 'builtin'),
('2024-10-01', 'all', 3900, 4000, 19.75, 69.15, 'builtin'),
('2024-10-01', 'all', 4000, 4100, 20.25, 70.85, 'builtin'),
('2024-10-01', 'all', 4100, 4200, 20.75, 72.65, 'builtin'),
('2024-10-01', 'all', 4200, 4300, 21.25, 74.35, 'builtin'),
('2024-10-01', 'all', 4300, 4400, 21.75, 76.15, 'builtin'),
('2024-10-01', 'all', 4400, 4500, 22.25, 77.85, 'builtin'),
('2024-10-01', 'all', 4500, 4600, 22.75, 79.65, 'builtin'),
('2024-10-01', 'all', 4600, 4700, 23.25, 81.35, 'builtin'),
('2024-10-01', 'all', 4700, 4800, 23.75, 83.15, 'builtin'),
('2024-10-01', 'all', 4800, 4900, 24.25, 84.85, 'builtin'),
('2024-10-01', 'all', 4900, 5000, 24.75, 86.65, 'builtin'),
('2024-10-01', 'all', 5000, 5100, 25.25, 88.35, 'builtin'),
('2024-10-01', 'all', 5100, 5200, 25.75, 90.15, 'builtin'),
('2024-10-01', 'all', 5200, 5300, 26.25, 91.85, 'builtin'),
('2024-10-01', 'all', 5300, 5400, 26.75, 93.65, 'builtin'),
('2024-10-01', 'all', 5400, 5500, 27.25, 95.35, 'builtin'),
('2024-10-01', 'all', 5500, 5600, 27.75, 97.15, 'builtin'),
('2024-10-01', 'all', 5600, 5700, 28.25, 98.85, 'builtin'),
('2024-10-01', 'all', 5700, 5800, 28.75, 100.65, 'builtin'),
('2024-10-01', 'all', 5800, 5900, 29.25, 102.35, 'builtin'),
('2024-10-01', 'all', 5900, 6000, 29.75, 104.15, 'builtin'),
('2024-10-01', 'all', 6000, NULL, 29.75, 104.15, 'builtin');

INSERT INTO eis_rates (effective_from, employee_category, wage_from, wage_to, employee_contribution, employer_contribution, source) VALUES
('2024-10-01', 'all', 0, 30, 0.05, 0.05, 'builtin'),
('2024-10-01', 'all', 30, 50, 0.10, 0.10, 'builtin'),
('2024-10-01', 'all', 50, 70, 0.15, 0.15, 'builtin'),
('2024-10-01', 'all', 70, 100, 0.20, 0.20, 'builtin'),
('2024-10-01', 'all', 100, 140, 0.25, 0.25, 'builtin'),
('2024-10-01', 'all', 140, 200, 0.35, 0.35, 'builtin'),
('2024-10-01', 'all', 200, 300, 0.50, 0.50, 'builtin'),
('2024-10-01', 'all', 300, 400, 0.70, 0.70, 'builtin'),
('2024-10-01', 'all', 400, 500, 0.90, 0.90, 'builtin'),
('2024-10-01', 'all', 500, 600, 1.10, 1.10, 'builtin'),
('2024-10-01', 'all', 600, 700, 1.30, 1.30, 'builtin'),
('2024-10-01', 'all', 700, 800, 1.50, 1.50, 'builtin'),
('2024-10-01', 'all', 800, 900, 1.70, 1.70, 'builtin'),
('2024-10-01', 'all', 900, 1000, 1.90, 1.90, 'builtin'),
('2024-10-01', 'all', 1000, 1100, 2.10, 2.10, 'builtin'),
('2024-10-01', 'all', 1100, 1200, 2.30, 2.30, 'builtin'),
('2024-10-01', 'all', 1200, 1300, 2.50, 2.50, 'builtin'),
('2024-10-01', 'all', 1300, 1400, 2.70, 2.70, 'builtin'),
('2024-10-01', 'all', 1400, 1500, 2.90, 2.90, 'builtin'),
('2024-10-01', 'all', 1500, 1600, 3.10, 3.10, 'builtin'),
('2024-10-01', 'all', 1600, 1700, 3.30, 3.30, 'builtin'),
('2024-10-01', 'all', 1700, 1800, 3.50, 3.50, 'builtin'),
('2024-10-01', 'all', 1800, 1900, 3.70, 3.70, 'builtin'),
('2024-10-01', 'all', 1900, 2000, 3.90, 3.90, 'builtin'),
('2024-10-01', 'all', 2000, 2100, 4.10, 4.10, 'builtin'),
('2024-10-01', 'all', 2100, 2200, 4.30, 4.30, 'builtin'),
('2024-10-01', 'all', 2200, 2300, 4.50, 4.50, 'builtin'),
('2024-10-01', 'all', 2300, 2400, 4.70, 4.70, 'builtin'),
('2024-10-01', 'all', 2400, 2500, 4.90, 4.90, 'builtin'),
('2024-10-01', 'all', 2500, 2600, 5.10, 5.10, 'builtin'),
('2024-10-01', 'all', 2600, 2700, 5.30, 5.30, 'builtin'),
('2024-10-01', 'all', 2700, 2800, 5.50, 5.50, 'builtin'),
('2024-10-01', 'all', 2800, 2900, 5.70, 5.70, 'builtin'),
('2024-10-01', 'all', 2900, 3000, 5.90, 5.90, 'builtin'),
('2024-10-01', 'all', 3000, 3100, 6.10, 6.10, 'builtin'),
('2024-10-01', 'all', 3100, 3200, 6.30, 6.30, 'builtin'),
('2024-10-01', 'all', 3200, 3300, 6.50, 6.50, 'builtin'),
('2024-10-01', 'all', 3300, 3400, 6.70, 6.70, 'builtin'),
('2024-10-01', 'all', 3400, 3500, 6.90, 6.90, 'builtin'),
('2024-10-01', 'all', 3500, 3600, 7.10, 7.10, 'builtin'),
('2024-10-01', 'all', 3600, 3700, 7.30, 7.30, 'builtin'),
('2024-10-01', 'all', 3700, 3800, 7.50, 7.50, 'builtin'),
('2024-10-01', 'all', 3800, 3900, 7.70, 7.70, 'builtin'),
('2024-10-01', 'all', 3900, 4000, 7.90, 7.90, 'builtin'),
('2024-10-01', 'all', 4000, 4100, 8.10, 8.10, 'builtin'),
('2024-10-01', 'all', 4100, 4200, 8.30, 8.30, 'builtin'),
('2024-10-01', 'all', 4200, 4300, 8.50, 8.50, 'builtin'),
('2024-10-01', 'all', 4300, 4400, 8.70, 8.70, 'builtin'),
('2024-10-01', 'all', 4400, 4500, 8.90, 8.90, 'builtin'),
('2024-10-01', 'all', 4500, 4600, 9.10, 9.10, 'builtin'),
('2024-10-01', 'all', 4600, 4700, 9.30, 9.30, 'builtin'),
('2024-10-01', 'all', 4700, 4800, 9.50, 9.50, 'builtin'),
('2024-10-01', 'all', 4800, 4900, 9.70, 9.70, 'builtin'),
('2024-10-01', 'all', 4900, 5000, 9.90, 9.90, 'builtin'),
('2024-10-01', 'all', 5000, 5100, 10.10, 10.10, 'builtin'),
('2024-10-01', 'all', 5100, 5200, 10.30, 10.30, 'builtin'),
('2024-10-01', 'all', 5200, 5300, 10.50, 10.50, 'builtin'),
('2024-10-01', 'all', 5300, 5400, 10.70, 10.70, 'builtin'),
('2024-10-01', 'all', 5400, 5500, 10.90, 10.90, 'builtin'),
('2024-10-01', 'all', 5500, 5600, 11.10, 11.10, 'builtin'),
('2024-10-01', 'all', 5600, 5700, 11.30, 11.30, 'builtin'),
('2024-10-01', 'all', 5700, 5800, 11.50, 11.50, 'builtin'),
('2024-10-01', 'all', 5800, 5900, 11.70, 11.70, 'builtin'),
('2024-10-01', 'all', 5900, 6000, 11.90, 11.90, 'builtin'),
('2024-10-01', 'all', 6000, NULL, 11.90, 11.90, 'builtin');

INSERT INTO lindung_rates (effective_from, employee_category, wage_from, wage_to, employee_contribution, employer_contribution, source) VALUES
('2026-06-01', 'all', 0, 30, 0.20, 0.00, 'builtin'),
('2026-06-01', 'all', 30, 50, 0.30, 0.00, 'builtin'),
('2026-06-01', 'all', 50, 70, 0.50, 0.00, 'builtin'),
('2026-06-01', 'all', 70, 100, 0.65, 0.00, 'builtin'),
('2026-06-01', 'all', 100, 140, 0.90, 0.00, 'builtin'),
('2026-06-01', 'all', 140, 200, 1.25, 0.00, 'builtin'),
('2026-06-01', 'all', 200, 300, 1.85, 0.00, 'builtin'),
('2026-06-01', 'all', 300, 400, 2.65, 0.00, 'builtin'),
('2026-06-01', 'all', 400, 500, 3.35, 0.00, 'builtin'),
('2026-06-01', 'all', 500, 600, 4.15, 0.00, 'builtin'),
('2026-06-01', 'all', 600, 700, 4.85, 0.00, 'builtin'),
('2026-06-01', 'all', 700, 800, 5.65, 0.00, 'builtin'),
('2026-06-01', 'all', 800, 900, 6.35, 0.00, 'builtin'),
('2026-06-01', 'all', 900, 1000, 7.15, 0.00, 'builtin'),
('2026-06-01', 'all', 1000, 1100, 7.85, 0.00, 'builtin'),
('2026-06-01', 'all', 1100, 1200, 8.65, 0.00, 'builtin'),
('2026-06-01', 'all', 1200, 1300, 9.35, 0.00, 'builtin'),
('2026-06-01', 'all', 1300, 1400, 10.15, 0.00, 'builtin'),
('2026-06-01', 'all', 1400, 1500, 10.85, 0.00, 'builtin'),
('2026-06-01', 'all', 1500, 1600, 11.65, 0.00, 'builtin'),
('2026-06-01', 'all', 1600, 1700, 12.35, 0.00, 'builtin'),
('2026-06-01', 'all', 1700, 1800, 13.15, 0.00, 'builtin'),
('2026-06-01', 'all', 1800, 1900, 13.85, 0.00, 'builtin'),
('2026-06-01', 'all', 1900, 2000, 14.65, 0.00, 'builtin'),
('2026-06-01', 'all', 2000, 2100, 15.35, 0.00, 'builtin'),
('2026-06-01', 'all', 2100, 2200, 16.15, 0.00, 'builtin'),
('2026-06-01', 'all', 2200, 2300, 16.85, 0.00, 'builtin'),
('2026-06-01', 'all', 2300, 2400, 17.65, 0.00, 'builtin'),
('2026-06-01', 'all', 2400, 2500, 18.35, 0.00, 'builtin'),
('2026-06-01', 'all', 2500, 2600, 19.15, 0.00, 'builtin'),
('2026-06-01', 'all', 2600, 2700, 19.85, 0.00, 'builtin'),
('2026-06-01', 'all', 2700, 2800, 20.65, 0.00, 'builtin'),
('2026-06-01', 'all', 2800, 2900, 21.35, 0.00, 'builtin'),
('2026-06-01', 'all', 2900, 3000, 22.15, 0.00, 'builtin'),
('2026-06-01', 'all', 3000, 3100, 22.85, 0.00, 'builtin'),
('2026-06-01', 'all', 3100, 3200, 23.65, 0.00, 'builtin'),
('2026-06-01', 'all', 3200, 3300, 24.35, 0.00, 'builtin'),
('2026-06-01', 'all', 3300, 3400, 25.15, 0.00, 'builtin'),
('2026-06-01', 'all', 3400, 3500, 25.85, 0.00, 'builtin'),
('2026-06-01', 'all', 3500, 3600, 26.65, 0.00, 'builtin'),
('2026-06-01', 'all', 3600, 3700, 27.35, 0.00, 'builtin'),
('2026-06-01', 'all', 3700, 3800, 28.15, 0.00, 'builtin'),
('2026-06-01', 'all', 3800, 3900, 28.85, 0.00, 'builtin'),
('2026-06-01', 'all', 3900, 4000, 29.65, 0.00, 'builtin'),
('2026-06-01', 'all', 4000, 4100, 30.35, 0.00, 'builtin'),
('2026-06-01', 'all', 4100, 4200, 31.15, 0.00, 'builtin'),
('2026-06-01', 'all', 4200, 4300, 31.85, 0.00, 'builtin'),
('2026-06-01', 'all', 4300, 4400, 32.65, 0.00, 'builtin'),
('2026-06-01', 'all', 4400, 4500, 33.35, 0.00, 'builtin'),
('2026-06-01', 'all', 4500, 4600, 34.15, 0.00, 'builtin'),
('2026-06-01', 'all', 4600, 4700, 34.85, 0.00, 'builtin'),
('2026-06-01', 'all', 4700, 4800, 35.65, 0.00, 'builtin'),
('2026-06-01', 'all', 4800, 4900, 36.35, 0.00, 'builtin'),
('2026-06-01', 'all', 4900, 5000, 37.15, 0.00, 'builtin'),
('2026-06-01', 'all', 5000, 5100, 37.85, 0.00, 'builtin'),
('2026-06-01', 'all', 5100, 5200, 38.65, 0.00, 'builtin'),
('2026-06-01', 'all', 5200, 5300, 39.35, 0.00, 'builtin'),
('2026-06-01', 'all', 5300, 5400, 40.15, 0.00, 'builtin'),
('2026-06-01', 'all', 5400, 5500, 40.85, 0.00, 'builtin'),
('2026-06-01', 'all', 5500, 5600, 41.65, 0.00, 'builtin'),
('2026-06-01', 'all', 5600, 5700, 42.35, 0.00, 'builtin'),
('2026-06-01', 'all', 5700, 5800, 43.15, 0.00, 'builtin'),
('2026-06-01', 'all', 5800, 5900, 43.85, 0.00, 'builtin'),
('2026-06-01', 'all', 5900, 6000, 44.65, 0.00, 'builtin'),
('2026-06-01', 'all', 6000, NULL, 44.65, 0.00, 'builtin');
