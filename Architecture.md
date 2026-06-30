# EZOffice — Architecture: Attendance + Payroll + ERP (React + Electron)

## 0. Overview

**EZOffice** is a fully standalone, offline-first desktop application combining three modules: Attendance (fingerprint-based), Payroll, and a basic ERP (Invoice, Purchase Order, Delivery Order). It is self-contained — its own codebase, its own database, no dependency on any other software.

## 1. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| UI | React + TypeScript + Vite | Fast iteration, agent-friendly |
| Wrapper | Electron | Offline desktop, hardware access (USB/serial/TCP) |
| Local DB | SQLite (`better-sqlite3`) | Single local file, no server, no concurrency concerns |
| State (renderer) | Zustand / React Query | Local data via IPC only |
| IPC | `contextBridge` + `ipcMain`/`ipcRenderer` | Renderer never touches DB or hardware directly |
| PDF (payslip/invoice) | `pdfmake` or `pdf-lib` | Generates payslips and invoices as PDF |
| Packaging | `electron-builder` | Standalone installer, auto-update support |

## 2. High-Level Architecture

```
┌──────────────────────────┐
│  Renderer (React UI)     │
│  - Attendance views      │
│  - Payroll views         │
│  - ERP (Invoice/PO/DO)   │
└──────────────┬────────────┘
               │ IPC
┌──────────────▼────────────┐
│  Main Process (Node)      │
│  - SQLite DB access       │
│  - Hardware comms          │
│  - Business logic          │
└──────────────┬────────────┘
               │
               ▼
   ┌───────────────────────┐
   │  Fingerprint device    │
   │  (SDK / TCP / USB poll)│
   └───────────────────────┘
```

**Key principle:** Renderer is UI only. All sensitive logic — DB writes, statutory calculations, hardware comms — lives in the Main process. This keeps the renderer easy to treat as untrusted (like a regular web page) and makes each module easy for an agent to build/test in isolation.

## 3. Module Breakdown

- **Core/Master Data** — Employee, Customer, Supplier, Product/Item, Department
- **Attendance** — fingerprint enrollment, clock-in/out logs, leave (optional)
- **Payroll** — salary structure (per-employee daily/hourly rate + OT rule), per-employee EPF/SOCSO/EIS opt-in flags, EPF/SOCSO/EIS/PCB calculation, salary advances/loans, payslip, payroll run history
- **ERP** — Invoice, Purchase Order (PO), Delivery Order (DO), Stock/Inventory

All modules share the same master data tables (one source of truth for Employee/Customer/Supplier/Product within this app).

## 4. Data Flow

### A. Attendance → Payroll

1. Enroll fingerprint template once → link to `employee_id` (via device SDK)
2. Each clock-in/out → write to `attendance_logs` (employee_id, timestamp, type IN/OUT, device_id)
3. End of payroll cycle (monthly): payroll engine aggregates `attendance_logs` → computes hours worked per day per employee. This feeds the hourly-rate calculation directly — lateness or a partial day naturally means fewer hours and less pay, there is no separate lateness-penalty step.
4. Payroll engine reads Salary Structure (per-employee daily/hourly rate + OT rule) + attendance summary → calculates, per employee:
   - Gross pay (regular hours + OT hours, at that employee's own rate)
   - EPF/SOCSO/EIS (employee + employer portion) — skipped entirely for an employee if their `subject_to_epf` / `subject_to_socso` / `subject_to_eis` flag is `false`
   - PCB (monthly tax deduction, via PCB Schedule lookup)
   - Salary advance/loan deduction — if the employee has an active advance, deduct per that advance's own repayment terms until settled
   - Net pay
5. Generates Payslip (PDF) + Payroll Summary Report
6. (Optional) Export bank file format for GIRO/IBG submission

### B. ERP Flow (PO → DO → Invoice)

1. **PO** created when purchasing stock from a Supplier → status: Draft → Sent → Received
2. Goods received → updates Inventory/Stock quantity
3. **DO** created when fulfilling a customer order → deducts stock, references Invoice/Sales Order
4. **Invoice** generated from DO (deliver-then-bill) or standalone (cash sale) → SST toggle, auto-incrementing numbering
5. All documents reference the same Customer/Supplier/Product master data

## 5. User Flow (who does what, and when)

Worth separating by **role** and **frequency** — regular employees and the admin/owner have very different experiences with this app.

**One-time Setup (Admin/Owner)**
1. Install app, enter license key
2. Enter company info (name, SST/LHDN number for invoicing)
3. Set up Employees — name, position, salary structure (basic, allowances), or bulk import via CSV
4. Enroll each employee's fingerprint on the device
5. Set up Customer/Supplier/Product (manual entry or CSV import)

**Daily (Employees — never open the app)**
- Employees only **touch the fingerprint scanner** when clocking in/out. No login, no app interaction required.
- Logs are written automatically to `attendance_logs`. Admin can check live if needed, but it's not a daily requirement.

**As-needed (Admin/Cashier — whenever a transaction happens)**
- Ordering stock from a supplier → open ERP module, create a **PO**
- Stock arrives → mark PO as "Received" → stock updates automatically
- Delivering goods to a customer → create a **DO**, select products/quantities → stock deducts automatically
- Need an invoice (cash sale or from a fulfilled DO) → create an **Invoice**, auto-numbered, SST toggle as needed

**Monthly (Admin/HR — payroll cycle)**
1. Open Payroll module, select the month
2. System shows attendance summary per employee (work days, lateness, OT) — admin can **manually review/adjust** for edge cases (forgot to punch, unrecorded leave, etc.)
3. Click "Run Payroll" → system auto-calculates EPF/SOCSO/EIS/PCB based on each employee's salary structure
4. Review draft payslips for all employees in a summary table
5. Approve/Finalize → generates payslip PDFs per employee (printable or exportable for WhatsApp/email)
6. (Optional) Export bank submission file and statutory forms (EPF/SOCSO)

**Key takeaway:** regular employees never see the software at all — their only interaction is the fingerprint scanner. The admin/owner is the sole app user, and spends most time in the Payroll module (monthly) vs. ERP (more frequent, transaction-driven).

## 6. Fingerprint Hardware Integration — Options

Confirm the target device model before locking in an approach — this is the single biggest unknown affecting the whole build.

**Option A — Vendor SDK (ZKTeco, FingerTec, Suprema)**
Many devices expose a local TCP/HTTP API or a native SDK (DLL/C++).
- If the device supports a push/pull protocol (e.g. ZKTeco PUSH SDK) → communicate directly via Node's `net` module
- If the SDK is only available as a DLL → wrap it via a native Node addon (`node-ffi-napi`) — more effort

**Option B — Generic USB reader**
Use `node-hid`, but fingerprint matching algorithms are usually still vendor-locked — rarely worth building from scratch.

**Option C — Pragmatic shortcut (recommended for MVP)**
Off-the-shelf attendance machines (TIMI, FingerTec) store logs on-device and allow pulling data via TCP/IP polling or USB export. Architecture becomes:
> App polls the device periodically (e.g. every X minutes) → pulls new logs → writes to `attendance_logs`

This avoids reinventing fingerprint enrollment/matching — the device already handles that; the app is just a consumer of its log data.

## 7. Folder Structure (agent-friendly)

```
/electron
  main.ts                 # entry point
  preload.ts              # contextBridge exposed APIs
  ipc/
    attendance.ts
    payroll.ts
    erp.ts
  devices/
    fingerprint-bridge.ts
  db/
    schema.sql
    migrations/

/src                       # React renderer
  modules/
    attendance/
    payroll/
    erp/
      invoice/
      po/
      do/
  shared/
    components/
    hooks/

CLAUDE.md                  # context file for agentic dev
```

## 8. Phased Build Plan

| Phase | Scope | Notes |
|---|---|---|
| 1 | Scaffold Electron + React, set up SQLite DB and schema, build master data CRUD + CSV import | Foundation — one agent working session |
| 2 | Attendance module — manual clock in/out UI first (no hardware) | Validate logic before adding device complexity |
| 3 | Integrate fingerprint device (choose Option A/B/C above) | Isolated from other modules — easy to swap later if device choice changes. Project owner has sequenced this **last in practice** (after Phase 4 and likely Phase 5), since it's the only phase blocked on hardware choice/procurement — Phase 2's manual attendance entry already covers the data needs of Phase 4 |
| 4 | Payroll engine — salary structure, statutory tables, payslip generation | No dependency on Phase 3 — runs entirely off `attendance_logs` regardless of `source` ('manual' or 'device'), so it does not need to wait for fingerprint integration |
| 5 | ERP — PO → Stock table → DO → Invoice, in that dependency order | Don't build Invoice before stock logic is solid |
| 6 | Reports, LHDN e-invoice compliance layer, packaging (`electron-builder`) | Last — once core flows are stable |

Each phase is sized to be one agent working session. Keep `CLAUDE.md` updated progressively with finalized schema decisions and naming conventions so context isn't lost between sessions.

---

**Open question before starting Phase 1:** confirm the target fingerprint device model — this determines which option in section 6 to build toward.