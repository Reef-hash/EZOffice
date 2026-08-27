import { describe, it, expect } from 'vitest'
import { calculatePay, type OtRule } from '../payroll/calculationEngine'
import type { EmployeeMonthlySummary } from '../../../src/shared/types/entities'

// Real client scenario (docs/COMMISSION_PAYROLL_PLAN.md):
//   Trip total RM12,690 x 20% = RM2,538 commission, no base salary.
//   EPF/SOCSO/EIS must be calculated off a fixed RM1,700 contribution base,
//   never off the RM2,538 commission itself, and RM1,700 must never be added
//   to gross pay.

const otRule: OtRule = { ot_rule_type: 'multiplier', ot_rule_value: 1.5 }

const commissionOnlyStruct = {
  rate_type: 'commission_only' as const,
  rate_amount: 1700, // recurring default statutory base, NOT a salary
  standard_hours_per_day: 8,
  subject_to_epf: 1,
  subject_to_socso: 1,
  subject_to_eis: 1,
}

const zeroSummary: EmployeeMonthlySummary = {
  employee_id: 1,
  total_regular_hours: 0,
  total_ot_hours: 0,
  days_worked: 0,
}

describe('calculatePay — commission-only employee', () => {
  it('gross pay is the commission amount only, no base salary added', () => {
    const result = calculatePay({
      summary: zeroSummary,
      structure: commissionOnlyStruct,
      otRule,
      epfRate: null,
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 2538, // RM12,690 x 20%
    })

    expect(result.commission).toBe(2538)
    expect(result.gross_regular_pay).toBe(0)
    expect(result.gross_ot_pay).toBe(0)
    expect(result.gross_pay).toBe(2538) // NOT 1700 + 2538 = 4238
  })

  it('ignores hours/OT entirely, even if attendance data is present', () => {
    const result = calculatePay({
      summary: { employee_id: 1, total_regular_hours: 160, total_ot_hours: 10, days_worked: 22 },
      structure: commissionOnlyStruct,
      otRule,
      epfRate: null,
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 2538,
    })

    expect(result.total_regular_hours).toBe(0)
    expect(result.total_ot_hours).toBe(0)
    expect(result.gross_pay).toBe(2538)
  })

  it('EPF/SOCSO/EIS are calculated off the explicit statutory base, not the commission', () => {
    const result = calculatePay({
      summary: zeroSummary,
      structure: commissionOnlyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: { employee_contribution: 29.75, employer_contribution: 69.15 },
      eisRate: { employee_contribution: 7.25, employer_contribution: 10.9 },
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 2538,
      statutoryBase: 1700,
    })

    // EPF employee = 1700 * 11% = 187, NOT 2538 * 11% = 279.18
    expect(result.statutory_base).toBe(1700)
    expect(result.statutory.epf_employee).toBe(187)
    expect(result.statutory.epf_employer).toBe(221)
    // SOCSO/EIS come from the already-resolved bracket (fixed amounts), unaffected
    expect(result.statutory.socso_employee).toBe(29.75)
    expect(result.statutory.eis_employee).toBe(7.25)
    // Net pay deducts from the RM2,538 gross, not RM1,700
    expect(result.gross_pay).toBe(2538)
    expect(result.net_pay).toBe(2538 - 187 - 29.75 - 7.25)
  })

  it('falls back to gross pay as the statutory base when no override is supplied', () => {
    const result = calculatePay({
      summary: zeroSummary,
      structure: commissionOnlyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 2538,
      // no statutoryBase override supplied
    })

    expect(result.statutory_base).toBe(2538)
    // KWSP banding: 2538 -> banded up to 2540 -> 2540 * 11% = 279.4 -> ceil -> 280.
    expect(result.statutory.epf_employee).toBe(280)
  })

  it('does not change existing (non commission-only) statutory calculation behavior', () => {
    const dailyStruct = {
      rate_type: 'daily' as const,
      rate_amount: 80,
      standard_hours_per_day: 8,
      subject_to_epf: 1,
      subject_to_socso: 0,
      subject_to_eis: 0,
    }

    const result = calculatePay({
      summary: { employee_id: 1, total_regular_hours: 0, total_ot_hours: 0, days_worked: 20 },
      structure: dailyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 0,
      workingDaysInMonth: 22,
      // statutoryBase intentionally omitted — must default to actual gross pay
    })

    // gross = 80 * 20 = 1600; EPF = 1600 * 11% = 176 (unchanged pre-existing behavior)
    expect(result.gross_pay).toBe(1600)
    expect(result.statutory_base).toBe(1600)
    expect(result.statutory.epf_employee).toBe(176)
  })
})
