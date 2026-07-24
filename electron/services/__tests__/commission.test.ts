import { describe, it, expect } from 'vitest'
import { calculatePay, type OtRule } from '../payroll/calculationEngine'
import type { EmployeeMonthlySummary } from '../../../src/shared/types/entities'

const otRule: OtRule = { ot_rule_type: 'multiplier', ot_rule_value: 1.5 }

const monthlyStruct = {
  rate_type: 'monthly' as const,
  rate_amount: 1700,
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

const summaryWithDays: EmployeeMonthlySummary = {
  employee_id: 1,
  total_regular_hours: 0,
  total_ot_hours: 5,
  days_worked: 20,
}

describe('calculatePay — ad-hoc commission', () => {
  it('adds commission on top of gross pay for a monthly employee', () => {
    const result = calculatePay({
      summary: { employee_id: 1, total_regular_hours: 0, total_ot_hours: 0, days_worked: 0 },
      structure: monthlyStruct,
      otRule,
      epfRate: null,
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 500,
    })

    expect(result.commission).toBe(500)
    expect(result.gross_regular_pay).toBe(1700)
    expect(result.gross_pay).toBe(2200)
  })

  it('folds commission into the EPF/SOCSO/EIS base, not just net pay', () => {
    const result = calculatePay({
      summary: { employee_id: 1, total_regular_hours: 0, total_ot_hours: 0, days_worked: 0 },
      structure: monthlyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: { employee_contribution: 29.75, employer_contribution: 69.15 },
      eisRate: { employee_contribution: 7.25, employer_contribution: 10.9 },
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 500,
    })

    // gross = 1700 + 500 = 2200; EPF employee = 2200 * 11% = 242
    expect(result.gross_pay).toBe(2200)
    expect(result.statutory.epf_employee).toBe(242)
    expect(result.statutory.epf_employer).toBe(286)
    // net = 2200 - 242 - 29.75 - 7.25 = 1921
    expect(result.net_pay).toBe(1921)
  })

  it('keeps commission out of gross_ot_pay for hourly/daily employees', () => {
    const result = calculatePay({
      summary: summaryWithDays,
      structure: dailyStruct,
      otRule,
      epfRate: null,
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
      commission: 300,
      workingDaysInMonth: 22,
    })

    // regular = 80 * 20 = 1600; OT = 5 * (80/8) * 1.5 = 75; commission = 300 (separate)
    expect(result.gross_regular_pay).toBe(1600)
    expect(result.gross_ot_pay).toBe(75)
    expect(result.commission).toBe(300)
    expect(result.gross_pay).toBe(1975)
  })

  it('defaults to zero commission when omitted (backward-compatible)', () => {
    const result = calculatePay({
      summary: { employee_id: 1, total_regular_hours: 0, total_ot_hours: 0, days_worked: 0 },
      structure: monthlyStruct,
      otRule,
      epfRate: null,
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
    })

    expect(result.commission).toBe(0)
    expect(result.gross_pay).toBe(1700)
  })
})
