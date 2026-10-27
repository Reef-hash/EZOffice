// Regression: EPF was computed as a plain (wage × rate) rounded to nearest ringgit,
// not matching KWSP's real published contribution table (Third Schedule). Reported
// by the project owner comparing a real payslip against the official KWSP table:
// regular pay RM1,764.72 showed EPF RM194.12/RM229.41 in the app but RM196/RM232 on
// KWSP's table.
//
// KWSP bands monthly wages (up to RM20,000) into RM20 increments and computes the
// contribution as (band's upper limit × rate), rounded UP to the next ringgit — not
// the exact wage rounded to nearest. See calcEpfContribution in calculationEngine.ts.
import { describe, it, expect } from 'vitest'
import { calculatePay, type OtRule } from '../payroll/calculationEngine'
import { makeSummary } from './helpers/summary'

const otRule: OtRule = { ot_rule_type: 'multiplier', ot_rule_value: 1.5 }

const monthlyStruct = {
  rate_type: 'monthly' as const,
  rate_amount: 1764.72,
  standard_hours_per_day: 8,
  subject_to_epf: 1,
  subject_to_socso: 1,
  subject_to_eis: 1,
}

const defaultSummary = makeSummary()

describe('calculatePay — EPF matches the real KWSP contribution table', () => {
  it('reproduces the exact reported KWSP figures for RM1,764.72', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: monthlyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
    })

    // KWSP's real table value for this wage band (RM1,760.01-RM1,780.00): 196/232.
    expect(result.statutory.epf_employee).toBe(196)
    expect(result.statutory.epf_employer).toBe(232)
  })

  it('does not band above the RM20,000 threshold (unchanged, cent-precision)', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: { ...monthlyStruct, rate_amount: 25000.10 },
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 12 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
    })

    // Above RM20,000: exact wage × rate to the cent, same as before this fix.
    expect(result.statutory.epf_employee).toBe(2750.01)
    expect(result.statutory.epf_employer).toBe(3000.01)
  })

  it('leaves an already-whole banded wage unaffected', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: { ...monthlyStruct, rate_amount: 1700 },
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
    })

    // 1700 is already a multiple of 20; 1700*11%=187, 1700*13%=221 exactly.
    expect(result.statutory.epf_employee).toBe(187)
    expect(result.statutory.epf_employer).toBe(221)
  })

  it('exposes the actual wage base (before banding) so the payslip can show what to key into KWSP', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: { ...monthlyStruct, rate_amount: 1700 },
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
    })

    expect(result.epf_wage_base).toBe(1700)
  })

  it('EPF is on the contractual basic, not the basic net of the attendance shortfall', () => {
    // Decided 2026-10-27: a monthly + attendance_required employee's EPF follows the
    // contracted wage. A 49-sen shortfall used to show a 1699.51 base on the payslip;
    // the base is now the full 1700 whatever the shortfall.
    const result = calculatePay({
      summary: makeSummary({ total_shortfall_hours: 0.05 }), // ~49 sen at a ~RM9.80/hr derived rate
      structure: { ...monthlyStruct, rate_amount: 1700, attendance_required: 1 },
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 9.8,
    })

    expect(result.attendance_shortfall_amount).toBeCloseTo(0.49, 2)
    expect(result.gross_regular_pay).toBeCloseTo(1699.51, 2) // pay is still reduced
    expect(result.epf_wage_base).toBe(1700)
    expect(result.statutory.epf_employee).toBe(187)
  })

  it('a large shortfall does not lower EPF either', () => {
    // 40 hours short at RM9.80/h = RM392 off the pay. On the old net-of-shortfall base
    // EPF would have been banded from RM1,308, i.e. RM144/RM170 instead of RM187/RM221.
    const result = calculatePay({
      summary: makeSummary({ total_shortfall_hours: 40 }),
      structure: { ...monthlyStruct, rate_amount: 1700, attendance_required: 1 },
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      monthlyHourlyRate: 9.8,
    })

    expect(result.attendance_shortfall_amount).toBe(392)
    expect(result.gross_regular_pay).toBe(1308)
    expect(result.epf_wage_base).toBe(1700)
    expect(result.statutory.epf_employee).toBe(187)
    expect(result.statutory.epf_employer).toBe(221)
  })
})
