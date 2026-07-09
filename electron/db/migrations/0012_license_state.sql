-- Migration 0012: License activation state (docs/LICENSE_INTEGRATION_AUDIT.md).
-- Singleton table caching the last successful license validate/activate
-- response from EZPos-Web, plus the device fingerprint used for that
-- activation. No seed row: the ABSENCE of a row is how the app detects
-- "not yet activated" and shows the activation screen — do not INSERT a
-- default row here the way company_settings does.
--
-- decision/grace_days/revalidate_after_hours/checked_at are plain columns
-- (not buried in the JSON blob) so the launch-time grace-window check is a
-- single indexed row read, no JSON parsing needed on the hot path.

CREATE TABLE IF NOT EXISTS license_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),   -- singleton: only one row
  license_key TEXT NOT NULL,               -- resolved at activation; used for silent
                                            -- background /validate calls (no repeat OTP)
  decision TEXT NOT NULL CHECK(decision IN ('allow', 'deny', 'allow_temporarily')),
  status TEXT NOT NULL,                   -- mirrors backend ValidationStatus (valid/expired/revoked/...)
  reason_code TEXT NOT NULL,
  client_action TEXT NOT NULL,
  product TEXT NOT NULL DEFAULT 'ezoffice',
  customer_email TEXT,                    -- for display: "Activated for: name@company.com"
  grace_days INTEGER NOT NULL,
  revalidate_after_hours INTEGER NOT NULL,
  device_fingerprint TEXT NOT NULL,
  checked_at TEXT NOT NULL,                -- ISO timestamp of last successful server contact
  raw_response_json TEXT NOT NULL,         -- full activate/validate response, for audit/debugging
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
