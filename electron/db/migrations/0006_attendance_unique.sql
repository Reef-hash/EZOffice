-- Migration 0006: Add unique constraint on attendance_logs(employee_id, timestamp, type).
-- Previously, the SELECT COUNT(*) check before insert in syncFromDeviceEthernet could race
-- under concurrent syncs and insert duplicate rows. A DB-level constraint makes deduplication
-- atomic — any duplicate insert becomes a constraint violation instead of a silent duplicate row.
-- IF NOT EXISTS: safe to re-run on databases that already had this manually applied.

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_unique
  ON attendance_logs(employee_id, timestamp, type);
