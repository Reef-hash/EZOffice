-- Migration 0010: Company Settings (Phase D1).
-- Singleton table for company profile (name, SST, BRN, bank account, contact, logo).
-- Used by payslips (company header + logo), invoices (tax IDs), and exports.

CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),  -- singleton: only one row
  company_name TEXT,
  sst_number TEXT,
  brn_number TEXT,
  bank_account_name TEXT,
  bank_account_number TEXT,
  email TEXT,                            -- company contact email
  phone TEXT,                            -- company contact phone
  address TEXT,                          -- company address (for invoices)
  logo_base64 TEXT,                      -- company logo as base64-encoded image (PNG/JPG)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed with empty row so the table always has one row to fetch.
INSERT OR IGNORE INTO company_settings (id, company_name) VALUES (1, 'Your Company Name');
