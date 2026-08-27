# OT (Overtime) Calculation — Status & Plan

Written 2026-08-18 as a handoff note. Updated 2026-08-18 (later the same day) once
break-limit tracking (§3/§4.2 below) was actually implemented — see the "Implemented"
addendum at the bottom for what shipped and what's still open.

---

## 1. Context: the late-detection fix that prompted this

Same session fixed a real bug in `syncFromDeviceEthernet()` (`electron/services/attendance.ts`):
device-synced check-ins had their Late/On-Time `status` forced to `'on-time'` whenever the
sync ran a day or more after the punch, regardless of actual punch time. See the
2026-08-18 entry in `CLAUDE.md`'s Decision Log for the full root-cause writeup.

**Important — that fix does not retroactively correct old data.** It only changes how
*future* syncs compute status. Existing rows (like the 8/16 and 8/17 examples the client
reported) still have the old wrong value baked in until an admin runs the new
**"Recompute Late Status"** button (Attendance → Device Settings → "Fix Historical
Late/On-Time Status"). That's a one-click, one-time action per install, not automatic —
do this after deploying the fix.

---

## 2. What the client actually asked about (OT), and what already exists

The client's scenario: shift 9:00–18:00 with 1hr rest. If an employee checks in late
(e.g. 9:15), they should need to check out at 18:15 (not 18:00) to complete a full
working day; anything clocked beyond that target should count as OT.

**This is already built**, just not visible where the client was looking. It lives in
the Attendance Processing Engine (`electron/services/attendanceProcessor.ts`, Stage 5 +
Stage 10), which runs when an admin clicks **"Process Attendance"** on a Payroll Period
(Payroll → Payroll Periods) — not live on the Attendance Logs screen.

Current formula, per employee per day:

```
totalClockedHours = actual clock-out timestamp − actual clock-in timestamp
regularHours      = min(totalClockedHours, shift.standard_hours)
otHours           = max(0, totalClockedHours − shift.standard_hours)
```

Because `totalClockedHours` is elapsed time from the employee's *own* punch (not a
fixed wall-clock shift-end), this already shifts the OT threshold forward for a late
check-in exactly like the client described — check in at 9:15, `standard_hours = 7` →
OT only starts once they've clocked 7 hours, i.e. past 16:15.

`ot_hours` already flows into payroll: `calculationEngine.ts` multiplies it by the
configured OT rate (`payroll_settings` OT rule: multiplier or flat addition) to produce
`gross_ot_pay`. So once a period is processed, OT already affects pay — nothing new
needed there.

---

## 3. The real gap: rest/lunch break handling

`shifts.standard_hours` is a **plain number** set by the admin (Attendance → Shifts) —
it is *not* derived from `start_time`/`end_time`. The engine never auto-subtracts a
lunch break from clocked time. A break is only excluded if the employee physically
clocks **out and back in** for lunch (two separate IN/OUT sessions that day, each
summed independently). If they don't, a single continuous 9:00→18:00 punch reports
9 raw clocked hours — the 1-hour rest is silently counted as worked time unless
`standard_hours` is configured to already include it.

Two valid configurations, and the correct one depends on how the client's employees
actually behave day to day:

| Scenario | Employees clock lunch separately? | Correct `standard_hours` |
|---|---|---|
| A | No — one IN/OUT per day | `8` (9hr span, 1hr unclocked rest folded in) |
| B | Yes — clock out/in for lunch (2 sessions/day) | `7` (true net target; break time never counted) |

Given the client's own numbers (9–6 with 1hr rest = 7 net hours), **Scenario B** seems
to be their mental model — but that only produces correct numbers if lunch punches are
actually happening. If they're not, every employee will show ~1 hour of phantom "OT"
every single day.

**Open question for the client — must be answered before touching OT code:**
Do employees clock in/out for lunch, or is it one continuous punch per day?

---

## 4. Two follow-on features, not yet built, worth deciding on

1. **Live OT visibility.** Right now OT is only visible after a batch "Process
   Attendance" run per payroll period — not in real time the moment someone clocks
   out on the Attendance Logs screen. Options:
   - Leave as-is (payroll-period batch view is authoritative and sufficient).
   - Add a live "hours worked so far today" / "would be OT" indicator on the Logs
     screen per clock-out event, purely informational (the payroll-period run stays
     the authoritative source for actual pay).

2. **Automatic break deduction.** If lunch isn't reliably clocked (Scenario A above),
   add a configurable `break_minutes` column on `shifts`, auto-subtracted from
   `totalClockedHours` before the regular/OT split in Stage 10 of
   `attendanceProcessor.ts`. This removes the need to fudge `standard_hours` to
   compensate for an unclocked break, and makes the number correct even if the break
   length varies by shift (e.g. Morning gets 1hr, Night gets 30min).

---

## 5. Next-session checklist

- [x] Confirm with client: do employees clock in/out for lunch, or one continuous
      punch per day? **Answered: Scenario B — they clock out/in for lunch**, and they
      additionally want to know who takes more than the allowed break. See the
      Implemented addendum below.
- [ ] Confirm: do they want live OT visibility on the Logs screen, or is the
      payroll-period batch view enough? Still open — not built.
- [x] Break-limit tracking built (was "Automatic break deduction" in §4.2 above —
      turned out the actual need was *visibility/reporting* on break overage, not
      auto-deducting an unclocked break, since Scenario B means break time was
      already correctly excluded from worked hours). See addendum.
- [ ] Re-verify actual `standard_hours` configured for the client's real "Morning"
      shift in their DB (Attendance → Shifts) — should be `7` per Scenario B. Not
      yet confirmed against their live config; this is data entry, not code, once
      confirmed.
- [ ] Remind the client to click "Recompute Late Status" (Device Settings) after
      deploying the late-detection fix — past data does not correct itself.

---

## 6. Implemented 2026-08-18 — break-limit tracking

Built on branch `claude/break-limit-tracking` (separate from the late-detection fix
PR, since it's an unrelated feature).

- **Migration `0019_break_limit.sql`**: `shifts.break_minutes` (allowed rest/lunch
  duration, default 60 min) and `daily_attendance_records.break_minutes_over` (0 when
  within the allowance, otherwise minutes exceeded).
- **`attendanceProcessor.ts` Stage 10**: computes the actual gap between consecutive
  IN/OUT sessions on the same day as the break taken (populates the pre-existing but
  previously-always-0 `break_hours` field), and flags `break_minutes_over` against the
  employee's shift allowance (falls back to 60 min if no shift assigned). This is
  purely a visibility figure — it does **not** further reduce `regular_hours`/`ot_hours`,
  since break time was already correctly excluded (it's the gap between sessions, never
  inside one).
- **Bug found and fixed while adding this**: `attendanceProcessor.ts`'s late/early-out
  check used `if (empShift)` to mean "employee has an assigned shift" — but `empShift`
  comes from a `LEFT JOIN`, so the row is *always* truthy (one row per employee) even
  when no shift is assigned, with every `shifts.*` column coming back `null`. This meant
  `if (empShift)` was always true and crashed (`null.split(':')`) processing any period
  containing an employee with no shift assigned. Fixed by checking `empShift?.id != null`
  instead. Caught by the new break-limit test suite, not by any existing test.
- **New "Break Report" tab** (Attendance hub) mirroring the existing Late Report:
  per-employee days-over-limit / total-minutes-over / avg-minutes-over for a chosen
  month. Only employees who exceeded their break at least once appear.
- **Payroll Periods → View Records**: added a Break column (hours taken, with an
  over-limit amount highlighted in orange when applicable).
- **Shift form** (Attendance → Shifts): new "Allowed Break (minutes)" field, default 60.
- **Tests**: 4 new tests in `attendanceProcessorBreak.test.ts` (over-limit flagged,
  within-limit not flagged, single continuous session → zero break, no-shift fallback
  to the 60-min default — this last one is what caught the `if (empShift)` bug above).
- **Verified**: `npm run typecheck` clean (both tsconfigs), `npm run build` clean (all 3
  bundles), `npm run test` — 51/51 pass (47 pre-existing + 4 new).
- **Not yet verified**: the app has not been launched and clicked through (Shift form's
  new field, Break Report tab, Payroll Periods Break column) — needs the
  launch-confirmation step like every other phase. Also still needs the client to
  confirm their real Morning shift's `standard_hours` is set to `7` (Scenario B).

---

## 7. Reviewed 2026-08-27 — OT logic audit, three bugs fixed

The project owner asked for a full review of the OT calculation. **The OT arithmetic
described in §2 above was confirmed correct** — elapsed clocked hours vs.
`shifts.standard_hours`, then the configured OT rule. Three bugs *around* it were not.
All three were reproduced against a real in-memory DB before any code changed. Full
write-up in `CLAUDE.md`'s Decision Log; summary:

1. **Work on a rest day or public holiday was paid RM0.** A 9-hour Sunday punch
   recorded `total_clocked_hours: 9` but `regular_hours: 0, ot_hours: 0` — Stage 10
   only credited hours for `present`/`late`/`early_out`. Fixed via migration `0021`:
   new `rest_day_hours`/`rest_day_ot_hours`/`holiday_hours`/`holiday_ot_hours` columns
   plus four configurable multipliers in Payroll Settings, seeded to the EA 1955
   minimums. The statutory half-day/full-day rest-day tiers are encoded as **hours** in
   the processing engine so payroll stays `hours × rate × multiplier`.

2. **Daily-rate employees on a six-day week lost ~19% of pay.** `workingDaysInRange`
   hardcoded Mon–Fri and the `Math.min(days_worked, workingDays)` cap then discarded
   the Saturdays (RM1,680 paid instead of RM2,080 in the repro). Replaced with
   `workingDaysForEmployeeInRange`, which delegates to `resolveCalendarDay` — the
   calendar module's own resolver — per employee.

3. **Payroll read a dead holiday table.** `getPublicHolidayDatesInRange` queried
   `public_holidays` (no dates past 2025, nothing writes to it) instead of
   `calendar_events`. Deleted; same delegation as above.

Also: the default OT rule for **new installs** changed from `flat_addition` RM0.50 to
`multiplier` 1.5 (EA 1955 s.60A minimum). Existing installs keep their configured rule
— Payroll → Settings now warns inline when it is below the minimum.

### Still open after this review

- [ ] **Unworked public holidays pay 0** for daily/hourly employees. EA 1955 entitles
      employees to paid gazetted holidays — likely a further gap, but a separate
      entitlement question (which holidays, pro-ration, eligibility) that was out of
      scope for an OT review.
- [ ] **Two sources of truth for "standard hours per day"** remain: the OT threshold
      uses `shifts.standard_hours`, the daily-rate hourly rate divides by
      `salary_structures.standard_hours_per_day`. Setting the shift to `7` (Scenario B
      in §3) while leaving the salary structure at `8` produces one hour of phantom OT
      every normal day. Consolidating the two is a schema decision, not a bug fix — but
      §5's "re-verify the client's real Morning shift `standard_hours`" checklist item
      is now *more* urgent, not less.
- [ ] **Daily-rate employees get a full day's pay for a partial day** (`days_worked`
      counts any present day regardless of hours). Intentional for a daily rate; worth
      confirming against the employer's policy.
- [ ] Live OT visibility on the Logs screen — unchanged, still not built (§4.1).
