# Future Enhancements — Phase C & D

## Phase C: Attendance Module Enhancements

**Status:** Planned, approved by client  
**Priority:** High (enables Phase 3 hardware testing + Phase 4 payroll realism)  
**Estimated effort:** 5–6 hours

### C1. Leave Management

**What it does:**
- Employee can take Annual Leave (10 days/year), Sick Leave (3 days), Unpaid Leave
- Admin marks date ranges as leave in calendar UI
- Payroll engine skips those dates when calculating attendance summary (hours worked = 0 for leave days)
- Leave balance tracking (remaining days, historical usage)

**Implementation:**
- New table: `employee_leave_entitlements` (employee_id, leave_type, balance, year)
- New table: `leave_records` (employee_id, date_from, date_to, type, status: 'pending'/'approved'/'rejected')
- Service: `createLeaveRequest`, `approveLeave`, `getEmployeeLeaveBalance`
- UI: Calendar view in Attendance module, "Request Leave" form, admin approval panel
- Payroll integration: `getMonthlyAttendanceSummary` checks leave records, excludes leave days from hours calculation

**Why now:**  
Without leave logic, payroll will incorrectly count unpaid leave days as "worked" (0 hours → 0 pay is correct, but records should show reason). Also, Phase 3 testing will hit this gap (employee takes leave, how does V1000 handle it?).

---

### C2. Shift Settings Per Employee

**What it does:**
- Define shifts: Morning (08:00–12:00, 13:00–17:00), Afternoon (12:00–17:30), Night (19:00–06:00), etc.
- Assign shift to employee (or use default)
- Clock-in/out validation: enforce expected times per shift (e.g., alert if morning-shift employee clocks in at 13:15)
- Payroll: uses shift hours to compute OT (any hours beyond shift = OT)

**Implementation:**
- New table: `shifts` (id, name, start_time, end_time, standard_hours)
- Add `shift_id` to `employees` (nullable; null = standard 9–5)
- Add `shift_id` to `attendance_logs` (snapshot shift at time of punch, for audit trail)
- Service: `validateClockAgainstShift`, returns `{ onTime: bool, alertMessage?: string }`
- UI: Employee form gets "Assigned Shift" select; Attendance list flags punches outside shift times
- Payroll: uses employee's shift_hours (from shifts table) instead of hardcoded 8h

**Why now:**  
SME may have multiple shifts (factory floor, retail). Without this, payroll OT logic assumes everyone works 8h/day — incorrect for 10h shifts or rotating shifts.

---

### C3. Late/Early Arrival Detection

**What it does:**
- Define grace period (e.g., clock-in up to 08:30 = on-time; after = late)
- Flag attendance logs as "on-time", "late (15 min)", "absent"
- Admin can see late report (who was late, how often)
- Optional: payroll deduction for lateness (statutory rule in some countries)

**Implementation:**
- New column: `attendance_logs.status` CHECK ('on-time', 'late', 'absent', 'excused-late')
- Service: `validateAttendanceStatus(employeeId, clockInTime, shiftId)` → status + minutes_late
- UI: AttendanceListPage shows status badge (green "on-time", yellow "late", red "absent")
- Reporting: Late Report page (month view, sorted by frequency)
- Payroll: optional deduction rule in `payroll_settings` (`deduct_for_lateness: bool`)

**Why now:**  
Payroll relies on attendance summaries; without knowing who was late, can't enforce attendance policies. V1000 device will naturally produce "late" clocks (employee scans at 8:35); app must track this.

---

### C4. Attendance Summary Report (Monthly Calendar)

**What it does:**
- Calendar view: month grid, each day shows employee's punches (In time, Out time, status)
- Filter by employee or department
- Export to Excel (date, employee, shift, clock-in, clock-out, hours-worked, status)
- Used by HR for monthly audit before payroll run

**Implementation:**
- UI: `AttendanceSummaryPage.tsx` — calendar grid component, date click → detail modal
- Service: `getMonthlyAttendanceSummary(employeeId, year, month)` → aggregated hours, days worked, late count
- Export: use existing Excel library (or add `exceljs`), write calendar grid to sheet
- No DB changes (data already exists in `attendance_logs`)

**Why now:**  
Phase 4 payroll already has `getMonthlyAttendanceSummary` stubbed; this UI makes it usable. Admin needs to verify data before payroll finalization.

---

## Phase D: Quick Wins (High ROI, Low Effort)

**Status:** Planned, approved by client  
**Priority:** Medium–High (UX polish, operational necessity)  
**Estimated effort:** 2–3 hours each

### D1. Settings Page (Company Profile)

**What it does:**
- Admin enters company name, SST/BRN number, bank account (for salary transfers)
- Used by payslip PDF (company header), invoices (tax ID), bank export files
- Singleton settings table (similar to `payroll_settings`)

**Implementation:**
- New table: `company_settings` (id=1, company_name, brn_number, sst_number, bank_account_name, bank_account_number)
- New IPC handler: `settings:getCompany`, `settings:updateCompany`
- New UI page: `src/shared/components/SettingsPage.tsx` — form with text inputs, save button
- Preload: `window.api.settings.getCompany()`, `window.api.settings.updateCompany(data)`
- Payroll integration: `generatePayslip` reads company name from settings, includes in PDF header

**Why now:**  
Phase 4 payslips hardcode company info; make it configurable so client doesn't need code edits.

---

### D2. Dark Mode Toggle

**What it does:**
- Prefer switch in top navbar or settings
- Toggles Tailwind's dark mode class on root element
- Preference persists in localStorage (or settings table)
- All components respect `dark:` CSS classes (already in Tailwind, just need media query activation)

**Implementation:**
- Add `darkMode: true/false` to company_settings (D1)
- Top navbar (AppShell) gets toggle button: `<button onClick={() => toggleDark()}>🌙</button>`
- Toggle updates localStorage + setting
- Root `<html className={isDark ? 'dark' : ''}>` (Tailwind's convention)
- All existing components already have `dark:` utilities (per design system)

**Why now:**  
Low effort, high perceived polish. SME users appreciate dark mode for evening shifts / long hours.

---

### D3. Data Export (Employees, Payroll, Attendance to Excel)

**What it does:**
- "Export" button on each list page (Employees, Payroll Runs, Attendance)
- Generates `.xlsx` file, downloads to Downloads folder
- Employees: name, code, department, salary structure
- Payroll: payslip summary (employee, gross, deductions, net, status)
- Attendance: date, employee, in-time, out-time, hours, late status

**Implementation:**
- Add `exceljs` npm dependency (~15 KB)
- Service: `exportEmployeesToExcel(db)` → writes to temp file, returns path
- Service: `exportPayrollToExcel(runId, db)` → payroll_run_items + employee names
- Service: `exportAttendanceToExcel(dateFrom, dateTo, db)` → filtered attendance logs
- IPC handlers: `export:employees`, `export:payroll`, `export:attendance`
- UI: Add "Export" button to list page headers, click triggers download
- Preload: `window.api.export.employees()` → returns `{ filePath }`; Electron opens file

**Why now:**  
SMEs love Excel; makes data portable for external audit / compliance checks. No extra DB work.

---

### D4. Print Payslip (Direct from Browser)

**What it does:**
- Payroll Run detail page: instead of "Download PDF" (external tool), add "Print" button
- Browser print dialog opens with payslip CSS already formatted
- User can print to printer or "Print to PDF"

**Implementation:**
- Payslip PDF generation already exists (`payslipPdf.ts`); keep that for email/archive
- Add new route: `PayrollRunPage` gets "Print Payslip" button per employee
- Click → `window.print()` with payslip HTML injected into a hidden iframe
- CSS: `@media print { ... }` hides navbar, shows full payslip, uses small margins
- Browser handles Print dialog (Ctrl+P standard)

**Why now:**  
If printer not available, users can still see payslip on screen and save as PDF manually. No server-side work.

---

## Dependency Matrix

**Phase C depends on:**
- Phase 2: Attendance module (base)
- Phase 4: Payroll (for leave-aware summary calculation)

**Phase D depends on:**
- Phase 4: Payroll (D1–D4 reference payroll data)
- Phase 1: Master Data (D3 exports employees)
- No new migrations (all D tasks use existing tables + localStorage/settings)

---

## Recommendation: Build Order

1. **Phase C1 (Leave)** → Phase C2 (Shifts) → Phase C3 (Late Detection) → Phase C4 (Summary Report)  
   *Rationale:* Leave blocks other attendance enhancements; shifts enable proper OT calc; late detection uses shift times; calendar is final summary.*

2. **Phase D1 (Settings)** → Phase D2 (Dark Mode) → Phase D3 (Exports) → Phase D4 (Print)  
   *Rationale:* Settings feeds payslips (D4); dark mode is quick polish; exports need zero dependencies.*

**Ideal timeline:**
- Phase C: 2 work sessions (~10–12 hours total)
- Phase D: 1–2 work sessions (~6–8 hours total)
- Combined with Phase 3 hardware testing when ZKTeco device arrives = realistic next 2 weeks of work

---

## When to Start

- **Phase C:** After Phase 3 is verified (ZKTeco device tested)
- **Phase D:** Can start anytime after Phase 4; no blockers
- **Parallel work:** Phase D1 (Settings) could run in parallel with Phase 3 testing (independent)

---

**Last updated:** 2026-06-29  
**Author:** Claude Code (EZOffice architect)
