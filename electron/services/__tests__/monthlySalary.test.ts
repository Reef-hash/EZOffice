import { describe, it, expect } from 'vitest'
import { calculatePay, type OtRule } from '../payroll/calculationEngine'
import type { EmployeeMonthlySummary } from '../../../src/shared/types/entities'

const defaultSummary: EmployeeMonthlySummary = {
  employee_id: 1,
  total_regular_hours: 0,
  total_ot_hours: 0,
  days_worked: 0,
}

const otRule: OtRule = { ot_rule_type: 'multiplier', ot_rule_value: 1.5 }

const monthlyStruct = {
  rate_type: 'monthly' as const,
  rate_amount: 1700,
  standard_hours_per_day: 8,
  subject_to_epf: 1,
  subject_to_socso: 1,
  subject_to_eis: 1,
}

describe('calculatePay — monthly salary', () => {
  it('returns gross = fixed monthly salary, ignores hours and OT', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: monthlyStruct,
      otRule,
      epfRate: null,
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
    })

    expect(result.gross_regular_pay).toBe(1700)
    expect(result.gross_ot_pay).toBe(0)
    expect(result.gross_pay).toBe(1700)
    expect(result.total_regular_hours).toBe(0)
    expect(result.total_ot_hours).toBe(0)
  })

  it('applies EPF percentage on the fixed monthly salary', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: { ...monthlyStruct, subject_to_epf: 1 },
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
    })

    // EPF employee = 1700 * 11% = 187.00
    expect(result.statutory.epf_employee).toBe(187)
    expect(result.statutory.epf_employer).toBe(221)
    // net = 1700 - 187 = 1513
    expect(result.net_pay).toBe(1513)
  })

  it('applies SOCSO and EIS fixed-amount deductions alongside EPF', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: monthlyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: { employee_contribution: 29.75, employer_contribution: 69.15 },
      eisRate: { employee_contribution: 7.25, employer_contribution: 10.90 },
      pcbBracket: null,
      advanceDeduction: 0,
    })

    expect(result.statutory.socso_employee).toBe(29.75)
    expect(result.statutory.eis_employee).toBe(7.25)
    // net = 1700 - 187 - 29.75 - 7.25 = 1476
    expect(result.net_pay).toBe(1476)
  })

  it('applies PCB bracket deduction on the fixed salary', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: monthlyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: { id: 1, effective_from: '2026-01-01', category: 'single', children_count: 0, chargeable_income_from: 0, chargeable_income_to: 2500, tax_amount: 0, created_at: '', updated_at: '' },
      advanceDeduction: 0,
    })
    // PCB tax = 0 for income ≤ 2500
    expect(result.statutory.pcb).toBe(0)
  })

  it('can opt out of statutory deductions via subject_to flags', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: { ...monthlyStruct, subject_to_epf: 0, subject_to_socso: 0, subject_to_eis: 0 },
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: { employee_contribution: 29.75, employer_contribution: 69.15 },
      eisRate: { employee_contribution: 7.25, employer_contribution: 10.90 },
      pcbBracket: null,
      advanceDeduction: 0,
    })

    expect(result.statutory.epf_employee).toBe(0)
    expect(result.statutory.socso_employee).toBe(0)
    expect(result.statutory.eis_employee).toBe(0)
    expect(result.net_pay).toBe(1700)
  })

  it('subtracts salary advance deduction from net pay', () => {
    const result = calculatePay({
      summary: defaultSummary,
      structure: monthlyStruct,
      otRule,
      epfRate: { employee_contribution_pct: 11, employer_contribution_pct: 13 },
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 200,
    })
    // gross = 1700, EPF = 187, advance = 200, net = 1700 - 187 - 200 = 1313
    expect(result.net_pay).toBe(1313)
  })

  it('gross pay is unaffected by hours summary — hours ignored when monthly', () => {
    const result = calculatePay({
      summary: { employee_id: 1, total_regular_hours: 999, total_ot_hours: 888, days_worked: 999 },
      structure: monthlyStruct,
      otRule,
      epfRate: null,
      socsoRate: null,
      eisRate: null,
      pcbBracket: null,
      advanceDeduction: 0,
    })
    expect(result.gross_pay).toBe(1700)
  })
})
