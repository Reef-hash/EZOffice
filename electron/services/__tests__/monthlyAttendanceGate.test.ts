// Coverage for rate_type='monthly' + attendance_required=1 (migration 0022,
// "Basic tetap + syarat attendance" — CLAUDE.md decision log 2026-08-27).
//
// Pure calculationEngine-level tests: the derived hourly rate (EA 1955 Second
// Schedule formula) is computed by the caller (payrollRun.ts's
// deriveMonthlyHourlyRate) and passed in as monthlyHourlyRate, so these tests fix it
// to a known value rather than re-deriving it — that derivation has its own coverage
// in monthlyAttendanceGateIntegration.test.ts, which exercises the real Company
// Calendar lookup end to end.
import { describe, it, expect } from 'vitest'
import { calculatePay, type OtRule } from '../payroll/calculationEngine'
import { makeSummary } from './helpers/summary'

const otRule: OtRule = { ot_rule_type: 'multiplier', ot_rule_value: 1.5 }

const gatedStruct = {
  rate_type: 'monthly' as const,
  rate_amount: 1700,
  standard_hours_per_day: 8, // unused by the monthly branch — only shift hours matter
  subject_to_epf: 1,
  subject_to_socso: 1,
  subject_to_eis: 1,
  attendance_required: 1,
}

describe('calculatePay — monthly + attendance_required', () => {
  it('pays the full basic when there is no shortfall', () => {
    const result = calculatePay({
      summary: makeSummary({ total_required_hours: 176, total_shortfall_hours: 0 }),
      structure: gatedStruct,
      otRule,
      epfRate: null, socsoRate: null, eisRate: null, pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 8.17,
    })

    expect(result.basic_salary_snapshot).toBe(1700)
    expect(result.attendance_shortfall_hours).toBe(0)
    expect(result.attendance_shortfall_amount).toBe(0)
    expect(result.gross_regular_pay).toBe(1700)
    expect(result.gross_pay).toBe(1700)
  })

  it('deducts pro-rata by the hour for a partial shortfall — not a flat day', () => {
    // "Balik awal sikit": 0.5h short on one day.
    const result = calculatePay({
      summary: makeSummary({ total_shortfall_hours: 0.5 }),
      structure: gatedStruct,
      otRule,
      epfRate: null, socsoRate: null, eisRate: null, pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 8.17,
    })

    expect(result.attendance_shortfall_hours).toBe(0.5)
    expect(result.attendance_shortfall_amount).toBe(4.09) // 0.5 * 8.17, rounded
    expect(result.gross_regular_pay).toBe(1695.91) // 1700 - 4.09
    expect(result.basic_salary_snapshot).toBe(1700) // full contracted amount, unchanged
  })

  it('a full-day absence uses the SAME shortfall formula as a partial day — no special case', () => {
    // Absence = shortfall equal to that day's full required_hours (8h here), not a
    // separately-coded "missed a day" penalty.
    const result = calculatePay({
      summary: makeSummary({ total_shortfall_hours: 8 }),
      structure: gatedStruct,
      otRule,
      epfRate: null, socsoRate: null, eisRate: null, pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 8.17,
    })

    expect(result.attendance_shortfall_amount).toBe(65.36) // 8 * 8.17
    expect(result.gross_regular_pay).toBe(1634.64)
  })

  it('paid leave (annual/sick) credits full required hours upstream, so no shortfall reaches here', () => {
    // attendanceProcessor Stage 10 already sets regular_hours = required_hours for
    // annual/sick leave (2026-08-26 fix), so total_shortfall_hours is 0 for that day —
    // this test just confirms the calculation engine passes that straight through.
    const result = calculatePay({
      summary: makeSummary({ total_shortfall_hours: 0 }),
      structure: gatedStruct,
      otRule,
      epfRate: null, socsoRate: null, eisRate: null, pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 8.17,
    })

    expect(result.gross_regular_pay).toBe(1700)
  })

  it('pays OT on top of the basic, using the same derived hourly rate', () => {
    const result = calculatePay({
      summary: makeSummary({ total_ot_hours: 2 }),
      structure: gatedStruct,
      otRule, // multiplier 1.5x
      epfRate: null, socsoRate: null, eisRate: null, pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 8.17,
    })

    expect(result.gross_ot_pay).toBe(24.51) // 8.17 * 2 * 1.5
    expect(result.gross_regular_pay).toBe(1700) // basic untouched by OT
    expect(result.gross_pay).toBe(1724.51)
  })

  it('excludes OT from the EPF base but includes the (net-of-shortfall) basic — same rule as hourly/daily', () => {
    const result = calculatePay({
      summary: makeSummary({ total_shortfall_hours: 1, total_ot_hours: 2 }),
      structure: gatedStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null, eisRate: null, pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 8.17,
    })

    // Basic net of 1h shortfall = 1700 - 8.17 = 1691.83, banded to 1700 (nearest 20,
    // rounded up) per the KWSP table rule, then 11%/13% rounded up to the ringgit.
    expect(result.gross_regular_pay).toBe(1691.83)
    expect(result.statutory.epf_employee).toBe(187) // ceil(1700 * 0.11)
    expect(result.gross_ot_pay).toBeGreaterThan(0) // OT earned but not in the EPF base
  })

  it('pays rest-day work on top, using the derived hourly rate — separate from the basic', () => {
    const result = calculatePay({
      summary: makeSummary({ total_rest_day_hours: 8 }),
      structure: gatedStruct,
      otRule,
      epfRate: null, socsoRate: null, eisRate: null, pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 8.17,
    })

    expect(result.rest_day_pay).toBe(65.36) // 8 * 8.17 * 1.0 (rest-day ordinary multiplier)
    expect(result.gross_regular_pay).toBe(1700)
    expect(result.gross_pay).toBe(1765.36)
  })

  it('a plain monthly structure (attendance_required=0, the default) is completely unaffected', () => {
    const result = calculatePay({
      summary: makeSummary({ total_shortfall_hours: 40, total_ot_hours: 10 }), // would matter if gated
      structure: { ...gatedStruct, attendance_required: 0 },
      otRule,
      epfRate: null, socsoRate: null, eisRate: null, pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 8.17,
    })

    expect(result.gross_regular_pay).toBe(1700)
    expect(result.gross_ot_pay).toBe(0)
    expect(result.basic_salary_snapshot).toBe(0)
    expect(result.attendance_shortfall_amount).toBe(0)
  })
})
