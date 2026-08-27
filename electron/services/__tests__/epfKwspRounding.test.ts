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
import type { EmployeeMonthlySummary } from '../../../src/shared/types/entities'

const otRule: OtRule = { ot_rule_type: 'multiplier', ot_rule_value: 1.5 }

const monthlyStruct = {
  rate_type: 'monthly' as const,
  rate_amount: 1764.72,
  standard_hours_per_day: 8,
  subject_to_epf: 1,
  subject_to_socso: 1,
  subject_to_eis: 1,
}

const defaultSummary: EmployeeMonthlySummary = {
  employee_id: 1,
  total_regular_hours: 0,
  total_ot_hours: 0,
  days_worked: 0,
}

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
})
