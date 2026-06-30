# MAINTENANCE.md — EZOffice Issue Tracker & Known Bugs

This file is the living maintenance record for EZOffice. It is the single place to track:
- Known bugs and correctness issues found during development or review
- Improvements that have been identified but not yet built
- What has been resolved (kept for historical context)

**How to use this file:**
- When you discover a bug or issue, add it to the Open Issues table with the date you found it.
- When you start working on an issue, move it to In Progress.
- When the fix is shipped and verified, move it to Resolved.
- This file is read before starting any phase — do not skip known issues that touch your current work.

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| **Critical** | Produces wrong financial output or data loss. Fix before any real payroll run. |
| **High** | Silent failures, missing API surface, or data integrity gaps. Fix before go-live. |
| **Medium** | Correctness edge cases or UX gaps that will affect users under normal operation. |
| **Low** | Code quality, consistency, and maintainability. Can be deferred. |

---

## Open Issues

### Critical

*(none — all Critical issues resolved)*

---

### High

| # | Found | Title | Detail | Affected Files |
|---|-------|-------|--------|----------------|
| — | — | *(none — all High issues resolved)* | — | — |

---

### Medium

| # | Found | Title | Detail | Affected Files |
|---|-------|-------|--------|----------------|
| M1 | 2026-06-30 | Manual attendance timestamps may not be UTC — timezone mismatch risk | `datetime-local` HTML inputs produce local time without a timezone offset (e.g. `2026-06-30T08:00`). Automated clock-in stores UTC via `new Date().toISOString()`. This creates a mix of timezone-aware and timezone-naive strings in the same `timestamp` column. The monthly summary query uses SQLite's `date(timestamp)` which interprets bare strings as UTC, causing date-bucket errors for manual logs entered in non-UTC timezones (MYT = UTC+8). | `src/modules/attendance/AttendanceLogForm.tsx` (normalize to ISO before IPC call), or `electron/ipc/attendance.ts` |
| M2 | 2026-06-30 | `workingDaysInMonth` ignores Malaysian public holidays | `payrollRun.ts:56–64` counts Mon–Fri only. This over-estimates the monthly wage for statutory bracket lookups in months with public holidays. Daily-rate employees' EPF/SOCSO brackets are computed against an inflated base on those months. | `electron/services/payroll/payrollRun.ts:56` |
| M3 | 2026-06-30 | `attendance:list` and `getMonthlySummary` IPC filters bypass Zod validation | These two handlers use `as {...}` type assertions instead of `zodSchema.parse()`. Every other mutating handler uses Zod, making this inconsistent. Not a SQL injection risk (prepared statements), but violates the stated validation pattern. | `electron/ipc/attendance.ts:16` |
| M4 | 2026-06-30 | `updateSalaryAdvance` resets `balance_outstanding` to `input.amount` when amount is updated | `salaryAdvances.ts:121` — when the advance's `amount` is edited, the outstanding balance is silently reset to the new amount. This could over-credit an employee mid-repayment or erase partial repayments already applied. The intent may be correct, but it is undocumented and unintuitive. | `electron/services/payroll/salaryAdvances.ts:121` |
| M5 | 2026-06-30 | No shared toast/notification system for async action results | Mutation errors and successes display via ad-hoc inline elements on each page. Device sync results, payslip generation, and finalization have no user-visible confirmation beyond what the individual page happens to render. A shared `<Toast>` provider at `AppShell` level would fix this uniformly. | `src/shared/components/` (new), `src/shared/components/AppShell.tsx` |
| M6 | 2026-06-30 | `salary_structure_id: 0` placeholder returned from `calculatePay()` | `calculationEngine.ts:123` returns `salary_structure_id: 0` as a placeholder because the pure function cannot know the DB row ID. The `PayCheckResult` type declares this as `number`, so TypeScript sees it as valid. The orchestrator overwrites it with the real ID, but the intermediate value of 0 is a type lie. | `electron/services/payroll/calculationEngine.ts:123`, `src/shared/types/entities.ts:282` |
| M7 | 2026-06-30 | `payroll_settings` mixes payroll config and hardware config in one singleton | OT rules (payroll domain) and device IP/port (hardware domain) live in the same table. Migration 0004 added device columns via `ALTER TABLE`. A separate `device_settings` singleton table would keep concerns clean. Low urgency now; becomes more important when ERP adds its own settings. | `electron/db/migrations/0004_device_settings.sql`, `electron/services/payroll/settings.ts` |

---

### Low

| # | Found | Title | Detail | Affected Files |
|---|-------|-------|--------|----------------|
| L1 | 2026-06-30 | `sandbox: false` in BrowserWindow | `electron/main.ts:40` — Chromium's process sandbox is disabled. With `contextIsolation: true` and `nodeIntegration: false` the risk is mitigated, but enabling `sandbox: true` adds another layer of defense-in-depth. Requires verifying no renderer code needs unsandboxed capabilities. | `electron/main.ts:40` |
| L2 | 2026-06-30 | Empty catch blocks in quick-clock handlers | `AttendanceListPage.tsx:158` — `catch { // Error is shown by react-query automatically }`. The comment is accurate (the error IS displayed via `clockError`), but bare catch blocks violate CLAUDE.md §3. Should be `catch (err) { /* mutation.error is surfaced below — intentional dismiss */ }` at minimum, or re-throw if the error handling is incomplete. | `src/modules/attendance/AttendanceListPage.tsx:158,170` |
| L3 | 2026-06-30 | `confirm()` used for destructive action dialogs | `AttendanceListPage.tsx:143` uses the native browser `confirm()` dialog for delete confirmations. Does not match the app's design system. Should use the shared `<Modal>` component as a confirmation dialog. | `src/modules/attendance/AttendanceListPage.tsx:143` (likely also other module pages) |
| L4 | 2026-06-30 | `device_id` column in `attendance_logs` is always NULL | `attendance_logs.device_id` was reserved for Phase 3 but `syncFromDeviceEthernet` never writes it. All device-sourced rows have `device_id = NULL`, making the column useless. Either populate it during sync (use the device IP as the device identifier) or remove it via migration. | `electron/services/attendance.ts` (`syncFromDeviceEthernet`), `electron/db/migrations/` |
| L5 | 2026-06-30 | Statutory rate CRUD duplicated four times in `statutoryRates.ts` | EPF, SOCSO, EIS, and PCB bracket services share the same structure with only column name differences. ~200 lines could be consolidated into a parameterized generic helper. Low urgency — correctness is unaffected. | `electron/services/payroll/statutoryRates.ts` |
| L6 | 2026-06-30 | `Architecture.md` is partially stale | (a) Tech stack table still lists Zustand (explicitly decided not to add). (b) Folder structure shows `devices/fingerprint-bridge.ts` which does not exist. (c) Phased plan does not reflect Phases 1–6 as complete. | `Architecture.md` |
| L7 | 2026-06-30 | No pagination on list queries — unbounded result sets | `listAttendanceLogs`, `listEmployees`, etc. return all rows. The `Table` component renders all of them in the DOM. Fine at current SME scale; will cause visible lag with 12+ months of data for 50+ employees. | All `list*` service functions, `src/shared/components/Table/` |
| L8 | 2026-06-30 | No automated test suite | Zero test files in the repository. `calculationEngine.ts` is a pure function that would be trivially unit-testable. The alternation validator and monthly summary aggregator are good integration test candidates. Without tests, regressions in payroll calculations will only be caught manually. | Entire codebase — suggest starting with `electron/services/payroll/calculationEngine.ts` |

---

## In Progress

| # | Started | Title | Who / Notes |
|---|---------|-------|-------------|
| — | — | *(nothing in progress)* | — |

---

## Resolved

| # | Resolved | Title | Fix Summary |
|---|----------|-------|-------------|
| C1 | 2026-06-30 | Empty rate table finalization guard | Added `checkRateTablesForRun()` in `statutoryRates.ts`; `finalizePayrollRun` calls it and throws if any table is empty; `payroll:runs:checkRateTables` IPC channel exposed; `PayrollRunPage.tsx` shows warning banner for draft runs with empty tables. |
| C2 | 2026-06-30 | PCB hardcoded to 'single'/0 children | Migration `0005_pcb_profile.sql` adds `pcb_category` + `pcb_children_count` to `salary_structures`; `SalaryStructure` type and Zod schemas updated; `salaryStructure.ts` INSERT/UPDATE includes new columns; `payrollRun.ts:202` now uses `structure.pcb_category`/`structure.pcb_children_count`; `SalaryStructureForm.tsx` has PCB Category select + Dependants input. |
| H1 | 2026-06-30 | `attendance:getMonthlySummary` handler not registered | Not a bug — handler is registered in `electron/ipc/payroll.ts:34` (payroll is the consumer, correct placement). |
| H2 | 2026-06-30 | `PayrollSettings` type missing `device_ip`/`device_port` | Added `device_ip: string \| null` and `device_port: number` to `PayrollSettings` in `entities.ts`. |
| H3 | 2026-06-30 | No UNIQUE constraint on `attendance_logs` | Migration `0006_attendance_unique.sql` adds `CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_unique ON attendance_logs(employee_id, timestamp, type)`. |
| H4 | 2026-06-30 | ZKTeco `user_id` not validated against employees | `syncFromDeviceEthernet` now checks each `log.employeeId` against the employees table before inserting; unknown IDs are counted as skipped with an error message. |

---

## How to Add a New Issue

Copy this row template into the appropriate priority section under Open Issues:

```
| ?? | YYYY-MM-DD | Short title | One or two sentences: what is wrong, what goes wrong when it fires, why it matters. | `path/to/file.ts:line` |
```

Rules:
- Use actual file paths and line numbers when known — vague entries are hard to action
- **Critical** = wrong money or data loss. When in doubt, use **High** instead of **Critical**
- One row per distinct problem — do not bundle unrelated issues
- If you fix something from this list as a side-effect of another change, move it to Resolved with the date and a one-line summary of what changed
