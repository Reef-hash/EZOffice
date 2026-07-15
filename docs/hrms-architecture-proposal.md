# EZOffice HRMS Architecture Proposal

> **RFC-001 | 2026-07-10**  
> **Status:** PROPOSAL — for review and approval before implementation  
> **Author:** Lead Software Architect  
> **Context:** Building a complete HR & Payroll platform on top of the existing Attendance module  
> **Source of truth:** `docs/attendance-current-architecture.md` (do not contradict)

---

## Executive Summary

The current EZOffice attendance system records raw punch events (`attendance_logs`) and computes payroll hours on-the-fly via `getMonthlyAttendanceSummary()`. This is correct for a single-use, single-month scenario but introduces three architectural problems:

1. **No immutability**: Raw logs can be edited after payroll is finalized, silently changing financial results.
2. **No audit trail**: If payroll says Ali worked 160 hours, there is no persisted record of *why* — the calculation is re-derived each time from raw logs.
3. **No calendar awareness**: The system has no concept of public holidays, weekly offs, or company holidays. Every day is treated as a working day unless the employee has approved leave.

**This proposal introduces an Attendance Processing Engine** that sits between raw logs and payroll, producing immutable Daily Attendance Records. Payroll will never read `attendance_logs` directly again.

---

## 1. Current Architecture Review

### 1.1 The Problem

```
CURRENT STATE:

attendance_logs (raw punches)
        │
        │  getMonthlyAttendanceSummary()
        │  (re-derived every time)
        ▼
   Payroll Engine

PROBLEMS:
- Raw logs mutable → payroll results unstable
- Calendar-blind → public holidays treated as absent
- No weekly-off awareness → Saturday/Sunday expected to have punches
- Pairing algorithm differs between getMonthlyCalendar and aggregateDailyHours
- No concept of "this attendance data is locked for period X"
```

### 1.2 What's Already Done (and Should Stay)

| Module | Status | Decision |
|--------|--------|----------|
| `attendance_logs` table | Perfect as-is | **NEVER modify** — this is the immutable event source |
| Device sync pipeline (`syncFromDeviceEthernet`) | Battle-tested | **NEVER modify** — the processing engine sits downstream |
| Alternation validation (`assertAlternation`) | Fixed 2026-07-15 | The **invariant** (strict IN→OUT→IN alternation) must never be relaxed — the processing engine still assumes it holds. But the original implementation checked new punches against `getLastLogForEmployee()` (globally most recent punch) instead of the punch actually adjacent to the new entry's own timestamp, which made backfilling earlier dates impossible once later data existed (device sync or prior manual entries). Fixed to check timestamp-relative neighbors instead — see CLAUDE.md decision log. Do not revert to global-last-punch comparison. |
| `shifts` table | Complete | Keep as-is; extend with `break_duration` and `break_start_time` later |
| `leave_records` / `employee_leave_entitlements` | Complete | Keep as-is; extend with `half_day` flag and `paid` flag later |
| `clockIn()` / `clockOut()` | Stable | Keep as-is; the processing engine reads their output, not replaces it |
| IPC + preload pattern | Proven | Follow the same pattern for new modules, don't refactor |
| `employees` table | Stable | Add `calendar_profile_id` (nullable FK); do not touch existing columns |

### 1.3 What Must Change

| Current | Problem | Proposed |
|---------|---------|----------|
| `getMonthlyAttendanceSummary()` reads raw logs directly | Payroll depends on mutable data | Replace with `processAttendancePeriod()` that writes immutable Daily Records |
| No calendar awareness | Every day is a working day | Introduce Company Calendar as the foundational layer |
| Calendar months only | Real payroll cycles don't align with calendar months (26 Jun – 25 Jul) | Introduce Payroll Periods |
| `getMonthlyCalendar()` and `aggregateDailyHours()` use different algorithms | Same data, different results depending on which function you call | Standardize on one processing algorithm in the engine |
| `attendanceExceptions` computed on-demand | Anomaly detection is manual and inconsistent | Absorb into the processing pipeline: validate stage |
| No attendance locking | Logs editable after payroll finalized | Finalization flag + payroll period locking |

---

## 2. Identified Gaps

| Gap | Severity | Why it matters |
|-----|----------|---------------|
| **No Company Calendar** | Critical | Without it, public holidays are "absent" and weekends require punches. Every downstream calculation is wrong by default. |
| **No Weekly Off** | Critical | Employees shouldn't be expected to clock in on weekends. Currently, Saturday/Sunday = absent unless they punch. |
| **No Public Holiday** | High | Holiday pay rates differ from regular pay. Governments mandate specific holiday treatment. |
| **No Company Holiday** | Medium | Company-declared holidays (anniversary, declared rest days). |
| **No Payroll Period** | High | Real payroll cycles are 26th-25th, not 1st-31st. Attendance must be assigned to the correct period. |
| **No Processing Layer** | Critical | Raw logs → payroll directly. No intermediate, immutable, auditable layer. |
| **No Daily Attendance Records** | Critical | Every query re-derives from raw logs. No persisted, stable view of "Ali's attendance on July 5." |
| **No Attendance Finalization** | High | Once admins verify attendance for a period, it should be locked. |
| **No Payroll Locking** | High | Payroll finalized period N shouldn't allow editing attendance in period N. |
| **No Half-Day Leave** | Medium | Can't track half-day leave. Balance decrements by full days only. |
| **No Break Tracking** | Medium | Lunch breaks aren't semantically labeled. Actual hours worked is overcounted. |
| **No Early-Out Detection** | Medium | Only late arrival is tracked. Early departure is invisible. |
| **No Attendance Audit Trail** | Medium | Who edited Ali's log on July 5? No record. |

---

## 3. Proposed Architecture

### 3.1 High-Level Data Flow

```
                    ┌─────────────────────────────────────────┐
                    │         IMMUTABLE EVENT SOURCE           │
                    │                                         │
                    │  attendance_logs (NEVER MODIFIED)        │
                    │  device_sync → raw punches               │
                    │  clockIn/clockOut → manual punches       │
                    │  createManualLog → admin backfill        │
                    └──────────────────┬──────────────────────┘
                                       │
                                       │  READ ONLY
                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                  ATTENDANCE PROCESSING ENGINE                     │
│                                                                  │
│  Inputs:                                                         │
│    • attendance_logs (raw punches)                               │
│    • company_calendar (what kind of day is this?)                │
│    • employee_calendar_profile (per-employee weekly off pattern) │
│    • shifts (start/end times, standard hours, break duration)    │
│    • leave_records (approved leave)                              │
│    • payroll_periods (date range boundaries)                     │
│                                                                  │
│  Processing pipeline:  (see §7 for detail)                       │
│    Normalize → Validate → Pair → Hours → Calendar → Leave →     │
│    Holiday → Status → Daily Record                               │
│                                                                  │
│  Output:                                                         │
│    daily_attendance_records (one row per employee per day)       │
│    attendance_exceptions (anomalies detected during processing)  │
│    processing_run (audit trail of when/how records were created) │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   │  READ ONLY (payroll never reads attendance_logs)
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                        PAYROLL ENGINE                            │
│                                                                  │
│  Input: daily_attendance_records (joined with salary_structure)  │
│  Output: payroll_run_items → payslip                             │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Processing Engine: Yes or No?

The proposal introduces an explicit processing layer. Let me evaluate both approaches.

#### Option A: No Processing Engine (current approach — on-the-fly computation)

```
attendance_logs → payroll calculation (compute hours each time)
```

**Advantages:**
- No extra storage
- No "stale data" problem (always uses latest logs)
- Simpler codebase (fewer files, fewer tables)

**Disadvantages:**
- Payroll result depends on the *current* state of raw logs, not the state at processing time
- If an admin edits a log from June after July payroll is finalized, re-running the July payroll query produces different numbers — **silent data corruption**
- Every report re-derives the same calculation independently → different reports can show different numbers if logs changed between runs
- No audit trail: "Why was Ali paid these hours?" → you must re-derive from current logs, not the logs as they were
- Performance degrades as punch count grows (every payroll run scans all raw logs)
- Business rule changes affect historical results retroactively (e.g., changing standard_hours from 8 to 7.5 changes all past payroll results)

#### Option B: Processing Engine (proposed)

```
attendance_logs → processing engine → daily_attendance_records → payroll
```

**Advantages:**
- **Immutability**: Daily Records are snapshotted. Payroll always reads the same data regardless of subsequent raw-log edits.
- **Auditability**: The processing run ID links payroll results to a specific processing batch. "Why was Ali paid X?" → open the Daily Record → see the resolved status, hours breakdown, and which processing run created it.
- **Performance**: Payroll reads 30 rows per employee per month (one per day) instead of scanning all punch events.
- **Consistency**: All downstream modules (payroll, reports, payslip, dashboard) read from the same Daily Records table.
- **Reprocessing**: Fix a bug in the processing engine → re-run processing for a period → compare old vs new Daily Records → approve the change before payroll sees it.
- **Business rule versioning**: Processing runs store which version of the engine was used. Historical records reflect the rules at the time of processing.

**Disadvantages:**
- Extra storage (negligible: ~30 rows/employee/month)
- Requires explicit "Process Attendance" step (admin action)
- If raw logs change after processing, admin must reprocess (which is a *feature*, not a bug — it catches the edit)
- More code complexity

**Verdict: Option B (Processing Engine) is the correct architecture for a payroll system.**

The deciding factor is financial integrity. The cost of a silent payroll error (wrong pay) far exceeds the cost of an extra processing step. This is not a subjective design preference — it's a non-negotiable for any system that calculates pay.

---

## 4. Company Calendar Architecture

### 4.1 Conceptual Model

The calendar is a **layered resolution system**, not a single table. Different layers carry different priority.

```
Layer 4 (highest):  Emergency Closure     ← overrides everything
Layer 3:            Approved Leave        ← employee-specific
Layer 2:            Special Working Day   ← intentional override
Layer 1:            Public Holiday        ← national mandate
Layer 0 (lowest):   Company Calendar Profile ← default working pattern
```

### 4.2 Entities

| Entity | Purpose | Ownership | Example |
|--------|---------|-----------|---------|
| **Company Calendar Profile** | Defines the default working week (which days are working days vs weekly off) | Company-wide (singleton) | Mon–Fri working, Sat–Sun weekly off |
| **Calendar Event** | A date-specific exception to the default profile | Company-wide | 31 Aug 2026 = Public Holiday (Merdeka) |
| **Recurring Calendar Event** | A rule-based recurring exception | Company-wide | Every 1st May = Public Holiday (Labour Day) |
| **Employee Calendar Profile** | Overrides the company profile for specific employees | Per-employee | Part-time worker: Mon–Wed working, Thu–Sun weekly off |
| **Calendar Event Type** | Classification of what a calendar event *means* | System-defined | See §4.3 |
| **Holiday Resolution** | The final resolved classification for a specific employee×date | Generated by processing engine | 31 Aug 2026, Ali = Public Holiday |

### 4.3 Calendar Event Types

| Type | Priority | Affects Pay? | Affects Attendance? | Notes |
|------|----------|-------------|---------------------|-------|
| **Working Day** | Default | Regular pay | Expects punches | The baseline; not stored, assumed unless overridden |
| **Weekly Off** | 0 | No pay (or OT if worked) | No punches expected | Defined in Company Calendar Profile |
| **Public Holiday** | 1 | Holiday pay rate | No punches expected unless special working day | Government-declared; stored as Calendar Event |
| **Company Holiday** | 1 | Holiday pay or regular (configurable) | No punches expected | Company-declared; e.g., company anniversary |
| **Special Working Day** | 2 | Regular pay (or replacement holiday) | Expects punches | A holiday/weekly off that the company decides to work on |
| **Half Day** | *Floating* | Pro-rated | Half-day punches expected | Applies alongside the resolved base type (e.g., "Friday Half Day + Working Day") |
| **Emergency Closure** | 4 | Configurable (full pay, partial, none) | No punches possible | Unexpected closure (flood, power outage, pandemic) |
| **Company Event** | *Informational* | Regular pay | Expects punches (unless excused) | Team building, annual dinner — not a day off |

### 4.4 How It Resolves

For a given employee and date, the processing engine asks:

1. Is there an Emergency Closure on this date? → YES → day = emergency_closure. STOP.
2. Does the employee have approved leave on this date? → YES → day = on_leave. STOP.
3. Is there a Special Working Day event on this date? → YES → day = working_day. PROCEED to punch evaluation.
4. Is there a Public Holiday on this date? → YES → day = public_holiday. STOP.
5. Is there a Company Holiday on this date? → YES → day = company_holiday. STOP.
6. Is there a Half Day override on this date? → YES → flag half_day = true. (Don't stop — continue to check base type.)
7. What is the employee's calendar profile for this day of the week? → Weekly Off / Working Day.
8. Is it a Company Event? → YES → day = working_day (event is informational). PROCEED to punch evaluation.

### 4.5 Ownership & Inheritance

```
Company Calendar Profile (singleton)
    │
    │  "Default working pattern for ALL employees"
    │
    ├── Calendar Events (company-wide exceptions)
    │   └── Public Holidays, Company Holidays, Special Working Days, Emergency Closures
    │
    └── Employee Calendar Profile (optional override)
        └── "This specific employee has a different working week"
```

- If no Employee Calendar Profile exists → inherit the Company profile
- Calendar Events apply to ALL employees regardless of their profile
- Employee Calendar Profile only affects the default working pattern, not holidays

### 4.6 Extensibility

The calendar event type enum can grow without breaking existing types. Adding a new type (e.g., "Optional Working Day") requires only:
1. Add the enum value
2. Define its position in the priority chain
3. Define how the processing engine should handle it (expects punches? affects pay?)

This is intentionally simple — the priority is resolved in code, not in the database, because the rules are business logic and must be versioned with the processing engine.

---

## 5. Payroll Period Architecture

### 5.1 Concept

A payroll period is a named date range that groups Daily Attendance Records for payroll calculation.

```
Example periods:
  Period "2026-07" → 2026-06-26 to 2026-07-25
  Period "2026-08" → 2026-07-26 to 2026-08-25

Each Daily Record is "in" the period where record.date falls between period.start_date and period.end_date.
```

### 5.2 Entity

| Property | Purpose |
|----------|---------|
| `name` | Human-readable (e.g., "July 2026 Payroll") |
| `start_date` | First date in the period (inclusive) |
| `end_date` | Last date in the period (inclusive) |
| `status` | `open` → `processing` → `finalized` → `closed` |
| `processed_at` | When the processing engine last ran for this period |
| `finalized_at` | When the period was locked |
| `finalized_by` | Admin who locked it |

### 5.3 Lifecycle

```
OPEN           Admin creates the period, attendance being collected
   │
   ▼
PROCESSING     Admin runs the processing engine; Daily Records generated
   │
   ▼
REVIEW         Admin verifies Daily Records, resolves exceptions
   │
   ▼
FINALIZED      Payroll run completed; Daily Records locked; raw logs still editable
   │           (editing raw logs after finalization triggers a "needs reprocessing" flag)
   ▼
CLOSED         Period archived; all related data immutable; raw logs also locked
```

### 5.4 Immutability Guarantee

- When a period is **FINALIZED**: `daily_attendance_records` within the period date range become immutable (application-enforced: update/delete rejected with "period finalized" error)
- When a period is **CLOSED**: `attendance_logs` within the period date range also become immutable
- Historical payroll results reference the specific `processing_run_id` that produced them — re-running payroll always uses the same Daily Records

### 5.5 Overlapping Periods

Payroll periods do NOT overlap. The system enforces `CHECK(start_date < end_date)` and application-level validation that no two periods share dates. This is necessary because a Daily Record can only belong to one payroll period.

---

## 6. Daily Attendance Record Architecture

### 6.1 Purpose

The Daily Attendance Record is the **single source of truth for "what happened on this date for this employee."** Every downstream module (payroll, reports, dashboard, payslip) reads from this table. No module reads `attendance_logs` directly except the processing engine.

### 6.2 Fields

| Field | Type | Purpose | Why it exists |
|-------|------|---------|---------------|
| `id` | PK | Unique identifier | Standard |
| `employee_id` | FK → employees | Which employee | Standard |
| `date` | DATE (YYYY-MM-DD) | The calendar date | One row per employee per day |
| `payroll_period_id` | FK → payroll_periods | Which payroll period this day belongs to | Enables period-based filtering for payroll |
| `processing_run_id` | FK → processing_runs | Which processing run created this record | Full audit trail |
| `calendar_type` | ENUM | What kind of day is this? (working_day, weekly_off, public_holiday, company_holiday, half_day, special_working_day, emergency_closure, company_event) | Payroll needs to know WHY a day has a certain status — holiday pay differs from regular pay |
| `leave_type` | ENUM (nullable) | If on leave, what type? (annual, sick, unpaid) | Unpaid leave = 0 pay; annual leave = regular pay |
| `leave_record_id` | FK (nullable) → leave_records | Which approved leave request covers this day | Traceability: this day was "on_leave" because of this specific approved request |
| `leave_is_half_day` | BOOLEAN (default false) | Whether this is a half-day leave (future expansion) | Needed for half-day leave support |
| `shift_id` | FK (nullable) → shifts | Snapshot of assigned shift at processing time | Audit: what shift was the employee supposed to work? |
| `status` | ENUM | Final resolved attendance status | The single answer to "was Ali present on July 5?" |
| `first_in` | TIMESTAMP (nullable) | First IN punch of the day | Quick summary; detail in raw logs |
| `last_out` | TIMESTAMP (nullable) | Last OUT punch of the day | Quick summary |
| `session_count` | INTEGER | Number of IN→OUT pairings for this day | How many times did the employee clock in and out? (0 for leave/holiday/absent) |
| `total_clocked_hours` | REAL | Sum of all paired session hours (before break deduction) | The raw clock time from device/manual punches |
| `break_hours` | REAL | Total deducted break time across all sessions | If shift defines a break, this is subtracted from clocked hours |
| `regular_hours` | REAL | Hours paid at regular rate (≤ standard_hours) | Payroll's baseline |
| `ot_hours` | REAL | Hours paid at OT rate (> standard_hours) | Payroll's OT calculation |
| `net_work_hours` | REAL | regular_hours + ot_hours (what the employee actually worked) | Total paid work time |
| `minutes_late` | INTEGER | How many minutes past shift start the first IN was | For late deduction calculation |
| `minutes_early_out` | INTEGER | How many minutes before shift end the last OUT was | For early-out deduction |
| `is_finalized` | BOOLEAN (default false) | True when the payroll period is finalized | Once true, this row is immutable |
| `created_at` | TIMESTAMP | Record creation time | Standard |
| `updated_at` | TIMESTAMP | Last modification | Standard |

### 6.3 Attendance Status Enum

```
present          — employee clocked in and out, on time
late             — first clock-in was after shift start + grace period
excused_late     — admin excused the lateness
early_out        — last clock-out was before shift end
absent           — working day, no leave, no punches
on_leave         — employee has approved leave for this day
holiday          — public holiday or company holiday (not a working day)
weekly_off       — employee's regular weekly off day
emergency_closure — office closed (e.g., flood)
no_show          — employee clocked in but has zero worked hours (went home immediately)
```

### 6.4 What This Table Does NOT Contain

- **Raw punch-level detail**: First IN / Last OUT are summary fields. All punches are in `attendance_logs`.
- **Payroll calculations**: The payroll engine computes EPF, SOCSO, EIS, PCB, and net pay from these fields. Do not store computed statutory amounts here.
- **Employee personal data**: Name, department, salary rate — all joined at query time from `employees` and `salary_structures`.
- **Leave reason text**: The reason is in `leave_records`. Only the `leave_record_id` reference is stored.

### 6.5 Why Each Field Justifies Its Existence

| Field | Justification |
|-------|--------------|
| `calendar_type` | Payroll pays holiday hours at different rates than regular hours. Without this, payroll must re-derive calendar from the calendar tables — defeating the purpose of a processing layer. |
| `leave_type` | Unpaid leave results in $0 pay. Annual leave results in full pay. Payroll must know which. |
| `leave_record_id` | Audit: "Ali's Jan 5 was on_leave because of leave request #42 approved by Admin on Jan 2." This traceability is essential for dispute resolution. |
| `status` | The **single field** that every report queries. "How many absent days this month?" → `SELECT COUNT(*) WHERE status = 'absent'`. No complex conditional logic in reports. |
| `session_count` | A day with 4 sessions (IN-OUT-IN-OUT) might indicate a split shift or lunch break. Payroll may apply break deduction differently. |
| `total_clocked_hours` | The raw number before any business rules are applied. Preserved for debugging: "Processing says 8.5h but employee claims 9h." Compare clocked_hours to regular+OT. |
| `break_hours` | Explicitly deducts breaks. Without this, payroll overcounts hours for employees who take long lunches. |
| `regular_hours` | The baseline payroll figure. Every payroll item starts from this number. |
| `ot_hours` | Separated because OT is paid at a multiplier. Payroll reads `regular_hours × regular_rate + ot_hours × ot_rate`. |
| `minutes_late` | Late deduction amount is configurable. Storing the raw minutes allows the payroll engine to apply the deduction rule without re-examining punches. |
| `minutes_early_out` | Same reasoning as minutes_late — stores the fact for payroll consumption. |
| `is_finalized` | Application-level guard. Once `true`, update/delete on this row is rejected unless the payroll period is re-opened. |
| `processing_run_id` | Full traceability. "This Daily Record was generated by processing run #17 on 2026-07-10 at 14:30." If a processing bug is found, you can identify every affected record. |

---

## 7. Attendance Status Lifecycle (Decision Flow)

### 7.1 The Decision Tree

```
For a given (employee, date):
        │
        ▼
┌───────────────────┐
│ 1. Emergency      │──── YES ──→ STATUS = emergency_closure ──→ STOP
│    Closure?       │
└───────┬───────────┘
        │ NO
        ▼
┌───────────────────┐
│ 2. Approved Leave │──── YES ──→ STATUS = on_leave ──→ STOP
│    on this date?  │
└───────┬───────────┘
        │ NO
        ▼
┌───────────────────┐
│ 3. Is this a      │
│    Special        │──── YES ──→ Treat as working_day ──→ CONTINUE to step 6
│    Working Day?   │
└───────┬───────────┘
        │ NO
        ▼
┌───────────────────┐
│ 4. Is this a      │──── YES ──→ STATUS = holiday ──→ STOP
│    Public Holiday?│
└───────┬───────────┘
        │ NO
        ▼
┌───────────────────┐
│ 5. Is this a      │──── YES ──→ STATUS = holiday ──→ STOP
│    Company Holiday│
└───────┬───────────┘
        │ NO
        ▼
┌───────────────────┐
│  (Half Day flag   │──── YES ──→ Set half_day = true ──→ CONTINUE
│   applies here)   │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│ 6. Is this a      │──── YES ──→ STATUS = weekly_off ──→ STOP
│    Weekly Off?    │
└───────┬───────────┘
        │ NO
        ▼
┌───────────────────┐
│ 7. Is this a      │──── YES ──→ STATUS = working_day ──→ CONTINUE
│    Company Event? │              (event is informational)
└───────┬───────────┘
        │
        ▼ (working day — evaluate punches)
┌───────────────────┐
│ 8. Any IN punch?  │──── NO  ──→ STATUS = absent ──→ STOP
└───────┬───────────┘
        │ YES
        ▼
┌───────────────────┐
│ 9. First IN late? │──── YES ──→ STATUS = late ──→ CONTINUE
│  (> shift_start   │
│   + grace_period) │
└───────┬───────────┘
        │ NO / CONTINUE
        ▼
┌───────────────────┐
│10. Last OUT       │──── YES ──→ STATUS = early_out
│    early?         │              (if already late, STATUS = late_early_out
│  (< shift_end)    │               — primary status = late, early_out is secondary)
└───────┬───────────┘
        │ NO
        ▼
┌───────────────────┐
│11. Worked hours   │──── = 0 ──→ STATUS = no_show
│    > 0?           │
└───────┬───────────┘
        │ YES
        ▼
    STATUS = present
```

### 7.2 Composite Status Rules

When multiple statuses could apply (e.g., employee was late AND left early):

| Primary | Secondary | Final Status |
|---------|-----------|--------------|
| late | early_out | `late` (primary, more severe — impacts pay) |
| late | — | `late` |
| — | early_out | `early_out` |
| late | (excused) | `excused_late` |

The `minutes_late` and `minutes_early_out` fields capture both regardless — the `status` field chooses the primary label.

---

## 8. Holiday Resolution Priority

### 8.1 The Priority Chain (Highest → Lowest)

| Priority | Classifier | Reason |
|----------|-----------|--------|
| **1 (highest)** | Emergency Closure | Safety concern. Office is physically inaccessible. Overrides ALL other classifications. |
| **2** | Approved Leave | Employee was approved in advance. They should not be penalized (absent/holiday deduction) for an approved absence. |
| **3** | Special Working Day | Management intentionally decided this day is a working day despite being a holiday/weekly off. This is an explicit override. |
| **4** | Public Holiday | National mandate. Government-declared. |
| **5** | Company Holiday | Company-level decision. |
| **6 (floating)** | Half Day | Applies alongside the resolved base type regardless of what it is. |
| **7 (lowest)** | Weekly Off | Recurring pattern. The default when nothing else applies. |
| **— (informational)** | Company Event | Does not affect the day classification. It's a working day with an event overlay. |

### 8.2 Why This Order?

**Leave over Holiday**: An employee who books annual leave on a public holiday shouldn't lose a leave day AND lose the holiday benefit. If someone is on approved leave on Merdeka Day (31 Aug), the day is classified as `on_leave` and the leave balance is decremented. The company still tracks that a holiday occurred, but the employee's personal day classification is leave.

**Special Working Day over Holiday**: If the company decides to operate on a public holiday (common in retail/manufacturing), the day is treated as a working day. Employees are expected to punch. This is an explicit admin decision, not an accident.

**Emergency Closure over Everything**: If the office floods on Merdeka Day, the day is an emergency closure. Leave shouldn't be deducted (the employee was willing to work). Holiday rules are irrelevant (the office is inaccessible).

### 8.3 Interaction with Half Day

Half Day is a **modifier**, not a standalone classification. It floats alongside the resolved base type. For example:

- "Half Day + Working Day" → working_day with half_day = true. Only half the standard hours are expected.
- "Half Day + Weekly Off" → weekly_off with half_day = true. Edge case — typically not configured this way.
- "Half Day + Public Holiday" → public_holiday with half_day = true. Also unlikely, but the system handles it.

---

## 9. Processing Pipeline (Stage-by-Stage)

### 9.1 Pipeline Overview

```
  ┌─────────────┐
  │ RAW LOGS    │  attendance_logs: all punch events in the target date range
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ NORMALIZE   │  Standardize timestamps, validate data integrity
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ VALIDATE    │  Alternation check, detect anomalies, flag issues
  │             │  (absorbs current attendanceExceptions.ts logic)
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ PAIR        │  Group punches into IN→OUT sessions per employee per day
  │             │  Handle orphan punches (odd count → flag, still pair what's possible)
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ CALCULATE   │  Compute worked hours per session, apply break deductions,
  │ HOURS       │  apply max_session_hours cap
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ RESOLVE     │  For each employee×date, determine the calendar_type
  │ CALENDAR    │  from company_calendar_profile + calendar_events
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ RESOLVE     │  Overlay approved leave records onto calendar resolution
  │ LEAVE       │  (leave overrides holiday/weekly off if applicable)
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ RESOLVE     │  Apply holiday priority rules from §8
  │ HOLIDAY     │  Resolve composite scenarios (holiday + leave + weekly off)
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ RESOLVE     │  Apply the decision tree from §7
  │ STATUS      │  Determine final attendance_status, minutes_late, minutes_early_out
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ CALCULATE   │  Split worked hours into regular_hours and ot_hours
  │ FINAL HOURS │  based on calendar_type, shift standard_hours, and attendance_status
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ GENERATE    │  Write one daily_attendance_record per employee×date
  │ DAILY       │  Assign payroll_period_id
  │ RECORD      │  Link to processing_run_id
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ INDEX FOR   │  Ensure records are queryable by period
  │ PAYROLL     │  Flag unresolved anomalies → block payroll
  └─────────────┘
```

### 9.2 Stage Details

#### Stage 1: Collect Raw Logs

- Fetch all `attendance_logs` where `timestamp` falls within the target date range (±1 day margin for cross-midnight sessions, same as the M1 fix in the current code)
- Group by employee
- Include the employee's shift snapshot from the punch (`shift_id`) and the employee's current calendar profile

#### Stage 2: Normalize

- Ensure all timestamps are valid ISO 8601 naive local format
- Flag unparseable timestamps as `data_error` exceptions (these are log-level anomalies, not attendance-level — they should be investigated)
- Standardize timezone handling (all timestamps are naive local — no conversion needed)

#### Stage 3: Validate

- Check alternation: do punches strictly alternate? Flag violations.
- Check for duplicate punches: same employee, same timestamp (±60s), same type → flag.
- Check for punches with impossible timestamps (future dates, year 1970) → flag.
- This stage **absorbs** the current `attendanceExceptions.ts` anomaly detection.
- Validation failures become `attendance_exceptions` rows (the existing table is reused).

#### Stage 4: Pair Sessions

- For each employee, pair consecutive IN→OUT punches chronologically
- Handle orphan punches:
  - Orphan IN (no matching OUT): pair with `null` OUT. The session's end time is unknown. Flag as `missing_punch` exception.
  - Orphan OUT (no matching IN): discard. Cannot determine session length.
- A single day can have multiple pairs (lunch breaks, multiple shifts)

#### Stage 5: Calculate Hours

- For each paired session: `session_hours = (OUT.timestamp - IN.timestamp) / 3600000`
- Apply `max_session_hours` cap (D4 from current system): sessions exceeding the cap are flagged and excluded from paid hours
- Apply break deduction per session: if the session spans the employee's shift break time, subtract break duration
- Sum session hours per day → `total_clocked_hours`

#### Stage 6: Resolve Calendar

- For each employee×date:
  - Look up the employee's calendar profile (or fall back to company default)
  - Determine what day of the week it is → working_day or weekly_off
  - Check for calendar events on this date → public_holiday, company_holiday, special_working_day, half_day, emergency_closure, company_event
  - Store the raw classification before priority resolution (for debugging)

#### Stage 7: Resolve Leave

- Check if the employee has approved leave on this date
- If yes: `leave_type` is set, `leave_record_id` is set
- Leave takes priority over holidays (per §8), but NOT over emergency closure

#### Stage 8: Resolve Holiday

- Apply the priority chain from §8
- Determine the final `calendar_type` for this employee×date
- Examples:
  - 31 Aug (Merdeka) + no leave → `public_holiday`
  - 31 Aug (Merdeka) + approved annual leave → `on_leave` (with `calendar_type = public_holiday` preserved for reference)
  - 31 Aug (Merdeka) + Special Working Day override → `working_day`
  - Sunday + no leave → `weekly_off`
  - Sunday + Emergency Closure → `emergency_closure`

#### Stage 9: Resolve Attendance Status

- Apply the decision tree from §7
- Determine `status`, `minutes_late`, `minutes_early_out`
- Key rule: status is only evaluated for `working_day` and `special_working_day` — non-working days don't have lateness/absence concepts

#### Stage 10: Calculate Final Hours

- For `working_day` / `special_working_day` with punches:
  - `regular_hours = min(total_clocked_hours - break_hours, shift.standard_hours)`
  - `ot_hours = max(0, total_clocked_hours - break_hours - shift.standard_hours)`
- For `holiday` (public/company) with punches: (future — holiday pay rates)
  - All worked hours may be classified differently depending on company policy
- For `weekly_off` / `on_leave` / `absent` / `emergency_closure`:
  - `regular_hours = 0`, `ot_hours = 0`
- For `half_day`:
  - `regular_hours = min(..., shift.standard_hours / 2)`
  - `ot_hours` calculated against half-day threshold

#### Stage 11: Generate Daily Record

- Write one row to `daily_attendance_records` per employee×date in the target range
- Every employee gets a row for every date in the range — even `weekly_off` and `holiday` days (they have status but zero hours)
- This ensures the table is complete and queryable (`WHERE date = '2026-07-05'` returns all employees)
- Assign `payroll_period_id` based on which period's date range contains this date
- Link to `processing_run_id`

#### Stage 12: Index for Payroll

- The `daily_attendance_records` table has indexes on `(payroll_period_id, employee_id)` and `(employee_id, date)`
- Payroll queries: `SELECT * FROM daily_attendance_records WHERE payroll_period_id = ? AND employee_id = ?`
- If any `attendance_exceptions` with `status = 'open'` exist in this period → block payroll (same D5 rule, but now at the Daily Record level)

---

## 10. Payroll Integration

### 10.1 The Contract

```
PAYROLL ENGINE READS ONLY FROM:  daily_attendance_records
PAYROLL ENGINE NEVER READS:      attendance_logs (raw punches)
```

### 10.2 Why This Separation Matters

#### Before (Current)

```
Payroll reads attendance_logs directly
    │
    │  If admin edits a log from June after July payroll is finalized:
    │
    ▼
Re-running July payroll produces different numbers. No error. No warning. No audit trail.
The employee gets paid a different amount with no explanation.
```

#### After (Proposed)

```
Admin edits a log in June:

1. The system checks: "Is June's payroll period finalized?"
   ├── YES → Reject the edit. "Period is finalized. Re-open period to edit."
   └── NO → Allow the edit. Flag the Daily Record as "needs reprocessing."

2. If the Daily Record is flagged:
   - UI shows a warning: "Attendance data for June has changed since last processing."
   - Admin must re-run the processing engine before the next payroll.
   - Re-processing generates new Daily Records. Old ones are versioned (not overwritten).

3. Payroll always reads the latest finalized Daily Record for the period.
   - If the period is not finalized, payroll can't run.
   - If the period is finalized, the Daily Record is immutable.
```

### 10.3 Benefits

| Benefit | Explanation |
|---------|-------------|
| **Consistency** | All payroll items (basic pay, OT, deductions, allowances) use the same attendance snapshot |
| **Performance** | Payroll reads 30 rows/employee/month. Previously scanned all punch events (potentially hundreds) |
| **Auditability** | Every payroll run references a specific `processing_run_id`. "Why was Ali paid X?" → open the Daily Record → see every field that contributed |
| **Reproducibility** | Re-running the same payroll period always produces the same result (Daily Records are immutable after finalization) |
| **Maintainability** | Payroll code has no attendance logic. It reads `regular_hours`, `ot_hours`, `minutes_late` — simple arithmetic |
| **Safety** | Payroll bugs can't corrupt attendance data because payroll writes nothing to attendance tables |

### 10.4 Trade-Offs

| Trade-off | Acceptable? |
|-----------|-------------|
| Extra processing step before payroll | Yes — one click per pay period, negligible in practice |
| Extra storage (~30 rows/employee/month) | Yes — for 100 employees: 3,000 rows/month = ~300 KB |
| Processing takes a few seconds | Yes — runs once per pay period, not in real-time |
| If raw logs change, admin must re-process | Yes — this is the safety mechanism; catching edits is the goal |

### 10.5 Payroll-to-Attendance Reference

When a payroll run item says "Regular Hours: 160", the record links to the `processing_run_id`. From there, you can trace:
```
payroll_run_item.regular_hours = 160
    → came from daily_attendance_records WHERE payroll_period_id = X AND employee_id = Y
        → 20 rows × 8h regular_hours each
            → generated by processing_run_id #17
                → which used processing_engine_version "1.2.0"
                    → which consumed attendance_logs #1000–#1450
```

This full chain is auditable without running any query — it's in the foreign key references.

---

## 11. Module Impact Assessment

### 11.1 Modules That MUST NOT Be Modified

| Module | Reason |
|--------|--------|
| `attendance_logs` table | Immutable event source. Any change risks data integrity. |
| `syncFromDeviceEthernet()` | Battle-tested. The processing engine reads its output; does not replace it. |
| `assertAlternation()` | Protects data quality at the source — the processing engine assumes alternation is already validated. The invariant must not be weakened. The *implementation* was corrected 2026-07-15 (timestamp-relative neighbor check instead of global-last-punch) — see CLAUDE.md decision log; that fix does not violate this "must not modify" intent, it's what made the intent actually correct for backfill. |
| `clockIn()` / `clockOut()` | Interface to raw logs. These functions produce the data the processing engine consumes. |
| `employees` table (existing columns) | Backward compatibility. Add new columns; never alter existing ones. |
| `shifts` table (existing columns) | Backward compatibility. Extend with new columns (break_duration), never remove. |

### 11.2 Modules That Can Be EXTENDED

| Module | Extension | Risk |
|--------|-----------|------|
| `employees` table | Add `calendar_profile_id` (nullable FK to employee_calendar_profiles) | Low — backward compatible (null means inherit company default) |
| `shifts` table | Add `break_start_time`, `break_duration` (nullable) | Low — backward compatible (null means no break) |
| `leave_records` table | Add `is_half_day` (boolean, default false), `is_paid` (boolean, default true for annual/sick) | Low — backward compatible (default matches current behavior) |
| `payroll_settings` table | Add `company_calendar_profile` columns (week_start_day, working_days bitmask) | Low — backward compatible (default Mon–Fri) |
| `attendance_exceptions` table | Add `processing_run_id` FK | Low — backward compatible (null for existing rows) |
| IPC attendance handlers | Add new channels for processing engine, calendar, periods | Low — additive, existing channels unchanged |

### 11.3 Modules That Should Be REFACTORED

| Current | Refactored To | Rationale |
|---------|---------------|-----------|
| `attendance.ts` (1396 LOC monolithic) | `attendanceClock.ts`, `attendanceShift.ts`, `attendanceLeave.ts`, `attendanceQuery.ts` | Current file does too many things. Split by domain before adding processing engine. |
| `getMonthlyCalendar()` + `aggregateDailyHours()` (two different algorithms) | `attendanceProcessor.ts` (single unified algorithm) | Two functions produce different results from same data. The processing engine standardizes this. |
| Duplicated date-range expansion (3+ places) | `shared/dateUtils.ts` | Extract before adding more date logic in the processing engine. |
| `computeAttendanceExceptions()` (standalone) | Absorbed into processing pipeline Stage 3 (Validate) | Anomaly detection is part of processing, not a separate concern. |

### 11.4 New Modules

| Module | Purpose |
|--------|---------|
| `company_calendar_profiles` | Defines default working week (singleton) |
| `employee_calendar_profiles` | Per-employee override of working week |
| `calendar_events` | Date-specific exceptions (holidays, special days, closures) |
| `recurring_calendar_events` | Rule-based recurring events (every 1st May) |
| `payroll_periods` | Named date ranges for payroll grouping |
| `daily_attendance_records` | Processed attendance — one row per employee per day |
| `processing_runs` | Audit trail of processing engine executions |
| `attendanceProcessor.ts` | The processing engine service |

### 11.5 Backward Compatibility Strategy

The existing `getMonthlyAttendanceSummary()` (used by payroll) continues to work during the transition. The new processing engine runs in parallel:

```
Phase N:   getMonthlyAttendanceSummary() reads raw logs (current behavior)
Phase N+1: Processing engine writes Daily Records. Payroll still reads raw logs.
Phase N+2: Payroll switches to read Daily Records. getMonthlyAttendanceSummary() deprecated.
Phase N+3: getMonthlyAttendanceSummary() removed.
```

This ensures no feature is broken during the migration. The old and new systems coexist for at least one phase.

---

## 12. Implementation Roadmap

### 12.1 Why This Order?

The order is driven by dependency hierarchy:

```
Company Calendar (Phase 1)
    ↓ (needed by)
Payroll Period (Phase 2)
    ↓ (needed by)
Processing Engine (Phase 3)
    ↓ (produces)
Daily Records (Phase 4)
    ↓ (consumed by)
Payroll Engine Rewire (Phase 5)
    ↓ (enables)
Finalization & Locking (Phase 6)
    ↓ (enables)
Reports & Payslip (Phase 7)
    ↓ (above must be stable)
Advanced Features (Phase 8)
```

Each phase builds on the previous. Nothing is parallelizable because each layer depends on the one below it.

### 12.2 Phase Details

#### Phase 1: Company Calendar (Foundation)

**Deliverables:**
- `company_calendar_profiles` — defines default working week
- `employee_calendar_profiles` — per-employee override (optional, nullable)
- `calendar_events` — date-specific exceptions (public holidays, company holidays, special working days, emergency closures, company events, half days)
- `recurring_calendar_events` — rule-based recurring events
- Seed data: Malaysian public holidays 2026 (Merdeka, Hari Raya, Deepavali, CNY, Labour Day, etc.)
- UI: Calendar Management page (list events, add/edit/delete, import public holiday CSV)

**Why first:** Every downstream module needs to know "is this a working day?" Without the calendar, the processing engine has nothing to resolve.

**Estimated complexity:** Medium. Schema is straightforward. UI is a standard CRUD table + recurring rule editor.

#### Phase 2: Payroll Periods

**Deliverables:**
- `payroll_periods` table
- UI: Period Management page (create period, set date range, view status)
- Period lifecycle state machine (open → processing → finalized → closed)
- Validation: no overlapping periods
- Auto-assign: each `daily_attendance_record` gets a `payroll_period_id` based on its date

**Why second:** The processing engine needs to know period boundaries. Daily Records are grouped by period. Without periods, we can't lock or finalize anything.

**Estimated complexity:** Low. Simple CRUD + validation. The state machine has clear transitions.

#### Phase 3: Attendance Processing Engine (Core)

**Deliverables:**
- `processing_runs` table — audit trail of processing engine executions
- `attendanceProcessor.ts` — the 12-stage processing pipeline
- IPC handlers: `attendance:processPeriod`, `attendance:getProcessingStatus`, `attendance:listProcessingRuns`
- UI: "Process Attendance" button in a new "Processing" tab or payroll run flow
- Absorb `attendanceExceptions.ts` logic into Stage 3 (Validate)
- Standardize the pairing algorithm (replacing the two divergent ones)

**Why third:** After calendar and periods exist, the processing engine can consume them. This is the most critical phase — get it right.

**Estimated complexity:** High. This is the core architectural change. The logic is non-trivial (12 stages, each with edge cases). Must be thoroughly tested against known datasets.

#### Phase 4: Daily Attendance Records (Storage)

**Deliverables:**
- `daily_attendance_records` table
- Processing engine writes to this table at Stage 11
- IPC handlers: `attendance:getDailyRecords`, `attendance:getEmployeeDailySummary`
- UI: "Daily Records" tab or view showing processed records
- Backfill script: run processing engine on historical data to populate Daily Records

**Why fourth:** The processing engine produces these records. Without the engine, this table is empty.

**Estimated complexity:** Medium. The table design is the main effort. The backfill script must handle edge cases (missing calendar data for historical periods).

#### Phase 5: Payroll Engine Rewire

**Deliverables:**
- `calculatePayrollRun()` reads `daily_attendance_records` instead of `attendance_logs`
- `getMonthlyAttendanceSummary()` marked deprecated (kept for backward compatibility during transition)
- D5 gate moved to Daily Records level (check open exceptions → block payroll)
- Verify: payroll run results match between old and new approaches (for periods with both)
- Remove direct `attendance_logs` reads from all payroll code

**Why fifth:** Daily Records must exist before payroll can consume them. This phase is the "flip the switch."

**Estimated complexity:** Medium. Mostly changing queries, not logic. The payroll calculation itself doesn't change — only where it gets its hours from.

#### Phase 6: Attendance Finalization & Locking

**Deliverables:**
- Period finalization: admin clicks "Finalize Period" → all Daily Records in the period marked `is_finalized = true`
- Period closing: admin clicks "Close Period" → raw `attendance_logs` in the period become immutable
- Application-layer enforcement: reject updates to finalized/closed data
- "Re-open Period" flow (requires confirmation + audit log entry)
- UI: Period status badges in Period Management page

**Why sixth:** Locking only makes sense after processing and payroll are stable. Locking prematurely is dangerous.

**Estimated complexity:** Low. Application-level guards + UI flows. No complex logic.

#### Phase 7: Reports & Payslip (Output Layer)

**Deliverables:**
- Attendance Summary Report (reads Daily Records, not raw logs)
- Late/Early-Out Report (reads Daily Records)
- Leave Balance Report (reads entitlements — no change)
- Payslip generation (reads Daily Records for attendance section)
- All reports are consistent because they share the same Daily Records source
- Remove the old `getLateReport()` that reads raw logs

**Why seventh:** Reports are the presentation layer. They should be the last thing built on top of stable data.

**Estimated complexity:** Medium. Report design + Excel/PDF generation. The data is already computed; reports are formatting.

#### Phase 8: Advanced Features (Polish)

**Deliverables:**
- Half-day leave support (`leave_records.is_half_day` → processing engine handles half-day logic)
- Break tracking (`shifts.break_start_time` + `break_duration` → processing engine subtracts breaks)
- Early-out detection (processing engine compares last OUT to shift end)
- Auto-checkout for missing OUT punches (configurable: insert shift end time as OUT)
- Employee self-service portal (view own attendance, submit leave)
- Multi-device support (multiple `device_ip` entries)
- Real-time device listener (background polling at configurable interval)

**Why last:** These are features, not architecture. They build on the stable foundation without changing it.

**Estimated complexity:** Varies by feature. Some are simple (break tracking), others are significant (self-service portal).

---

## 13. Architecture Critique (Self-Review)

### 13.1 Weakness #1: Over-Engineering for SME Scale

**Criticism:** This architecture introduces a processing engine, payroll periods, calendar profiles, and a 12-stage pipeline for what is currently a single-user SME desktop app. Is this necessary?

**Response:** The question is not "how many users?" but "are we calculating people's pay?" A bug in a 2-employee company that results in wrong salary is as serious as in a 200-employee company. The processing engine exists to prevent one class of bugs: payroll reading mutable data. This is not about scale — it's about correctness.

However, there is a valid concern: the initial seed data burden. Malaysian public holidays must be seeded. The admin must configure the working week. Payroll periods must be created. For a 2-person company, this setup effort might feel disproportionate.

**Mitigation:** Seed sensible defaults — Mon–Fri working week, 15 common Malaysian public holidays for 2026-2027, and auto-create the first payroll period based on the current month's date range. The admin can use the system immediately without configuration.

### 13.2 Weakness #2: Two Sources of Truth During Transition

**Criticism:** During Phase 5 (transition), both the old `getMonthlyAttendanceSummary()` and the new Daily Records produce attendance data. Which one is "correct" if they differ?

**Response:** They WILL differ initially because:
1. The processing engine uses the new calendar → public holidays and weekly offs are correctly identified.
2. The old `getMonthlyAttendanceSummary()` has no calendar awareness → every day is a working day.

This difference is expected and desirable. The transition should include a comparison report: "Old calculation: 176 hours. New calculation: 160 hours. Difference: 16 hours = 2 weekly off days correctly excluded."

The admin reviews this report and confirms the new figures are correct. After transition, the old function is removed.

### 13.3 Weakness #3: No Versioning of Daily Records

**Criticism:** When the admin re-runs the processing engine, old Daily Records are overwritten. If a payroll run was already done with the old records, the audit trail is broken.

**Response:** This is a valid concern. The proposal should be amended: **Daily Records are versioned, not overwritten.**

```
Updated design:

daily_attendance_records:
    - Add `version` (INTEGER, default 1)
    - Add `is_current` (BOOLEAN, default true)
    - UNIQUE constraint on (employee_id, date, version)

When re-processing:
    1. INSERT new rows with version = N+1, is_current = true
    2. UPDATE old rows: is_current = false (do NOT delete)
    3. Payroll always reads WHERE is_current = true
    4. Audit reports can show version history for any date
```

This preserves the full history of processing runs while keeping the "current" view simple.

### 13.4 Weakness #4: Payroll Period Flexibility Creates Complexity

**Criticism:** Supporting flexible periods (26 Jun – 25 Jul) vs. calendar months (1 Jul – 31 Jul) adds complexity to period assignment, reporting, and year-end reconciliation. Is it worth it?

**Response:** Yes, because Malaysian SME payroll cycles are almost never calendar months. The standard practice is the 25th-26th cut-off. If we force calendar months, every SME admin must mentally translate "July payroll = 26 Jun to 25 Jul" — which defeats the purpose of the software understanding their business.

The complexity is manageable:
- Each Daily Record has ONE `payroll_period_id`.
- A date falls into exactly ONE period (no overlap).
- Year-end reports aggregate by calendar year (using `date`, not `payroll_period_id`).
- Tax year reports use the period's end date to determine which tax year it belongs to.

### 13.5 Alternative Design: Event Sourcing Instead of Daily Records

**Alternative:** Instead of pre-computed Daily Records, use event sourcing — store every punch as an immutable event, and derive attendance status and hours at query time.

```
AttendanceLogCreated(event) → AttendanceProjection(query-time derivation)
```

**Advantages:**
- No processing step needed
- Always consistent with raw logs (no staleness)
- Naturally auditable (every event is permanent)

**Why rejected:**
- Event sourcing adds significant complexity (projections, event stores, replay mechanisms)
- This is a desktop app, not a distributed system. The simpler approach (batch processing into immutable records) achieves the same goals with far less complexity
- Event sourcing requires a materialized view for performance — which is functionally identical to Daily Records, just implemented differently
- The team is not familiar with event sourcing patterns; introducing them now would delay delivery

**Verdict:** Event sourcing is a valid alternative but over-engineered for this use case. The processing engine approach is simpler and achieves the same immutability guarantee.

### 13.6 Alternative Design: Calendar-as-View Instead of Calendar-as-Table

**Alternative:** Instead of storing `calendar_events`, compute the calendar at query time from rules:

```sql
-- Pseudo-view: resolve calendar for any date
SELECT
  CASE
    WHEN is_emergency_closure(date) THEN 'emergency_closure'
    WHEN has_approved_leave(employee, date) THEN 'on_leave'
    WHEN is_public_holiday(date) THEN 'public_holiday'
    WHEN is_weekly_off(employee, date) THEN 'weekly_off'
    ELSE 'working_day'
  END
```

**Advantages:**
- No calendar tables to manage
- Always consistent with rules (no stale events)
- Simpler schema

**Why rejected:**
- Public holidays change every year. They cannot be derived from rules alone (e.g., Hari Raya dates depend on moon sighting). They must be stored.
- Company holidays are ad-hoc. No rule generates "Company Director's birthday."
- A stored calendar is queryable, exportable, and auditable. A view is not.
- The processing engine stores the resolved calendar type in `daily_attendance_records` — so the calendar is only queried at processing time, not at payroll time.

**Verdict:** The hybrid approach is correct: store calendar events as source data, resolve them in the processing engine, and store the result in Daily Records.

---

## 14. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Processing engine produces different results than old `getMonthlyAttendanceSummary()` | High | Low | Expected difference (calendar awareness). Comparison report during transition validates the delta. |
| Historical backfill of Daily Records fails on edge cases | Medium | Medium | Run backfill on a copy of the database first. Log all failures. Handle each edge case explicitly. |
| Payroll period assignment is wrong (date falls in wrong period) | Low | High | Validate period non-overlap at DB level. Test with boundary dates (25th-26th cut-off). |
| Admin creates overlapping payroll periods | Low | Medium | Application-level validation prevents this. DB UNIQUE constraint on non-overlapping date ranges. |
| Processing performance on 10+ years of historical data | Low | Low | Processing runs per-payroll-period, not on the entire history. Even 5 years = ~1800 rows/employee — trivial for SQLite. |
| Admin edits raw logs after period finalization, doesn't re-process | Medium | Medium | UI shows prominent warning banner: "Attendance data has changed since last processing. Payroll may be inaccurate. [Re-process Now]." |
| Calendar events seeded incorrectly (wrong holiday dates) | Medium | Medium | Provide "Import Public Holidays" feature with verified data source. Admin can edit individual events. |
| Break deduction overcounts (session spans break but employee didn't take it) | Low | Low | Break deduction is a configurable policy. Default = no break deduction. Admin opts in. |

---

## 15. Migration Strategy

### 15.1 Non-Destructive Migration

Every phase is additive. No existing table loses columns. No existing function is removed until its replacement is stable.

1. **New tables are created** — they coexist with existing tables.
2. **New functions are written** — they coexist with existing functions.
3. **New IPC handlers are registered** — they coexist with existing handlers.
4. **Old functions are deprecated, not deleted** — they continue to work.
5. **After verification, old functions are removed** — only when the new system has been running correctly for at least one full payroll cycle.

### 15.2 Data Migration (Backfill)

After Phase 4 (Daily Records exist), run a backfill to populate historical Daily Records:

1. Create payroll period entries for historical months (auto-generated: 1st–last day of each month)
2. Seed calendar events for known public holidays in historical periods
3. Run the processing engine for each historical period
4. Compare: old `getMonthlyAttendanceSummary()` vs. new Daily Records
5. Differences are expected (calendar awareness). Document the delta.
6. If any unexplained differences exist → investigate and fix the processing engine

### 15.3 Rollback Plan

If the processing engine produces incorrect results:
1. Switch payroll back to `getMonthlyAttendanceSummary()` (kept during transition)
2. Fix the processing engine bug
3. Re-run processing
4. Verify
5. Switch payroll back to Daily Records

This requires `getMonthlyAttendanceSummary()` to remain functional during the entire transition period.

---

## 16. Future Scalability

### 16.1 What This Architecture Enables

| Capability | How |
|------------|-----|
| **Multi-branch support** | Each branch gets its own `company_calendar_profile` (different weekly off days by state, e.g., Fri–Sat for Kedah) |
| **Employee self-service** | Employees query `daily_attendance_records` (not raw logs) — simpler, faster, safer |
| **Multi-tenant (future SaaS)** | Each tenant gets their own calendar events, payroll periods, and processing runs |
| **Overtime pre-approval** | Add `ot_request` table referenced by processing engine at Stage 10 |
| **Shift swapping** | Processing engine reads `shift_swap` records at Stage 6 instead of the static shift assignment |
| **Real-time attendance dashboard** | Subscribe to `processing_run` completion events → refresh dashboard |
| **Regulatory compliance** | Export `daily_attendance_records` for labor department audits (each row is a clear, auditable record) |
| **Machine learning for anomaly detection** | Feed `daily_attendance_records` + `attendance_exceptions` into a model to detect patterns (e.g., "Ali is always late on Mondays") |

### 16.2 What This Architecture Does NOT Support (Yet)

- Real-time streaming of device punches (still manual pull — Phase 8)
- Biometric template management (ZKTeco device manages templates; app doesn't)
- Geofencing / mobile check-in (desktop app, not a mobile app)
- Multi-country payroll (Malaysia-only; public holidays and statutory rates are Malaysian)
- Integration with external payroll systems (app is self-contained; export to Excel is the integration point)

---

## 17. Summary of Decisions

| Decision | Rationale |
|----------|-----------|
| Processing Engine: **YES** | Financial integrity requires immutable attendance data between raw logs and payroll |
| Daily Records granularity: **Per employee per day** | Right balance of summary and detail for payroll consumption |
| Calendar: **Event-based exceptions on top of a profile** | Public holidays change yearly and must be stored. Profile handles the recurring weekly pattern. |
| Holiday priority: **Leave > Special Working Day > Public Holiday > Company Holiday > Weekly Off** | Approved leave is an intentional override. Special Working Day is an intentional decision to work. |
| Payroll periods: **Flexible date ranges (26 Jun – 25 Jul)** | Real-world Malaysian payroll cycles. Calendar-month-only would be incorrect. |
| Payroll consumes **only** Daily Records | Immutability, auditability, consistency. Never raw logs again. |
| Daily Records are **versioned** (not overwritten) | Preserves full audit trail across processing re-runs. |
| Old functions **deprecated, not deleted** | Non-destructive migration. Rollback possible at any point. |
| Break deduction: **configurable, default off** | Not all SMEs track breaks. Opt-in avoids incorrect deductions. |
| Half-day leave: **Phase 8** | Not critical for initial payroll. The field exists in the schema from Phase 4 but logic is deferred. |

---

*End of proposal. This document is submitted for architecture review. No implementation should begin until all stakeholders have approved the design decisions herein.*
