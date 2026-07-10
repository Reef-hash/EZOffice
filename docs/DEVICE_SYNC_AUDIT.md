# Device Sync ↔ Payroll Audit (2026-07-08)

Senior-level audit of the ZKTeco K40 Pro sync pipeline and its downstream payroll impact.
Scope: `electron/services/attendance.ts` (`syncFromDeviceEthernet`), `electron/services/attendanceSummary.ts`
(`getMonthlyAttendanceSummary`), `electron/services/payroll/calculationEngine.ts` + `payrollRun.ts`,
`src/modules/attendance/DeviceSettingsPage.tsx`.

**This is a findings + solutions document. No code has been changed.** Each finding has a
severity, root cause, failure scenario, and recommended fix for the implementing agent.

---

## CRITICAL — money bugs (fix before any payroll run uses device data)

### C1. `days_worked` counts IN→OUT *pairs*, not unique dates → daily-rate employees get double-paid

**Where:** `attendanceSummary.ts:187` — `daysWorked++` inside the per-pair loop.

**Failure scenario:** Employee punches IN 08:00, OUT 12:00 (lunch), IN 13:00, OUT 17:00.
That is 2 pairs → `days_worked = 2` for **one** calendar day. `calculationEngine.ts:79`
computes `grossRegularPay = days × rate_amount` for daily-rate employees → **paid 2 days
for 1 day of work**. The `Math.min(days_worked, workingDaysInMonth)` cap in the engine
only trims the overflow at month scale; within the month it still overpays massively
(e.g. 20 real days with lunch breaks → 40 pairs → capped at ~22 → still overpaid 2 days,
and hides the bug instead of surfacing it).

Any employee who punches for lunch break — which the device makes trivially easy —
triggers this every single day.

**Fix:** Aggregate per **calendar day**, not per pair:
1. Group the month's logs by date first.
2. Within a day, sum hours across all IN→OUT pairs → `dayTotalHours`.
3. `regular = min(dayTotalHours, standardHoursPerDay)`, `ot = max(0, dayTotalHours - standardHoursPerDay)`.
4. `days_worked = count of unique dates with dayTotalHours > 0`.

This also fixes OT classification (see C3 — currently a split day can never generate OT).

### C2. Position-based IN/OUT assignment is not stable across syncs → type flips, duplicates, corrupted sequence

**Where:** `attendance.ts:509-543` — `punchIndex` alternation (1st punch = IN, 2nd = OUT…)
computed **per sync batch**, and dedup key is `(employee_id, timestamp, type)`.

**Root cause:** The IN/OUT type of a punch is derived from its *position in the current
download*, but the dedup key *includes that derived type*. Any event that shifts positions
changes the derived type of already-synced punches, the dedup key no longer matches the
row in the DB, and the same physical punch is **re-inserted with the opposite type**.

**Concrete failure scenarios:**
- **Duplicate/bounce punches** (employee presses finger 2× within seconds — very common):
  2 punches 5 s apart become IN then OUT (a 5-second "work session"), and the *real*
  evening punch-out becomes an IN. Every subsequent punch that day is inverted. This is
  exactly the "duplicate in/out hari yang sama" symptom reported by the owner.
- **Device log cleared** (admin purges device memory, or device auto-purges when full):
  next sync's positions restart at 1 → parity of every remaining punch can flip →
  mass duplicate rows with inverted types.
- **Manual punch added in EZOffice between syncs** (admin backfills a forgotten punch-out):
  the device knows nothing about it; the derived sequence and the DB sequence now disagree →
  broken alternation (IN,IN / OUT,OUT), and the summary's pairing silently discards orphans →
  **hours silently vanish → underpayment**.
- **Manual clock-in via app + same punch on device**: the Phase 3 scope doc claims dedup
  handles this, but dedup requires *exact* timestamp equality to the second. A manual entry
  will never match the device's seconds → the same physical event is stored twice → double hours.

**Fix (redesign the type-assignment rule to be deterministic and re-derivable):**
1. **Dedup on `(employee_id, timestamp)` only** — never include the derived `type` in the
   identity of a punch. A physical punch at a moment in time is unique regardless of what
   we label it. Add a **tolerance window** (skip insert if a punch for the same employee
   exists within ±60 s) to absorb manual-vs-device double capture.
2. **Debounce at ingest:** collapse device punches for the same employee < 2 min apart
   (configurable, `payroll_settings.punch_debounce_minutes`, default 2) into one — keep the first.
3. **Assign IN/OUT per calendar day, not per global sequence:** for each employee+day,
   sort punches; odd positions within the day = IN, even = OUT. A day's punches can never
   be corrupted by a previous day's odd punch count or by device log purges.
   (Simplest robust alternative for SME: 2 punches/day = IN+OUT; >2 punches = pair them
   in order after debounce; 1 punch = exception, see H2.)
4. Because type becomes re-derivable, add a **"Re-pair day" admin action** (or recompute on
   sync) so a fixed punch re-heals the day instead of requiring manual cascade edits.

### C3. OT model mismatch with how the device/real world works — split shifts never produce OT, and OT sessions get paid as regular

**Where:** `attendanceSummary.ts:181-187` — regular/OT split is computed **per pair**.

**Failure scenario (the owner's exact question):** Employee ends shift, punches OUT at 17:00,
comes back and punches IN 19:00, OUT 22:00 for overtime. The 19:00–22:00 pair is 3 h ≤
standard 8 h → counted as **regular** hours (for hourly-rate staff this pays OT time at
the base rate; for daily-rate staff it *double-counts a day* per C1). Contiguous OT
(working straight through 08:00–19:00) is the only pattern the current code classifies
as OT. Real usage is exactly the opposite.

**Fix:** The per-day aggregation in C1 fixes the mechanics (day total 11 h → 8 regular + 3 OT).
Two business decisions the **owner must confirm** (do not decide silently):
- **D1 — OT trigger rule:** (a) hours-based — OT = daily hours beyond `standard_hours`
  (what the code intends today, fixed by C1); or (b) schedule-based — OT = time worked
  after `shift.end_time` (+ optional threshold), which matches how ZKTeco devices and most
  Malaysian factories think about "lepas waktu shift dikira overtime". Recommend (a) as
  default with (b) as a per-company setting later — (a) is robust to late starts.
- **D2 — Device OT state keys:** ZKTeco punches carry a `state` field (Check-In=0,
  Check-Out=1, Break-Out=2, Break-In=3, OT-In=4, OT-Out=5) selected by the device's
  function keys. The sync currently discards it (K40 Pro defaults it unreliably when staff
  don't press the keys). If the client will train staff to press the OT key, the sync could
  trust `state` when present and fall back to position when absent. Ask the owner; if staff
  won't be trained, ignore `state` permanently and document that.

---

## HIGH — correctness / operability

### H1. Full re-download every sync, no watermark

**Where:** `attendance.ts:463` — `getAttendances()` pulls the device's entire log memory
every sync; dedup runs one COUNT query per punch.

**Impact:** Grows linearly forever (K40 Pro stores up to ~100k logs); combined with C2's
unstable dedup it is the direct cause of "bila sync log, dia tarik semua log". Even after
C2's fix, per-punch queries over 100k device logs on every sync is slow and hammers the UI.

**Fix:** Store `last_synced_at` (per device) in settings; skip mapped punches older than the
watermark *before* hitting the DB, and set the watermark to the newest successfully-inserted
punch timestamp at the end of a successful sync. Keep the DB-level dedup as the safety net
(watermark is an optimisation, not the correctness mechanism).

### H2. No exceptions surface — missing punch-outs silently destroy hours

**Where:** `attendanceSummary.ts:172-192` — orphan INs and orphan OUTs are discarded with
no record; sessions have no sanity cap.

**Impact:** An employee who forgets to punch out loses the whole day's pay with zero
visibility to the admin. Conversely, after a C2 type-flip, a forgotten OUT can pair with
the next day's punch → a 20–30 h "session" paid with massive OT. Both directions are
payroll incidents the admin can't see.

**Fix:**
1. **Max session cap:** pairs longer than a configurable cap (e.g. 16 h) are excluded from
   pay and flagged as exceptions, not paid blindly.
2. **Attendance Exceptions report** (new subtab or section): per month, list days with an
   odd punch count, capped/over-long sessions, punches on leave days, and unknown device
   user IDs. The admin fixes them via the existing manual log form before running payroll.
3. **Payroll pre-flight:** `calculatePayrollRun` should refuse (or loudly warn) when
   unresolved exceptions exist in the run month — same spirit as the existing
   `checkRateTables` gate.

### H3. "Test Connection" doesn't test anything

**Where:** `DeviceSettingsPage.tsx:83-92` — shows an info toast; never touches the network.
The owner was directly misled by this ("saya tak tahu sama ada betul ii dah connect ke belum").

**Fix:** New IPC `attendance:testDevice` → service opens the socket, calls a cheap read
(`getInfo()` / serial number / user count / log count), disconnects, returns
`{ok, deviceName, serial, userCount, logCount}` or a specific error (unreachable vs refused
vs timeout). Renderer shows the result. This also gives the admin the device user count to
sanity-check mapping (H4).

### H4. Device-user → employee mapping is blind manual data entry

**Where:** migration `0010_device_user_id.sql` + `EmployeeForm` field; sync skips unmapped
user IDs with one error string **per punch** (a device with 3 unmapped users × 200 punches
= 600 identical error lines returned to the renderer, which only shows a count).

**Fix:**
1. New IPC `attendance:getDeviceUsers` → `device.getUsers()` returns enrolled users
   (device user_id + name). New mapping panel in Device Settings: table of device users,
   dropdown of EZOffice employees, writes `employees.device_user_id`.
2. Deduplicate sync errors by user ID (`user 5: 200 punches skipped — not mapped`), and
   persist the last sync result (time, inserted, skipped, first N errors) in settings or a
   small `sync_log` table so the admin can review after the toast disappears.

---

## MEDIUM

### M1. Cross-midnight shifts lose hours at month boundary + leave-day filter can split a pair
`attendanceSummary.ts:146-151` filters logs by month; a night shift IN on the 31st 22:00
pairs with an OUT on the 1st 06:00 that the query excludes → orphan IN → whole shift unpaid
in that month. Also `attendanceSummary.ts:166-170`: leave-day check is per punch, so an IN
on a leave date discards the pair even if the OUT isn't on leave. **Fix:** fetch logs with a
±1 day margin around the month, pair first, then attribute each *pair* to the date of its IN
punch and apply month/leave filtering per pair, not per punch.

### M2. Historical device punches get judged against today's shift
`attendance.ts:557-559` — sync computes late-status using `getEmployeeShift` (the employee's
*current* shift) even for punches weeks old, and stamps `shift_id` accordingly. Acceptable
short-term if syncs are frequent; wrong for backfills. **Fix (cheap):** document that syncs
must be run regularly. **Fix (proper):** shift history table is out of scope — at minimum
don't mark historical (> X days old) synced punches late; leave status 'on-time' and let
the exceptions report handle old data.

### M3. `device_id` column never populated
Sync inserts `source='device'` but leaves `device_id` NULL (`attendance.ts:513-515`), defeating
the Phase 2 design where `device_id` identifies the source device. **Fix:** stamp it with the
device IP or serial (from H3's `getInfo`).

### M4. `record_time` parsing trusts `new Date()` on a locale string
`attendance.ts:487` — zkteco-js returns `Date.toString()` text; `new Date(string)` parsing is
engine-dependent. Works today in Electron/V8; brittle. **Fix:** if the library exposes a raw
epoch or structured time, prefer it; otherwise validate `isNaN(d.getTime())` and push an
error instead of silently producing `NaN-NaN-NaN` timestamps.

### M5. Device clock drift is unmonitored — silently corrupts late/OT for everyone

All lateness and OT math compares **device punch timestamps** against **EZOffice shift
times**. If the device's internal clock drifts (cheap RTCs drift minutes per month; power
loss can reset it entirely), every punch shifts — everyone becomes "late" or OT is over/
under-counted, and nothing looks obviously wrong in the logs.

**Fix:** During **Test Connection** and at the start of every **Sync**, read the device
time (`getTime()` in zkteco-js) and compare with PC time: drift > 60 s → surface a warning
in the result ("Device clock is 4 min behind — sync it before relying on late/OT data");
offer a "Set device time from PC" button (`setTime()`). Do not silently auto-correct —
punches already stored on the device were stamped with the drifted clock.

### M6. Leftover debug noise
`[LATE-DETECT]` console.log blocks throughout `attendance.ts` (lines 117, 132, 138, 161-169,
268-279…) are shipped debug logging — remove or gate behind a debug flag (CLAUDE.md §3,
no noise comments/logs).

---

## Decisions — LOCKED by project owner (2026-07-08)

| # | Decision | Outcome |
|---|----------|---------|
| D1 | OT trigger rule | **(a) hours-based** — OT = daily total hours beyond shift `standard_hours`. Robust to late starts. |
| D2 | Device OT/state function keys | **Ignore permanently.** Staff will not be trained on state keys; the `state` field is discarded by design. Document this in code where the field is dropped. |
| D3 | Debounce window | **2 minutes** (default), stored as `payroll_settings.punch_debounce_minutes` so it stays configurable. Punches for the same employee < 2 min apart collapse to the first. |
| D4 | Max session cap | **16 hours** (default), stored as `payroll_settings.max_session_hours`. Pairs longer than the cap are excluded from pay and flagged as exceptions. |
| D5 | Payroll pre-flight on exceptions | **Block by default, with per-exception resolve/dismiss.** `calculatePayrollRun` refuses while unresolved exceptions exist in the run month; the admin clears each one deliberately (fix via manual log form, or explicitly dismiss with a note). Same gate pattern as the existing `checkRateTables`. |

## Device-side configuration policy (LOCKED 2026-07-08)

**EZOffice is the single source of truth for shifts, lateness, and OT. The device is a
dumb punch collector.** The device's own shift/timetable/attendance-rule settings only
affect its internal reports and the `state` field — both of which EZOffice ignores by
design (D2). Raw punch timestamps are unaffected by device shift config, so the two
"shift systems" never conflict: only ours is ever used.

Device setup rules for admins (belongs in `docs/ZKTECO_SYNC_SETUP.md`):
1. **Do NOT configure shifts/timetables on the device.** Enroll users (fingerprint + user ID)
   and nothing else. Any device-side shift config is harmless but must never be relied on.
2. **Device clock must be correct** — see M5. Verify via Test Connection; use the
   "Set device time from PC" action when drift is reported.
3. **Optionally set the device's own punch-interval setting** (device-side debounce) —
   complements, but does not replace, the app-side 2-min debounce (D3), since the app-side
   rule must also hold for logs from devices where the setting was forgotten.

## Target flows (what "correct" looks like after the fixes)

### Flow 1 — First-time setup (once per installation)

1. Admin opens **Attendance → Device Settings**, enters device IP/port, clicks **Save**.
2. Clicks **Test Connection** → real IPC call opens the socket, reads device info →
   shows `Connected: <model/serial>, N users enrolled, M logs stored` or a specific error
   (unreachable / refused / timeout — each with a distinct message).
3. Clicks **Load Device Users** → mapping table appears: each device user (ID + name from
   the device) with an EZOffice employee dropdown. Admin maps everyone → writes
   `employees.device_user_id`. Unmapped users are visibly listed, not silently skipped later.
4. Admin confirms every mapped employee has a **shift assigned** (needed for late/OT rules).

### Flow 2 — Routine sync (daily/weekly)

1. Staff punch at the device throughout the day. No state keys — just punch.
2. Admin clicks **Sync Now**. Pipeline, in order:
   a. Pull logs from device; drop logs older than the `last_synced_at` watermark.
   b. Map device user_id → employee via `device_user_id`; group unmapped into ONE error per user.
   c. **Debounce:** collapse same-employee punches < 2 min apart (keep first).
   d. **Per-day type assignment:** group by employee + calendar day, sort by time;
      odd position in the day = IN, even = OUT.
   e. **Dedup:** skip if a punch exists for (employee, timestamp ± 60 s) regardless of type —
      absorbs manual-vs-device double capture.
   f. Insert with `source='device'`, `device_id` = device serial/IP, snapshot shift + status.
   g. Advance the watermark; persist the sync result (time, inserted, skipped, errors).
3. Toast shows summary; a persistent "Last sync" panel shows the full result including errors.

### Flow 3 — Month-end payroll (happy path)

1. Admin opens **Attendance → Exceptions** for the payroll month → list is empty.
2. Creates/recalculates the payroll run. Summary layer aggregates **per calendar day**:
   day total hours → `regular = min(total, standard_hours)`, `ot = excess`;
   `days_worked` = count of unique dates worked. Split days (lunch break, evening OT
   session) produce exactly one day and correct OT.
3. Finalize → payslips. Gross for daily-rate staff = unique days × rate. No double days.

### Flow 4 — Exception paths (when things go wrong)

| Problem | What the system does | What the admin does |
|---|---|---|
| Employee forgot to punch out (odd punches that day) | Day appears in **Exceptions report** as "missing punch"; its hours are NOT silently counted or discarded | Backfill the missing OUT via the existing manual log form (with a note) → day re-pairs and counts |
| Session > 16 h (e.g. missing OUT paired across days) | Pair excluded from pay, flagged as "over-long session" exception | Fix the underlying punches, or dismiss with a note if genuinely correct |
| Punch on an approved-leave day | Flagged as exception (employee punched while on leave) | Decide: cancel the leave or dismiss the punches |
| Device user not mapped | Sync reports ONE error per user ("user 5: 200 punches skipped — not mapped"), punches stay on the device | Map the user in Device Settings → Sync again (watermark must not advance past skipped-unmapped punches, or re-sync must be able to fetch them again) |
| Device unreachable | Test Connection / Sync returns a specific network error | Check cable/IP/subnet (device and PC must be on the same subnet) |
| Payroll run attempted with open exceptions | `calculate` blocked with the list of unresolved exceptions for that month | Resolve or dismiss each, then recalculate |
| Existing corrupted rows from the old sync (type-flipped duplicates) | One-time cleanup: delete `source='device'` rows for the affected period and re-sync — the source data is still on the device | Run the cleanup before the first payroll that uses device data |

## Implementation order (for the implementing agent)

1. **C1 + C3 mechanics** — per-day aggregation in `getMonthlyAttendanceSummary` (pure logic,
   unit-testable, biggest money impact, no schema change). OT rule = D1(a).
2. **C2** — sync redesign per Flow 2: debounce (D3) → per-day type assignment → dedup on
   (employee_id, timestamp ± 60 s). Include the one-time cleanup path for corrupted rows.
3. **H2** — session cap (D4) + Exceptions report + payroll pre-flight gate (D5).
4. **H3 + H4** — real Test Connection + device user mapping panel (Flow 1).
5. **H1** — sync watermark (careful: must not skip punches that were rejected as unmapped —
   either hold the watermark back to the oldest skipped punch, or track skipped punches).
6. **M1–M5** — hardening (cross-midnight month boundary, historical shift judgement,
   `device_id` stamping, timestamp parse validation, remove `[LATE-DETECT]` debug logs).

New settings columns required (one additive migration):
`punch_debounce_minutes` (INTEGER NOT NULL DEFAULT 2), `max_session_hours` (REAL NOT NULL
DEFAULT 16), `device_last_synced_at` (TEXT NULL), plus wherever the last-sync result is
persisted (recommend a small `device_sync_log` table: started_at, inserted, skipped,
errors_json). Exceptions need either a derived view (recomputed on demand) or a
`attendance_exceptions` table with `status ('open','resolved','dismissed')` + note —
recommend the table, since D5 requires dismiss-with-note to persist.