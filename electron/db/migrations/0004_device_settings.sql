-- Migration 0004: Device settings — add fingerprint reader configuration to payroll_settings.
-- See CLAUDE.md §7 Decision Log (2026-06-28) for the locked scope.

-- ── Device Settings ──────────────────────────────────────
-- Extend payroll_settings singleton to include ZKTeco V1000 device connection details.
-- device_ip: IP address or hostname of the fingerprint reader (nullable = unconfigured).
-- device_port: TCP port (default 4370 for ZKTeco).

ALTER TABLE payroll_settings
ADD COLUMN device_ip TEXT;

ALTER TABLE payroll_settings
ADD COLUMN device_port INTEGER DEFAULT 4370;
