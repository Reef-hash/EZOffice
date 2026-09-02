-- Migration 0025: Sales × rate% commission entry, Basic/Commission payslip split,
-- and a fixed recurring allowance on salary structures.
--
-- Background (reported by the project owner testing v0.5.4's commission-only flow):
-- HR was entering the RAW SALES TOTAL (e.g. RM12,000) directly into the Commission
-- Panel's "Amount" field, which migration 0024 treats as the FINAL commission dollar
-- figure — producing a wildly overstated gross pay. The actual expected flow is:
--   sales (RM12,000) x rate (20%) = commission (RM2,400)
--   commission (RM2,400) split into "Basic" (up to the statutory base, e.g. RM1,700,
--     shown on the payslip and given FULL EPF/SOCSO/EIS treatment like a normal wage)
--     + "Commission" (the remainder, RM700)
-- See this session's chat for the full requirements discussion and the confirmed
-- decisions (commission rate entered per-run, not stored on the employee; the Basic
-- portion gets full statutory treatment on its own value, not just used as a bracket
-- reference; a separate fixed_allowance feature for all rate types, EPF-excluded).
--
-- All three changes below are plain ADD COLUMNs — no CHECK constraint touches an
-- existing column and no table recreate is needed (unlike 0017/0024's salary_structures
-- changes, which had to widen a CHECK). Kept deliberately low-risk.

-- ── payroll_run_commissions: sales x rate% entry, alongside the existing flat amount ──
-- Both nullable: an entry can either (a) supply sales_amount + optional commission_rate,
-- in which case the service layer computes and overwrites `amount` server-side (never
-- trusts a client-supplied amount when a sales basis is given), or (b) supply `amount`
-- directly as before, for a flat one-off bonus not tied to a sales percentage. At least
-- one of the two must be present — enforced by Zod (upsertPayrollRunCommissionSchema),
-- not a DB CHECK, since that cross-field rule needs sibling-column awareness.
ALTER TABLE payroll_run_commissions ADD COLUMN sales_amount REAL
  CHECK(sales_amount IS NULL OR sales_amount >= 0);
ALTER TABLE payroll_run_commissions ADD COLUMN commission_rate REAL
  CHECK(commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100));

-- ── salary_structures: fixed recurring allowance, all rate types ──────────────
-- Not a wage — EPF Act 1991 Third Schedule excludes traveling/fixed allowances of
-- this kind from EPF "wages" (see calculationEngine.ts). Included in gross/net pay
-- and the PCB base (ordinary taxable income), same treatment as OT's PCB inclusion
-- despite its EPF exclusion — no confirmed exemption for PCB purposes, so the safer
-- default is to tax it, not silently exempt it.
ALTER TABLE salary_structures ADD COLUMN fixed_allowance REAL NOT NULL DEFAULT 0
  CHECK(fixed_allowance >= 0);
ALTER TABLE salary_structures ADD COLUMN allowance_description TEXT;

-- ── payroll_run_items: snapshot the allowance actually paid + its label ───────
-- basic_salary_snapshot (added by 0022 for the monthly+attendance_required feature)
-- is REUSED for the commission-only Basic/Commission split rather than adding a new
-- column meaning the same thing ("the portion of gross pay treated as a base salary
-- this run") — the two features are mutually exclusive by rate_type, so the column
-- can never be ambiguous between them. No new column needed for the split itself;
-- the "Commission" remainder for display is commission - basic_salary_snapshot.
ALTER TABLE payroll_run_items ADD COLUMN allowance REAL NOT NULL DEFAULT 0;
ALTER TABLE payroll_run_items ADD COLUMN allowance_description TEXT;
