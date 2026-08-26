// Regression: EPF contribution was computed as a percentage of grossPay
// (grossRegularPay + grossOtPay + commission), incorrectly including overtime pay.
// EPF Act 1991 Third Schedule excludes overtime payments from EPF "wages" (it does
// include commission — see the 2026-07-24 commission decision, unaffected by this
// fix). Reported by the project owner: "epf socso hanya dipotong hanya atas regular
// pay bukan termasuk ot". SOCSO/EIS were already correct — their bracket lookup uses
// a contract-based monthlyWage estimate that never included actual worked OT hours
// in the first place — so this fix is EPF-only.
import { describe, it, expect } from 'vitest'
import { calculatePay, type OtRule } from '../payroll/calculationEngine'
import type { EmployeeMonthlySummary } from '../../../src/shared/types/entities'

const otRule: OtRule = { ot_rule_type: 'multiplier', ot_rule_value: 1.5 }

const hourlyStruct = {
  rate_type: 'hourly' as const,
  rate_amount: 10,
  standard_hours_per_day: 8,
  subject_to_epf: 1,
  subject_to_socso: 1,
  subject_to_eis: 1,
}

const dailyStruct = {
  rate_type: 'daily' as const,
  rate_amount: 80,
  standard_hours_per_day: 8,
  subject_to_epf: 1,
  subject_to_socso: 1,
  subject_to_eis: 1,
}

describe('calculatePay — EPF excludes overtime pay', () => {
  it('computes EPF on regular pay only for an hourly employee with OT', () => {
    const summary: EmployeeMonthlySummary = {
      employee_id: 1,
      total_regular_hours: 160,
      total_ot_hours: 20,
      days_worked: 20,
    }
    const result = calculatePay({
      summary,
      structure: hourlyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
    })

    // regular = 160 * 10 = 1600; OT = 20 * 10 * 1.5 = 300; gross = 1900
    expect(result.gross_regular_pay).toBe(1600)
    expect(result.gross_ot_pay).toBe(300)
    expect(result.gross_pay).toBe(1900)

    // EPF must be 11% of 1600 (regular only) = 176, NOT 11% of 1900 = 209
    expect(result.statutory.epf_employee).toBe(176)
    expect(result.statutory.epf_employer).toBe(208)
  })

  it('includes commission but still excludes OT from the EPF base', () => {
    const summary: EmployeeMonthlySummary = {
      employee_id: 1,
      total_regular_hours: 160,
      total_ot_hours: 10,
      days_worked: 20,
    }
    const result = calculatePay({
      summary,
      structure: hourlyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 200,
    })

    // regular = 1600, OT = 10 * 10 * 1.5 = 150, commission = 200, gross = 1950
    expect(result.gross_pay).toBe(1950)
    // EPF base = regular (1600) + commission (200) = 1800, excluding OT (150)
    expect(result.statutory.epf_employee).toBe(198) // 1800 * 11%
    expect(result.statutory.epf_employer).toBe(234) // 1800 * 13%
  })

  it('computes EPF on regular pay only for a daily-rate employee with OT', () => {
    const summary: EmployeeMonthlySummary = {
      employee_id: 1,
      total_regular_hours: 0,
      total_ot_hours: 5,
      days_worked: 20,
    }
    const result = calculatePay({
      summary,
      structure: dailyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      workingDaysInMonth: 22,
    })

    // regular = 80 * 20 = 1600; OT = 5 * (80/8) * 1.5 = 75; gross = 1675
    expect(result.gross_regular_pay).toBe(1600)
    expect(result.gross_ot_pay).toBe(75)
    expect(result.gross_pay).toBe(1675)

    // EPF must be 11% of 1600, NOT 11% of 1675
    expect(result.statutory.epf_employee).toBe(176)
    expect(result.statutory.epf_employer).toBe(208)
  })
})
