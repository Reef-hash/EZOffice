// Unit tests for aggregateDailyHours — the pure per-day aggregation logic (C1+C3).
// These tests verify the DEVICE_SYNC_AUDIT.md C1/C3 fixes without requiring a real DB
// (better-sqlite3 is compiled against Electron's Node and cannot load under system Node).
//
// Tested scenarios:
//   - Split-day (lunch break) counted as 1 day, not 2
//   - Evening OT session: hours aggregate per day → correct OT
//   - Orphan punches produce 0 hours, 0 days
//   - Month totals are accurate
//   - Cross-midnight month boundary
//   - Approved leave day filtering (per pair, not per punch)
//   - Session cap

import { describe, it, expect } from 'vitest'
import { aggregateDailyHours, type PunchLog } from '../attendanceSummary'

// ── Helpers ───────────────────────────────────────────────────────────────────

function noLeave(): Set<string> { return new Set<string>() }

const MONTH_START = '2026-07-01'
const MONTH_END   = '2026-07-31'
const STD_HOURS   = 8
const MAX_SESSION = 16

function run(logs: PunchLog[], opts?: {
  leaveDates?: Set<string>
  maxSession?: number
  std?: number
  start?: string
  end?: string
}) {
  return aggregateDailyHours(
    logs,
    opts?.start ?? MONTH_START,
    opts?.end   ?? MONTH_END,
    opts?.std   ?? STD_HOURS,
    opts?.leaveDates ?? noLeave(),
    opts?.maxSession ?? MAX_SESSION,
  )
}

function punch(type: 'in' | 'out', timestamp: string): PunchLog {
  return { type, timestamp }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('aggregateDailyHours', () => {

  describe('C1 fix: split day (lunch break)', () => {
    it('counts 1 day and 8 h regular for two IN→OUT pairs on the same day', () => {
      // Bug before fix: 2 pairs = 2 days_worked (double-paid for one day of work)
      const result = run([
        punch('in',  '2026-07-01T08:00:00'),
        punch('out', '2026-07-01T12:00:00'), // 4h
        punch('in',  '2026-07-01T13:00:00'),
        punch('out', '2026-07-01T17:00:00'), // 4h
      ])
      expect(result.days_worked).toBe(1)
      expect(result.total_regular_hours).toBe(8)   // 4+4=8, all regular
      expect(result.total_ot_hours).toBe(0)
    })

    it('produces correct totals for 5 days of split-day work', () => {
      const logs: PunchLog[] = []
      for (let day = 1; day <= 5; day++) {
        const d = String(day).padStart(2, '0')
        logs.push(punch('in',  `2026-07-${d}T08:00:00`))
        logs.push(punch('out', `2026-07-${d}T12:00:00`))
        logs.push(punch('in',  `2026-07-${d}T13:00:00`))
        logs.push(punch('out', `2026-07-${d}T17:00:00`))
      }
      const result = run(logs)
      expect(result.days_worked).toBe(5)
      expect(result.total_regular_hours).toBe(40) // 5 × 8h
      expect(result.total_ot_hours).toBe(0)
    })
  })

  describe('C3 fix: evening OT session', () => {
    it('classifies daily hours beyond standard as OT', () => {
      // Bug before fix: 19:00–22:00 pair is 3h ≤ standard 8h → counted as regular
      // After fix: day total = 9h + 3h = 12h → 8h regular + 4h OT
      const result = run([
        punch('in',  '2026-07-01T08:00:00'),
        punch('out', '2026-07-01T17:00:00'), // 9h
        punch('in',  '2026-07-01T19:00:00'),
        punch('out', '2026-07-01T22:00:00'), // 3h
      ])
      expect(result.days_worked).toBe(1)
      expect(result.total_regular_hours).toBe(8)
      expect(result.total_ot_hours).toBe(4) // 9+3=12 → 4h OT
    })

    it('handles a single-session long day', () => {
      // 08:00–18:00 = 10h → 8h regular + 2h OT
      const result = run([
        punch('in',  '2026-07-15T08:00:00'),
        punch('out', '2026-07-15T18:00:00'),
      ])
      expect(result.days_worked).toBe(1)
      expect(result.total_regular_hours).toBe(8)
      expect(result.total_ot_hours).toBe(2)
    })

    it('correctly sums OT across multiple days', () => {
      // Day 1: 10h (2h OT), Day 2: 8h (0 OT)
      const result = run([
        punch('in',  '2026-07-01T08:00:00'),
        punch('out', '2026-07-01T18:00:00'), // 10h → 2h OT
        punch('in',  '2026-07-02T08:00:00'),
        punch('out', '2026-07-02T16:00:00'), // 8h → 0 OT
      ])
      expect(result.days_worked).toBe(2)
      expect(result.total_regular_hours).toBe(16) // 8+8
      expect(result.total_ot_hours).toBe(2)
    })
  })

  describe('orphan punches', () => {
    it('produces 0 hours and 0 days for a lone IN with no OUT', () => {
      const result = run([punch('in', '2026-07-01T08:00:00')])
      expect(result.days_worked).toBe(0)
      expect(result.total_regular_hours).toBe(0)
      expect(result.total_ot_hours).toBe(0)
    })

    it('produces 0 hours for a lone OUT with no IN', () => {
      const result = run([punch('out', '2026-07-01T17:00:00')])
      expect(result.days_worked).toBe(0)
      expect(result.total_regular_hours).toBe(0)
    })

    it('discards the first IN when a second IN arrives before an OUT', () => {
      // Double IN (forgot to punch out): 08:00 IN is orphaned; 08:05 IN + 17:00 OUT counts
      const result = run([
        punch('in',  '2026-07-01T08:00:00'),
        punch('in',  '2026-07-01T08:05:00'), // replaces the first IN
        punch('out', '2026-07-01T17:00:00'),
      ])
      // 08:05 → 17:00 = 8h55m ≈ 8.917h → 8h regular, ~0.92h OT
      expect(result.days_worked).toBe(1)
      expect(result.total_regular_hours).toBe(8)
      expect(result.total_ot_hours).toBeCloseTo(8 + 55/60 - 8, 1)
    })
  })

  describe('month totals', () => {
    it('correctly sums 20 working days with lunch breaks', () => {
      const workDays = [1,2,3,4,7,8,9,10,11,14,15,16,17,18,21,22,23,24,25,28]
      const logs: PunchLog[] = []
      for (const day of workDays) {
        const d = String(day).padStart(2, '0')
        logs.push(punch('in',  `2026-07-${d}T08:00:00`))
        logs.push(punch('out', `2026-07-${d}T12:00:00`))
        logs.push(punch('in',  `2026-07-${d}T13:00:00`))
        logs.push(punch('out', `2026-07-${d}T17:00:00`))
      }
      const result = run(logs)
      expect(result.days_worked).toBe(20)
      expect(result.total_regular_hours).toBe(160) // 20 × 8h
      expect(result.total_ot_hours).toBe(0)
    })

    it('returns empty result for an empty log array', () => {
      const result = run([])
      expect(result.days_worked).toBe(0)
      expect(result.total_regular_hours).toBe(0)
      expect(result.total_ot_hours).toBe(0)
    })

    it('aggregates independent work days correctly', () => {
      // 3 days, varied hours
      const result = run([
        punch('in',  '2026-07-01T08:00:00'),
        punch('out', '2026-07-01T16:00:00'), // 8h → 0 OT
        punch('in',  '2026-07-02T08:00:00'),
        punch('out', '2026-07-02T19:00:00'), // 11h → 3h OT
        punch('in',  '2026-07-03T09:00:00'),
        punch('out', '2026-07-03T14:00:00'), // 5h → 0 OT
      ])
      expect(result.days_worked).toBe(3)
      expect(result.total_regular_hours).toBe(21) // 8+8+5
      expect(result.total_ot_hours).toBe(3)
    })
  })

  describe('cross-midnight month boundary (M1)', () => {
    it('captures IN on last day of month paired with OUT on first day of next month', () => {
      // Night shift: IN July 31st 22:00, OUT Aug 1st 06:00 = 8h
      // We pass logs including the Aug 1st OUT (±1 day margin handled by DB query layer)
      const result = run(
        [
          punch('in',  '2026-07-31T22:00:00'),
          punch('out', '2026-08-01T06:00:00'),
        ],
        { start: '2026-07-01', end: '2026-07-31' },
      )
      // The pair's IN date is July 31st → attributed to July → counted in July
      expect(result.days_worked).toBe(1)
      expect(result.total_regular_hours).toBe(8)
    })

    it('does NOT count the pair in the following month', () => {
      // When running for August, the IN on July 31st is before monthStart
      const result = run(
        [
          punch('in',  '2026-07-31T22:00:00'),
          punch('out', '2026-08-01T06:00:00'),
        ],
        { start: '2026-08-01', end: '2026-08-31' },
      )
      // IN date = July 31st → before August monthStart → excluded
      expect(result.days_worked).toBe(0)
    })
  })

  describe('approved leave day filtering', () => {
    it('excludes a pair whose IN date is on a leave day', () => {
      const leave = new Set(['2026-07-01'])
      const result = run([
        punch('in',  '2026-07-01T08:00:00'),
        punch('out', '2026-07-01T16:00:00'),
      ], { leaveDates: leave })
      expect(result.days_worked).toBe(0)
      expect(result.total_regular_hours).toBe(0)
    })

    it('does NOT exclude a pair whose OUT date is on leave but IN date is not', () => {
      // Night shift: IN July 1st (not leave), OUT July 2nd (leave)
      // Pair attributed to July 1st (IN date) → should still count
      const leave = new Set(['2026-07-02'])
      const result = run([
        punch('in',  '2026-07-01T22:00:00'),
        punch('out', '2026-07-02T06:00:00'),
      ], { leaveDates: leave })
      expect(result.days_worked).toBe(1)
      expect(result.total_regular_hours).toBe(8)
    })
  })

  describe('session cap (D4)', () => {
    it('excludes a pair that exceeds max_session_hours', () => {
      // Valid: 8h. Over-cap: 18h (cap=12). Only the valid day counts.
      const result = run([
        punch('in',  '2026-07-01T08:00:00'),
        punch('out', '2026-07-01T16:00:00'), // 8h — valid
        punch('in',  '2026-07-02T06:00:00'),
        punch('out', '2026-07-03T00:00:00'), // 18h — over cap (12)
      ], { maxSession: 12 })
      expect(result.days_worked).toBe(1)
      expect(result.total_regular_hours).toBe(8)
    })

    it('includes a pair that is exactly at the cap', () => {
      // 16h pair should be included (cap is exclusive, i.e., > cap is excluded)
      const result = run([
        punch('in',  '2026-07-01T06:00:00'),
        punch('out', '2026-07-01T22:00:00'), // exactly 16h
      ], { maxSession: 16 })
      expect(result.days_worked).toBe(1)
      expect(result.total_regular_hours).toBe(8)
      expect(result.total_ot_hours).toBe(8)
    })
  })
})

