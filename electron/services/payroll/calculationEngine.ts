// Payroll Calculation Engine — pure function that computes gross → net pay.
// Takes hours + salary structure + OT rule + statutory rate lookups → PayCheckResult.
// No DB access — all rate data is passed in (testable, no hidden global).

import type { EmployeeMonthlySummary, PayCheckResult, StatutoryBreakdown, SalaryStructure, PcbBracket } from '../../../src/shared/types/entities'

export interface OtRule {
  ot_rule_type: 'flat_addition' | 'multiplier'
  ot_rule_value: number
}

/**
 * Multipliers applied to the employee's ordinary hourly rate for work performed on a
 * rest day or a public/company holiday. Configurable in Payroll Settings; seeded to
 * the Employment Act 1955 minimums by migration 0021. See that migration's header for
 * how the "half day / full day" rest-day tiers are encoded as HOURS upstream, which is
 * why rest_day_multiplier is 1.0 rather than 2.0.
 */
export interface PremiumRates {
  rest_day_multiplier: number
  rest_day_ot_multiplier: number
  holiday_multiplier: number
  holiday_ot_multiplier: number
}

/** Employment Act 1955 minimums — used when a caller supplies no explicit rates. */
const DEFAULT_PREMIUM_RATES: PremiumRates = {
  rest_day_multiplier: 1.0,
  rest_day_ot_multiplier: 2.0,
  holiday_multiplier: 2.0,
  holiday_ot_multiplier: 3.0,
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
 * KWSP EPF Third Schedule contribution amount — NOT a plain (wage × rate) calculation.
 * For monthly wages up to RM20,000, KWSP's published contribution table bands wages
 * into RM20 increments ("wages exceed X but do not exceed X+20") and the amount for
 * each band is (the band's UPPER limit × rate), rounded UP to the next whole ringgit —
 * not rounded to nearest, and not applied to the exact wage.
 *
 * Confirmed against a real KWSP figure reported by the project owner: wage RM1,764.72
 * (11%/13% rates) — banded up to RM1,780 → 1780×11% = 195.80 → ceil → RM196 (KWSP's
 * real value); 1780×13% = 231.40 → ceil → RM232 (KWSP's real value). A plain
 * `Math.round(1764.72 × pct) / 100` gives RM194.12/RM229.41 — visibly wrong once
 * compared against the real contribution table, which is what prompted this fix.
 *
 * Above RM20,000/month, wages fall outside the published table's range — left as the
 * exact wage × rate (to the cent, same as before this fix) since that behavior was
 * never reported wrong and isn't independently confirmed against a real KWSP figure.
 */
function calcEpfContribution(wage: number, pct: number): number {
  if (wage <= 0 || pct <= 0) return 0
  if (wage > 20000) {
    return Math.round(wage * pct) / 100
  }
  const bandedWage = Math.ceil(wage / 20) * 20
  return Math.ceil((bandedWage * pct) / 100)
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
    & { attendance_required?: number; fixed_allowance?: number }
  otRule: OtRule
  /**
   * Hourly rate derived from the monthly wage for a rate_type='monthly' AND
   * attendance_required=1 structure — used for the attendance-shortfall deduction and
   * for OT/rest-day/holiday pay on top of the basic. Computed by the caller (see
   * deriveMonthlyHourlyRate in payrollRun.ts) using the EA 1955 Second Schedule
   * formula, which needs the employee's Company Calendar working-days-per-week — data
   * this function deliberately has no DB access to, staying pure. Unused for every
   * other rate_type/attendance_required combination.
   */
  monthlyHourlyRate?: number
  epfRate: { employee_contribution_pct: number; employer_contribution_pct: number } | null
  socsoRate: { employee_contribution: number; employer_contribution: number } | null
  eisRate: { employee_contribution: number; employer_contribution: number } | null
  pcbBracket: PcbBracket | null
  advanceDeduction: number
  /**
   * Ad-hoc sales commission for this employee on this run (entered per run, not
   * recurring — see electron/services/payroll/commissions.ts). Subject to
   * EPF/SOCSO/EIS/PCB same as basic wages (EPF Act 1991 Third Schedule lists
   * commission as wages; only OT, service charge, gratuity, traveling allowance,
   * director's fee, and retrenchment/termination benefits are excluded).
   */
  commission?: number
  /** Rest-day / public-holiday premium multipliers. Defaults to the EA 1955 minimums. */
  premiumRates?: PremiumRates
  /** Number of working days in the month (for daily rate → monthly conversion) */
  workingDaysInMonth?: number
  /**
   * Explicit override for the EPF/SOCSO/EIS calculation base. Used for
   * commission-only employees, where EPF/SOCSO/EIS must be calculated off a
   * fixed contribution base (e.g. RM1,700) rather than the commission itself
   * (e.g. RM2,538) — see docs/COMMISSION_PAYROLL_PLAN.md. When omitted, falls
   * back to the actual gross pay, which is the pre-existing behavior for
   * every other rate type and must not change.
   */
  statutoryBase?: number
}

/** Pay earned on rest days and public/company holidays, split ordinary vs overtime. */
interface PremiumPay {
  restDayOrdinary: number
  restDayOt: number
  holidayOrdinary: number
  holidayOt: number
}

const NO_PREMIUM_PAY: PremiumPay = {
  restDayOrdinary: 0,
  restDayOt: 0,
  holidayOrdinary: 0,
  holidayOt: 0,
}

/**
 * Pay for work performed on rest days and public/company holidays.
 * The HOURS were already tiered by the processing engine (a rest day worked beyond
 * half the normal hours is credited a full day's hours, etc.) — this only applies the
 * configured rate multipliers to them.
 */
function calcPremiumPay(
  hourlyRate: number,
  summary: EmployeeMonthlySummary,
  rates: PremiumRates,
): PremiumPay {
  return {
    restDayOrdinary: summary.total_rest_day_hours * hourlyRate * rates.rest_day_multiplier,
    restDayOt: summary.total_rest_day_ot_hours * hourlyRate * rates.rest_day_ot_multiplier,
    holidayOrdinary: summary.total_holiday_hours * hourlyRate * rates.holiday_multiplier,
    holidayOt: summary.total_holiday_ot_hours * hourlyRate * rates.holiday_ot_multiplier,
  }
}

/**
 * Pure function: compute one employee's pay for a single payroll run.
 * All side-effect data (rate lookups, advance balance) is passed in.
 */
export function calculatePay(input: CalculationInput): PayCheckResult {
  const { summary, structure, otRule, workingDaysInMonth } = input
  const commission = input.commission ?? 0

  // ── Monthly salary branch ──
  if (structure.rate_type === 'monthly') {
    if (structure.attendance_required) {
      // Basic salary gated on attendance (migration 0022, 2026-08-27 decision log).
      // EA 1955 s.60: full wages are only owed for days actually worked or on paid
      // leave — a shortfall against the required daily hours (shift.standard_hours,
      // snapshotted per day as daily_attendance_records.required_hours) is deducted
      // PRO-RATA BY THE HOUR, never as a flat "missed a day" penalty. An absence is
      // not a special case: it's just a day whose regular_hours is 0, so its
      // shortfall is the full required_hours — the same formula as "left 30 minutes
      // early". OT and rest-day/holiday work are paid ON TOP of the basic, using the
      // same derived hourly rate as the shortfall deduction — one rate, two uses,
      // never two separate numbers that could silently drift apart.
      const hourlyRate = input.monthlyHourlyRate ?? 0
      const basicSalary = Math.round(structure.rate_amount * 100) / 100
      const shortfallHours = Math.round(summary.total_shortfall_hours * 100) / 100
      const shortfallAmount = Math.round(shortfallHours * hourlyRate * 100) / 100
      const grossRegularPay = Math.round((basicSalary - shortfallAmount) * 100) / 100
      const grossOtPay = calcOtPay(hourlyRate, summary.total_ot_hours, otRule)
      const premiumPay = calcPremiumPay(hourlyRate, summary, input.premiumRates ?? DEFAULT_PREMIUM_RATES)
      return buildResult(
        summary.employee_id, summary.total_regular_hours, summary.total_ot_hours,
        grossRegularPay, grossOtPay, commission, premiumPay, input,
        { basicSalarySnapshot: basicSalary, shortfallHours, shortfallAmount },
      )
    }
    // Fixed monthly salary + commission. No hours-based math, no OT, and no rest-day/
    // holiday premium: these employees are excluded from attendance processing
    // entirely (2026-07-17 decision), so they never accrue those hours.
    const grossRegularPay = Math.round(structure.rate_amount * 100) / 100
    return buildResult(summary.employee_id, 0, 0, grossRegularPay, 0, commission, NO_PREMIUM_PAY, input)
  }

  // ── Commission-only branch ──
  // No base salary at all — gross pay is the commission itself. Attendance/hours
  // are irrelevant (these employees are excluded from attendance processing).
  // buildResult splits the commission into a "Basic" portion (up to the statutory
  // base, given full EPF/SOCSO/EIS treatment like a normal wage) + a "Commission"
  // remainder — see the epfBase/basicSalarySnapshot logic below.
  if (structure.rate_type === 'commission_only') {
    return buildResult(summary.employee_id, 0, 0, 0, 0, commission, NO_PREMIUM_PAY, input)
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

  // ── 4. Rest-day / public-holiday premium pay ──
  const premiumPay = calcPremiumPay(hourlyRate, summary, input.premiumRates ?? DEFAULT_PREMIUM_RATES)

  return buildResult(
    summary.employee_id,
    summary.total_regular_hours,
    summary.total_ot_hours,
    grossRegularPay,
    grossOtPay,
    commission,
    premiumPay,
    input,
  )
}

/**
 * Build the final PayCheckResult from gross pay + statutory deductions.
 * Shared between the monthly-salary branch and the hourly/daily calculation path.
 * grossPay = grossRegularPay + grossOtPay + commission — computed here (not derived
 * by subtraction from a caller-supplied total) so commission never gets folded into
 * the wrong bucket.
 */
function buildResult(
  employeeId: number,
  totalRegularHours: number,
  totalOtHours: number,
  grossRegularPay: number,
  grossOtPay: number,
  commission: number,
  premiumPay: PremiumPay,
  input: CalculationInput,
  /** Monthly + attendance_required only (migration 0022) — every other caller omits this. */
  attendanceExtras?: { basicSalarySnapshot: number; shortfallHours: number; shortfallAmount: number },
): PayCheckResult {
  const { structure, advanceDeduction } = input
  const restDayPay = premiumPay.restDayOrdinary + premiumPay.restDayOt
  const holidayPay = premiumPay.holidayOrdinary + premiumPay.holidayOt
  // Recurring fixed allowance (migration 0025) — added to gross pay for every rate
  // type, excluded from the EPF/SOCSO/EIS base below (not folded into
  // epfWageBaseDefault), included in PCB (via payrollRun.ts's monthlyWage estimate).
  const allowance = Math.round((structure.fixed_allowance ?? 0) * 100) / 100
  const grossPay = Math.round(
    (grossRegularPay + grossOtPay + commission + restDayPay + holidayPay + allowance) * 100,
  ) / 100

  // EPF Act 1991 Third Schedule: EPF "wages" excludes overtime payments (also
  // excludes service charge, gratuity, traveling allowance, director's fee, and
  // retrenchment/termination benefits — none of which this app models — but DOES
  // include commission, per the 2026-07-24 commission decision). grossOtPay must
  // be excluded from the EPF base — grossPay (used for SOCSO/EIS bracket lookup and
  // PCB, both of which are correct as-is) is NOT the right base for EPF specifically.
  //
  // Rest-day and public-holiday pay is split the same way: the ORDINARY-hours portion
  // is payment for work (wages, so it counts), while the portion earned beyond the
  // normal day is overtime and is excluded — the Act excludes "overtime payment", not
  // "payment for work on a non-working day".
  //
  // An explicit statutoryBase override (commission-only employees, e.g. RM1,700
  // instead of their RM2,538 commission — see docs/COMMISSION_PAYROLL_PLAN.md) takes
  // priority over this OT-excluded default for every other rate type.
  const epfWageBaseDefault = Math.round(
    (grossRegularPay + commission + premiumPay.restDayOrdinary + premiumPay.holidayOrdinary) * 100,
  ) / 100
  // For commission-only employees (input.statutoryBase set), the base is capped at
  // the commission actually earned this run — a low-sales month can't fund a "Basic"
  // larger than what was paid. payrollRun.ts applies the same cap to the bracket
  // LOOKUP wage before this function is even called, so the % rate selected and the
  // amount it's applied to always agree.
  const epfBase = input.statutoryBase !== undefined
    ? Math.round(Math.min(input.statutoryBase, commission) * 100) / 100
    : Math.round(epfWageBaseDefault * 100) / 100

  // commission_only: the payslip shows this same capped figure as "Basic Salary" —
  // reusing basic_salary_snapshot (see its doc comment) rather than a new column.
  // The "Commission" remainder line is commission - basic_salary_snapshot.
  const basicSalarySnapshot = structure.rate_type === 'commission_only'
    ? epfBase
    : attendanceExtras?.basicSalarySnapshot ?? 0

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
    statutory.epf_employee = calcEpfContribution(epfBase, input.epfRate.employee_contribution_pct)
    statutory.epf_employer = calcEpfContribution(epfBase, input.epfRate.employer_contribution_pct)
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
    commission: Math.round(commission * 100) / 100,
    rest_day_pay: Math.round(restDayPay * 100) / 100,
    holiday_pay: Math.round(holidayPay * 100) / 100,
    basic_salary_snapshot: basicSalarySnapshot,
    attendance_shortfall_hours: attendanceExtras?.shortfallHours ?? 0,
    attendance_shortfall_amount: attendanceExtras?.shortfallAmount ?? 0,
    epf_wage_base: structure.subject_to_epf ? epfBase : 0,
    allowance,
    gross_pay: Math.round(grossPay * 100) / 100,
    statutory,
    advance_deduction: advanceDeduction,
    net_pay: netPay,
  }
}
