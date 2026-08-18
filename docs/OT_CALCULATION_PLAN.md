# OT (Overtime) Calculation — Status & Plan

Written 2026-08-18 as a handoff note. Nothing in this document has been implemented
yet — it's a plan to pick up in a future session. No app code was changed to produce
this file.

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

- [ ] Confirm with client: do employees clock in/out for lunch, or one continuous
      punch per day? (Decides Scenario A vs B above — changes `standard_hours` config,
      not code.)
- [ ] Confirm: do they want live OT visibility on the Logs screen, or is the
      payroll-period batch view enough?
- [ ] If break isn't reliably clocked (Scenario A) and they want it modeled properly
      rather than fudging `standard_hours`: build `break_minutes` on `shifts`
      (migration + `attendanceProcessor.ts` Stage 5/10 change + Shift form UI field).
- [ ] Once decided, re-verify actual `standard_hours` value configured for the
      client's real "Morning" shift in their DB (Attendance → Shifts) — the numbers
      in this doc (7 vs 8) are illustrative, not confirmed against their live config.
- [ ] Remind the client to click "Recompute Late Status" (Device Settings) after
      deploying the late-detection fix — past data does not correct itself.
