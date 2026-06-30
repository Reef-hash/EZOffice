-- Migration 0002: Attendance module — attendance_logs table.
-- One row per punch event. Supports multiple IN/OUT pairs per day (lunch breaks, etc.).
-- Employee FK uses ON DELETE RESTRICT to prevent losing attendance history.
-- `source` tracks how the row was created ('manual' | 'device'), separate from `device_id`
-- which stays null until Phase 3 wires a real fingerprint device.

CREATE TABLE IF NOT EXISTS attendance_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK(type IN ('in', 'out')),
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'device')),
  device_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee_timestamp
  ON attendance_logs(employee_id, timestamp);
