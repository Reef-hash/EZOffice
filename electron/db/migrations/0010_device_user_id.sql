-- Migration 0010: Add device_user_id column to employees for ZKTeco sync mapping.
-- ZKTeco devices use internal User IDs (small integers, e.g. 1, 2, 3...) when
-- users are enrolled. This column maps those device IDs to EZOffice employee IDs.
-- UNIQUE constraint is enforced by the application layer (SQLite ALTER TABLE
-- does not support ADD COLUMN with UNIQUE).

ALTER TABLE employees ADD COLUMN device_user_id INTEGER;
