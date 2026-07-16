// Payroll Calculation Engine — pure function that computes gross → net pay.
// Takes hours + salary structure + OT rule + statutory rate lookups → PayCheckResult.
// No DB access — all rate data is passed in (testable, no hidden global).

import type { EmployeeMonthlySummary, PayCheckResult, StatutoryBreakdown, SalaryStructure, PcbBracket } from '../../../src/shared/types/entities'

export interface OtRule {
  ot_rule_type: 'flat_addition' | 'multiplier'
  ot_rule_value: number
}

/**
 * OT pay calculation per the OT rule.
 * - flat_addition: each OT hour pays rate + flat_amount (e.g. daily_rate + 0.50/hour)
 * - multiplier: each OT hour pays rate × multiplier (e.g. 1.5× hourly rate)
 */
function calcOtPay(
  hourlyRate: number,
  otHours: number,
  otRule: OtRule,
): number {
  if (otHours <= 0) return 0

  if (otRule.ot_rule_type === 'multiplier') {
    return otHours * hourlyRate * otRule.ot_rule_value
  }

  // flat_addition: add a fixed extra per OT hour on top of regular rate
  return otHours * (hourlyRate + otRule.ot_rule_value)
}

/**
 * PCB Schedule lookup (Malaysia PCB Schedule, simplified per CLAUDE.md §7 2026-06-26).
 * The bracket passed in was already selected by the caller for the employee's
 * chargeable income (see lookupPcbBracket) — this just returns its tax_amount.
 */
function calcPcb(bracket: PcbBracket | null): number {
  return bracket?.tax_amount ?? 0
}

export interface CalculationInput {
  summary: EmployeeMonthlySummary
  structure: Pick<SalaryStructure, 'rate_type' | 'rate_amount' | 'standard_hours_per_day' | 'subject_to_epf' | 'subject_to_socso' | 'subject_to_eis'>
  otRule: OtRule
  epfRate: { employee_contribution_pct: number; employer_contribution_pct: number } | null
  socsoRate: { employee_contribution: number; employer_contribution: number } | null
  eisRate: { employee_contribution: number; employer_contribution: number } | null
  pcbBracket: PcbBracket | null
  advanceDeduction: number
  /** Number of working days in the month (for daily rate → monthly conversion) */
  workingDaysInMonth?: number
}

/**
 * Pure function: compute one employee's pay for a single payroll run.
 * All side-effect data (rate lookups, advance balance) is passed in.
 */
export function calculatePay(input: CalculationInput): PayCheckResult {
  const { summary, structure, otRule, workingDaysInMonth } = input

  // ── Monthly salary branch ──
  // Gross pay = fixed monthly salary. No hours-based math, no OT.
  if (structure.rate_type === 'monthly') {
    const grossPay = Math.round(structure.rate_amount * 100) / 100
    return buildResult(summary.employee_id, 0, 0, grossPay, grossPay, input)
  }

  // ── 1. Compute hourly rate ──
  let hourlyRate: number
  if (structure.rate_type === 'hourly') {
    hourlyRate = structure.rate_amount
  } else {
    // daily rate → hourly: daily_rate / standard_hours_per_day
    hourlyRate = structure.rate_amount / structure.standard_hours_per_day
  }

  // ── 2. Gross regular pay ──
  let grossRegularPay: number
  if (structure.rate_type === 'hourly') {
    grossRegularPay = summary.total_regular_hours * hourlyRate
  } else {
    // daily rate: rate × days worked (or rate × working days in month if summary.days_worked > working days)
    const days = workingDaysInMonth 
      ? Math.min(summary.days_worked, workingDaysInMonth)
      : summary.days_worked
    grossRegularPay = days * structure.rate_amount
  }

  // ── 3. Gross OT pay ──
  const grossOtPay = calcOtPay(hourlyRate, summary.total_ot_hours, otRule)

  // ── 4. Gross pay ──
  const grossPay = Math.round((grossRegularPay + grossOtPay) * 100) / 100

  return buildResult(summary.employee_id, summary.total_regular_hours, summary.total_ot_hours, grossRegularPay, grossPay, input)
}

/**
 * Build the final PayCheckResult from gross pay + statutory deductions.
 * Shared between the monthly-salary branch and the hourly/daily calculation path.
 */
function buildResult(
  employeeId: number,
  totalRegularHours: number,
  totalOtHours: number,
  grossRegularPay: number,
  grossPay: number,
  input: CalculationInput,
): PayCheckResult {
  const { structure, advanceDeduction } = input
  const grossOtPay = grossPay - grossRegularPay

  // Statutory deductions (only if subject + rate available)
  const statutory: StatutoryBreakdown = {
    epf_employee: 0,
    epf_employer: 0,
    socso_employee: 0,
    socso_employer: 0,
    eis_employee: 0,
    eis_employer: 0,
    pcb: 0,
  }

  if (structure.subject_to_epf && input.epfRate) {
    statutory.epf_employee = Math.round(grossPay * input.epfRate.employee_contribution_pct) / 100
    statutory.epf_employer = Math.round(grossPay * input.epfRate.employer_contribution_pct) / 100
  }

  if (structure.subject_to_socso && input.socsoRate) {
    statutory.socso_employee = input.socsoRate.employee_contribution
    statutory.socso_employer = input.socsoRate.employer_contribution
  }

  if (structure.subject_to_eis && input.eisRate) {
    statutory.eis_employee = input.eisRate.employee_contribution
    statutory.eis_employer = input.eisRate.employer_contribution
  }

  // PCB: simplified Schedule lookup — the bracket was already resolved by the caller
  // against an estimated chargeable income (gross - EPF employee). See CLAUDE.md §7.
  statutory.pcb = calcPcb(input.pcbBracket)

  // Net pay
  const totalDeductions = statutory.epf_employee + statutory.socso_employee + statutory.eis_employee + statutory.pcb + advanceDeduction
  const netPay = Math.round((grossPay - totalDeductions) * 100) / 100

  return {
    employee_id: employeeId,
    salary_structure_id: 0, // filled in by caller from the actual structure row
    total_regular_hours: totalRegularHours,
    total_ot_hours: totalOtHours,
    gross_regular_pay: Math.round(grossRegularPay * 100) / 100,
    gross_ot_pay: Math.round(grossOtPay * 100) / 100,
    gross_pay: Math.round(grossPay * 100) / 100,
    statutory,
    advance_deduction: advanceDeduction,
    net_pay: netPay,
  }
}
