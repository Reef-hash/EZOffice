// Payroll Run Orchestrator — creates, calculates, and finalizes a payroll run.
// The calculate() function is the heart of Phase 4:
//   1. Gather all active employees with salary structures
//   2. Get their monthly attendance summaries
//   3. Look up statutory rates for each
//   4. Compute gross → net via the calculation engine
//   5. Apply salary advance deductions
//   6. Insert snapshotted payroll_run_items in a SINGLE transaction
//
// Claude.md §4: Multi-step writes use transactions. The entire calculate() is one transaction.

import type Database from 'better-sqlite3'
import type { PayrollRun, PayrollRunItem, PayrollPeriod, EmployeeMonthlySummary } from '../../../src/shared/types/entities'
import type { CreatePayrollRunInput } from '../../../src/shared/types/inputs'
import { getAttendanceSummaryForDateRange } from '../attendanceProcessor'
import { resolveCalendarDay, getEmployeeCalendarProfile, getCompanyCalendarProfile } from '../calendar'
import { getCurrentSalaryStructure } from './salaryStructure'
import { getPayrollSettings } from './settings'
import { lookupEpfRate, lookupSocsoRate, lookupEisRate, lookupPcbBracket, checkRateTablesForRun } from './statutoryRates'
import { getActiveAdvancesForEmployee, applyAdvanceDeduction } from './salaryAdvances'
import { getCommissionMapForRun } from './commissions'
import { getAllowanceTotalsForRun } from './adhocAllowances'
import { calculatePay, type OtRule, type PremiumRates } from './calculationEngine'

// ── Helpers ──────────────────────────────────────────────

const RUN_SELECT_WITH_PERIOD = `
  SELECT r.*, pp.name AS period_name, pp.start_date AS period_start_date, pp.end_date AS period_end_date
  FROM payroll_runs r
  LEFT JOIN payroll_periods pp ON pp.id = r.payroll_period_id
`

function queryRunById(db: Database.Database, id: number): PayrollRun | null {
  const row = db.prepare(`${RUN_SELECT_WITH_PERIOD} WHERE r.id = ?`).get(id) as PayrollRun | undefined
  return row ?? null
}

/**
 * Previews the salary advance deduction for an employee without mutating any balance.
 * Used by calculate() for the draft preview, and by finalize() to apply the real deduction —
 * kept as one function so the split-per-advance logic isn't duplicated (Claude.md §3).
 */
function previewAdvanceDeductions(
  db: Database.Database,
  employeeId: number,
): { total: number; perAdvance: Array<{ id: number; amount: number }> } {
  const perAdvance = getActiveAdvancesForEmployee(db, employeeId).map((advance) => ({
    id: advance.id,
    amount:
      advance.deduction_mode === 'full_balance'
        ? advance.balance_outstanding
        : Math.min(advance.installment_amount!, advance.balance_outstanding),
  }))
  const total = perAdvance.reduce((sum, a) => sum + a.amount, 0)
  return { total, perAdvance }
}

function getPayrollPeriodOrThrow(db: Database.Database, payrollPeriodId: number): PayrollPeriod {
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(payrollPeriodId) as PayrollPeriod | undefined
  if (!period) throw new Error(`Payroll period ${payrollPeriodId} not found`)
  return period
}

/**
 * Counts the working days an employee is scheduled for within an inclusive date range.
 *
 * Delegates every day to the Company Calendar's own resolver (`resolveCalendarDay`)
 * rather than deciding for itself — that resolver already honours the configured
 * working week, per-employee calendar overrides, public/company holidays, emergency
 * closures and special working days, and it is what the attendance processing engine
 * uses. Two independent notions of "is this a working day" is exactly what caused the
 * 2026-08-27 bug: this function used to hardcode Mon–Fri and read a long-dead
 * `public_holidays` table, so a company configured for a six-day week had every
 * employee's paid days silently capped at the Mon–Fri count (see the decision log).
 *
 * `half_day` is a modifier on a working day, not its own type, so those days count as
 * one scheduled day here — the half-day reduction is applied to HOURS by the
 * processing engine, not to the day count.
 */
function workingDaysForEmployeeInRange(
  db: Database.Database,
  employeeId: number,
  startDate: string,
  endDate: string,
): number {
  let count = 0
  const cursor = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  while (cursor <= end) {
    const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const dayType = resolveCalendarDay(db, employeeId, dateStr).day_type
    if (dayType === 'working_day' || dayType === 'special_working_day' || dayType === 'company_event') {
      count++
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return count
}

/**
 * Hourly rate derived from a monthly salary, for a rate_type='monthly' AND
 * attendance_required=1 salary structure (migration 0022) — used for both the
 * attendance-shortfall deduction and OT/rest-day/holiday pay on top of the basic.
 *
 * EA 1955 Second Schedule formula:
 *   ordinary daily rate = (12 × monthly wage) / (52 × working days per week)
 *   hourly rate         = ordinary daily rate / the shift's standard hours
 *
 * "Working days per week" is read from the employee's actual Company Calendar profile
 * (or the company default) — a 5-day-week employee and a 6-day-week employee must not
 * share the same divisor, and hardcoding 26 (the common 6-day-week shortcut) would be
 * silently wrong for anyone else.
 */
function deriveMonthlyHourlyRate(
  db: Database.Database,
  employeeId: number,
  monthlyWage: number,
  standardHours: number,
): number {
  if (standardHours <= 0) return 0
  const profile = getEmployeeCalendarProfile(db, employeeId) ?? getCompanyCalendarProfile(db)
  const workingDaysPerWeek = [
    profile.monday_is_working, profile.tuesday_is_working, profile.wednesday_is_working,
    profile.thursday_is_working, profile.friday_is_working, profile.saturday_is_working,
    profile.sunday_is_working,
  ].filter(Boolean).length
  if (workingDaysPerWeek <= 0) return 0
  const dailyRate = (12 * monthlyWage) / (52 * workingDaysPerWeek)
  return dailyRate / standardHours
}

// ── Public API ───────────────────────────────────────────

export function listPayrollRuns(db: Database.Database): PayrollRun[] {
  return db.prepare(`${RUN_SELECT_WITH_PERIOD} ORDER BY r.year DESC, r.month DESC`).all() as PayrollRun[]
}

export function getPayrollRunById(db: Database.Database, id: number): PayrollRun | null {
  return queryRunById(db, id)
}

export function getPayrollRunItems(db: Database.Database, runId: number): PayrollRunItem[] {
  return db.prepare(`
    SELECT i.*, e.name AS employee_name
    FROM payroll_run_items i
    LEFT JOIN employees e ON e.id = i.employee_id
    WHERE i.payroll_run_id = ?
    ORDER BY e.name ASC
  `).all(runId) as PayrollRunItem[]
}

/**
 * Create a draft payroll run against a specific Payroll Period and pay_group.
 * year/month are derived from the period's end_date — they remain a display label
 * and feed the statutory rate/PCB effective-date lookups, but the period's own
 * start_date/end_date (not year/month) is what calculatePayrollRun() actually uses
 * to select attendance data. UNIQUE(payroll_period_id, pay_group) allows an
 * attendance run and a commission-only run to coexist for the same period
 * (docs/COMMISSION_PAYROLL_PLAN.md), while still preventing duplicates within
 * the same pay_group.
 */
export function createPayrollRun(
  db: Database.Database,
  input: CreatePayrollRunInput,
): PayrollRun {
  const period = getPayrollPeriodOrThrow(db, input.payroll_period_id)
  // Attendance runs need daily_attendance_records, which only exist once the period
  // has been processed. Commission-only runs have no attendance dependency, so this
  // gate only applies to the attendance pay_group.
  if (input.pay_group === 'attendance' && period.status === 'open') {
    throw new Error(
      `Payroll period "${period.name}" has not been processed yet. ` +
      'Go to Payroll Periods and click "Process Attendance" before creating a payroll run for it.',
    )
  }

  const [endYear, endMonth] = period.end_date.split('-').map(Number)
  const now = new Date().toISOString()

  try {
    const result = db.prepare(`
      INSERT INTO payroll_runs (payroll_period_id, year, month, status, run_date, pay_group, pay_date, created_at, updated_at)
      VALUES (@payroll_period_id, @year, @month, 'draft', @run_date, @pay_group, @pay_date, @created_at, @updated_at)
    `).run({
      payroll_period_id: input.payroll_period_id,
      year: endYear,
      month: endMonth,
      run_date: now,
      pay_group: input.pay_group,
      pay_date: input.pay_date,
      created_at: now,
      updated_at: now,
    })

    return queryRunById(db, result.lastInsertRowid as number)!
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('UNIQUE') || msg.includes('UNIQUE constraint')) {
      throw new Error(`A ${input.pay_group} payroll run for period "${period.name}" already exists`)
    }
    throw err
  }
}

/**
 * Delete a draft payroll run. Finalized runs can never be deleted (historical
 * integrity — same rule as every other finalized/locked record in this app).
 * Exists mainly so a legacy pre-migration-0020 run (created before payroll runs were
 * linked to a Payroll Period, with no unambiguous period match to auto-backfill onto)
 * can be discarded and recreated correctly against the right period.
 */
export function deletePayrollRun(db: Database.Database, runId: number): void {
  const run = queryRunById(db, runId)
  if (!run) throw new Error(`Payroll run ${runId} not found`)
  if (run.status === 'finalized') throw new Error('Cannot delete a finalized payroll run')
  db.prepare('DELETE FROM payroll_runs WHERE id = ?').run(runId)
}

/**
 * Calculate a payroll run: for every active employee with a salary structure,
 * compute gross → net and insert snapshotted run items.
 *
 * D5 pre-flight gate: refuses if any 'open' attendance exceptions exist for the
 * run month — same pattern as checkRateTables. The admin must resolve or dismiss
 * each exception before payroll can proceed.
 *
 * Everything runs inside a single transaction — partial writes are not acceptable (Claude.md §4).
 */
export function calculatePayrollRun(
  db: Database.Database,
  runId: number,
): PayrollRun {
  const run = queryRunById(db, runId)
  if (!run) throw new Error(`Payroll run ${runId} not found`)
  if (run.status === 'finalized') throw new Error('Cannot recalculate a finalized payroll run')

  // A run created before migration 0020 (payroll runs linked to Payroll Periods) has no
  // payroll_period_id and could not be safely auto-matched to exactly one period during
  // the upgrade. Recalculating it with the old calendar-month logic would silently
  // reproduce the "hours don't match the real period" bug — refuse instead of guessing.
  if (run.payroll_period_id == null) {
    throw new Error(
      `This payroll run (${run.year}-${String(run.month).padStart(2, '0')}) predates Payroll Periods ` +
      'linking and has no unambiguous period match. Delete this draft run and create a new one, ' +
      'selecting the correct Payroll Period, so hours are calculated from its real date range.',
    )
  }

  const period = getPayrollPeriodOrThrow(db, run.payroll_period_id)
  const { start_date: periodStart, end_date: periodEnd } = period

  // ── D5: pre-flight gate — block on open attendance exceptions ──────────────
  // Filtered by the period's actual date range, not year/month — a period spanning two
  // calendar months (e.g. 26 Jul – 25 Aug) must block on open exceptions from EITHER
  // month, not just the one the run happens to be labeled with.
  const hasExceptionsTable = db.prepare(
    `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='attendance_exceptions'`,
  ).get() as { cnt: number }
  if (hasExceptionsTable.cnt > 0) {
    const openExceptions = db.prepare(`
      SELECT COUNT(*) AS cnt FROM attendance_exceptions
      WHERE date >= ? AND date <= ? AND status = 'open'
    `).get(periodStart, periodEnd) as { cnt: number }

    if (openExceptions.cnt > 0) {
      throw new Error(
        `Cannot calculate payroll for period "${period.name}" (${periodStart} – ${periodEnd}): ` +
        `${openExceptions.cnt} unresolved attendance exception(s) exist in this range. ` +
        'Open Attendance → Exceptions, fix or dismiss each item, then recalculate.',
      )
    }
  }

  const asOfDate = periodEnd

  // Get payroll settings (OT rule + rest-day/holiday premium multipliers)
  const settings = getPayrollSettings(db)
  const otRule: OtRule = {
    ot_rule_type: settings.ot_rule_type,
    ot_rule_value: settings.ot_rule_value,
  }
  const premiumRates: PremiumRates = {
    rest_day_multiplier: settings.rest_day_multiplier,
    rest_day_ot_multiplier: settings.rest_day_ot_multiplier,
    holiday_multiplier: settings.holiday_multiplier,
    holiday_ot_multiplier: settings.holiday_ot_multiplier,
  }

  // ── Gather all active employees who have a salary structure effective as of month-end ──
  const employees = db.prepare(`
    SELECT DISTINCT e.id AS employee_id
    FROM employees e
    INNER JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.status = 'active'
      AND ss.effective_from <= @asOfDate
  `).all({ asOfDate }) as Array<{ employee_id: number }>

  const employeeIds = employees.map((e) => e.employee_id)

  // ── Get attendance summaries from Daily Records (Phase 5), for the period's real date range ──
  const summaries = getAttendanceSummaryForDateRange(db, { employeeIds, startDate: periodStart, endDate: periodEnd })
  const summaryMap = new Map<number, EmployeeMonthlySummary>()
  for (const s of summaries) {
    summaryMap.set(s.employee_id, s)
  }

  // Ad-hoc per-run commission entries (see commissions.ts) — admin-entered before
  // calculating, folded into gross pay + statutory base below.
  const commissionMap = getCommissionMapForRun(db, runId)

  // Ad-hoc per-run allowance entries (see adhocAllowances.ts) — summed per employee,
  // folded into gross pay below, excluded from the EPF/SOCSO/EIS base (like the
  // recurring fixed_allowance) but included in the PCB wage estimate.
  const allowanceTotalsMap = getAllowanceTotalsForRun(db, runId)

  // Assigned shift's standard hours per employee — needed only for the
  // monthly + attendance_required derived hourly rate below, but cheap to batch for
  // everyone up front rather than querying per-employee inside the loop.
  const shiftHoursRows = db.prepare(`
    SELECT e.id AS employee_id, s.standard_hours
    FROM employees e
    LEFT JOIN shifts s ON s.id = e.shift_id
  `).all() as Array<{ employee_id: number; standard_hours: number | null }>
  const shiftHoursMap = new Map(shiftHoursRows.map((r) => [r.employee_id, r.standard_hours ?? 8]))

  const now = new Date().toISOString()

  // ── Begin TRANSACTION ──────────────────────────────────
  // Recalculation only replaces payroll_run_items (a draft preview) — it never mutates
  // salary_advances. Advance balances are only committed in finalizePayrollRun(), so
  // recalculating a draft run as many times as needed before finalizing stays idempotent.
  const calculateAll = db.transaction(() => {
    // Clear previous run items — must run inside the same transaction as the inserts below.
    db.prepare('DELETE FROM payroll_run_items WHERE payroll_run_id = ?').run(runId)

    for (const emp of employees) {
      const employeeId = emp.employee_id

      // Get the active salary structure at month-end
      const structure = getCurrentSalaryStructure(db, employeeId, asOfDate)
      if (!structure) continue // no active structure → skip

      // Pay-group filter: an employee's CURRENT structure determines which run
      // they belong to. A commission-only run must never include an attendance
      // employee and vice versa (docs/COMMISSION_PAYROLL_PLAN.md) — checked here
      // (not at the SQL gathering step above) so it always reflects the employee's
      // actual current structure, the same one used for the calculation below.
      const employeeIsCommissionOnly = structure.rate_type === 'commission_only'
      const runIsCommissionOnly = run.pay_group === 'commission_only'
      if (employeeIsCommissionOnly !== runIsCommissionOnly) continue

      // Get attendance summary (use zeroed if none)
      const summary: EmployeeMonthlySummary = summaryMap.get(employeeId) ?? {
        employee_id: employeeId,
        total_regular_hours: 0,
        total_ot_hours: 0,
        days_worked: 0,
        total_rest_day_hours: 0,
        total_rest_day_ot_hours: 0,
        total_holiday_hours: 0,
        total_holiday_ot_hours: 0,
        total_required_hours: 0,
        total_shortfall_hours: 0,
      }

      const commissionEntry = commissionMap.get(employeeId)
      const commission = commissionEntry?.amount ?? 0
      const adhocAllowanceTotal = allowanceTotalsMap.get(employeeId) ?? 0

      // Scheduled working days for THIS employee — resolved through the Company
      // Calendar (honours a six-day week and per-employee overrides), not a hardcoded
      // Mon–Fri count. Used both to estimate the statutory bracket wage below and to
      // cap a daily-rate employee's paid days in the calculation engine.
      const workingDays = workingDaysForEmployeeInRange(db, employeeId, periodStart, periodEnd)

      // Monthly wage estimate — the EPF/SOCSO/EIS bracket-lookup base. Deliberately
      // excludes fixed_allowance (excluded from EPF/SOCSO/EIS, migration 0025), same
      // as it already excludes actual OT hours.
      // For monthly-rate employees: the fixed monthly salary itself
      // For daily-rate employees: daily_rate × working_days_in_month
      // For hourly-rate employees: hourly_rate × standard_hours × working_days
      // For commission-only employees: the commission itself — there is no base
      // salary to add (rate_amount instead holds the recurring statutory base).
      const monthlyWage: number =
        structure.rate_type === 'commission_only'
          ? commission
          : (structure.rate_type === 'monthly'
              ? structure.rate_amount
              : structure.rate_type === 'daily'
                ? structure.rate_amount * workingDays
                : structure.rate_amount * structure.standard_hours_per_day * workingDays) + commission

      // PCB bracket lookup uses full gross wage including both allowances (PCB
      // always uses full gross, per docs/COMMISSION_PAYROLL_PLAN.md and migrations
      // 0025/0026 — allowances are EPF-excluded but not confirmed PCB-exempt, so
      // they're taxed like OT is).
      const monthlyWageForPcb = monthlyWage + (structure.fixed_allowance ?? 0) + adhocAllowanceTotal

      // EPF/SOCSO/EIS bracket lookup + calculation base. Commission-only employees
      // use an explicit contribution base (per-run override, else the employee's
      // recurring default) instead of their commission amount. Every other rate
      // type is left undefined so the calculation engine falls back to the actual
      // gross pay — the pre-existing behavior, unchanged.
      const statutoryBase: number | undefined = structure.rate_type === 'commission_only'
        ? (commissionEntry?.statutoryBaseOverride ?? structure.rate_amount)
        : undefined
      // For commission-only employees, cap the bracket-lookup wage at the commission
      // actually earned this run — a low-sales month can't fund a "Basic" bigger than
      // what was paid. calculationEngine.ts applies the identical cap to the amount
      // the rate is then applied to, so the % rate selected and its base always agree.
      const statutoryBaseForBrackets = statutoryBase !== undefined
        ? Math.min(statutoryBase, commission)
        : monthlyWage

      // Look up statutory rates
      const epfRate = structure.subject_to_epf ? lookupEpfRate(db, statutoryBaseForBrackets, asOfDate) : null
      const socsoRate = structure.subject_to_socso ? lookupSocsoRate(db, statutoryBaseForBrackets, asOfDate) : null
      const eisRate = structure.subject_to_eis ? lookupEisRate(db, statutoryBaseForBrackets, asOfDate) : null

      // PCB: use per-employee category and children count from salary_structures (migration 0005)
      const pcbBracket = lookupPcbBracket(db, monthlyWageForPcb, structure.pcb_category, structure.pcb_children_count, asOfDate)

      // Preview the advance deduction for this employee — NOT applied yet.
      // Balances are only mutated when the run is finalized (see finalizePayrollRun).
      const { total: advanceDeduction } = previewAdvanceDeductions(db, employeeId)

      // Only computed for monthly + attendance_required (migration 0022) — cheap to
      // skip the calendar lookup for every other rate type/flag combination.
      const monthlyHourlyRate =
        structure.rate_type === 'monthly' && structure.attendance_required
          ? deriveMonthlyHourlyRate(db, employeeId, structure.rate_amount, shiftHoursMap.get(employeeId) ?? 8)
          : undefined

      // ── Run the calculation engine ──
      const payResult = calculatePay({
        summary,
        structure: {
          rate_type: structure.rate_type,
          rate_amount: structure.rate_amount,
          standard_hours_per_day: structure.standard_hours_per_day,
          subject_to_epf: structure.subject_to_epf,
          subject_to_socso: structure.subject_to_socso,
          subject_to_eis: structure.subject_to_eis,
          attendance_required: structure.attendance_required,
          fixed_allowance: structure.fixed_allowance,
        },
        otRule,
        premiumRates,
        epfRate,
        socsoRate,
        eisRate,
        pcbBracket,
        advanceDeduction,
        commission,
        adhocAllowanceTotal,
        statutoryBase,
        workingDaysInMonth: workingDays,
        monthlyHourlyRate,
      })

      // ── Insert snapshotted payroll_run_item ──
      db.prepare(`
        INSERT INTO payroll_run_items (
          payroll_run_id, employee_id, salary_structure_id,
          snapshot_rate_type, snapshot_rate_amount, snapshot_standard_hours_per_day,
          snapshot_subject_to_epf, snapshot_subject_to_socso, snapshot_subject_to_eis,
          total_regular_hours, total_ot_hours,
          gross_regular_pay, gross_ot_pay, commission,
          rest_day_pay, holiday_pay,
          basic_salary_snapshot, attendance_shortfall_hours, attendance_shortfall_amount,
          epf_wage_base,
          allowance, allowance_description, adhoc_allowance_total,
          gross_pay,
          epf_employee, epf_employer,
          socso_employee, socso_employer,
          eis_employee, eis_employer,
          pcb, advance_deduction, net_pay,
          created_at, updated_at
        ) VALUES (
          @payroll_run_id, @employee_id, @salary_structure_id,
          @snapshot_rate_type, @snapshot_rate_amount, @snapshot_standard_hours_per_day,
          @snapshot_subject_to_epf, @snapshot_subject_to_socso, @snapshot_subject_to_eis,
          @total_regular_hours, @total_ot_hours,
          @gross_regular_pay, @gross_ot_pay, @commission,
          @rest_day_pay, @holiday_pay,
          @basic_salary_snapshot, @attendance_shortfall_hours, @attendance_shortfall_amount,
          @epf_wage_base,
          @allowance, @allowance_description, @adhoc_allowance_total,
          @gross_pay,
          @epf_employee, @epf_employer,
          @socso_employee, @socso_employer,
          @eis_employee, @eis_employer,
          @pcb, @advance_deduction, @net_pay,
          @created_at, @updated_at
        )
      `).run({
        payroll_run_id: runId,
        employee_id: payResult.employee_id,
        salary_structure_id: structure.id,
        snapshot_rate_type: structure.rate_type,
        snapshot_rate_amount: structure.rate_amount,
        snapshot_standard_hours_per_day: structure.standard_hours_per_day,
        snapshot_subject_to_epf: structure.subject_to_epf,
        snapshot_subject_to_socso: structure.subject_to_socso,
        snapshot_subject_to_eis: structure.subject_to_eis,
        total_regular_hours: payResult.total_regular_hours,
        total_ot_hours: payResult.total_ot_hours,
        gross_regular_pay: payResult.gross_regular_pay,
        gross_ot_pay: payResult.gross_ot_pay,
        commission: payResult.commission,
        rest_day_pay: payResult.rest_day_pay,
        holiday_pay: payResult.holiday_pay,
        basic_salary_snapshot: payResult.basic_salary_snapshot,
        attendance_shortfall_hours: payResult.attendance_shortfall_hours,
        attendance_shortfall_amount: payResult.attendance_shortfall_amount,
        epf_wage_base: payResult.epf_wage_base,
        allowance: payResult.allowance,
        allowance_description: structure.allowance_description,
        adhoc_allowance_total: payResult.adhoc_allowance_total,
        gross_pay: payResult.gross_pay,
        epf_employee: payResult.statutory.epf_employee,
        epf_employer: payResult.statutory.epf_employer,
        socso_employee: payResult.statutory.socso_employee,
        socso_employer: payResult.statutory.socso_employer,
        eis_employee: payResult.statutory.eis_employee,
        eis_employer: payResult.statutory.eis_employer,
        pcb: payResult.statutory.pcb,
        advance_deduction: advanceDeduction,
        net_pay: payResult.net_pay,
        created_at: now,
        updated_at: now,
      })
    }
  })

  // Execute the transaction
  calculateAll()

  return queryRunById(db, runId)!
}

/**
 * Finalize a payroll run — locks it permanently. No further changes allowed.
 *
 * This is the ONLY place salary advance balances are actually mutated. calculatePayrollRun()
 * only previews the deduction (so recalculating a draft is safe to repeat); finalize commits
 * it for real, re-resolving each employee's active advances at this exact moment so the
 * amount deducted always matches the advance's true current balance, then overwrites the
 * run item's snapshotted advance_deduction/net_pay with the amount actually applied.
 * All of this — including the status flip — runs in a single transaction (Claude.md §4).
 */
export function finalizePayrollRun(db: Database.Database, runId: number): PayrollRun {
  const run = queryRunById(db, runId)
  if (!run) throw new Error(`Payroll run ${runId} not found`)
  if (run.status === 'finalized') throw new Error('Payroll run is already finalized')

  // Guard: refuse to finalize if any statutory rate table is empty — deductions would silently
  // compute as RM 0.00 for every employee, causing incorrect net pay in the final payslips.
  const { missing } = checkRateTablesForRun(db)
  if (missing.length > 0) {
    throw new Error(
      `Cannot finalize: statutory rate tables are empty for ${missing.join(', ')}. ` +
      'Populate the rate tables under Statutory Rate Tables before finalizing.',
    )
  }

  const items = getPayrollRunItems(db, runId)
  const now = new Date().toISOString()

  const finalizeAll = db.transaction(() => {
    for (const item of items) {
      const { perAdvance } = previewAdvanceDeductions(db, item.employee_id)

      let actualDeduction = 0
      for (const advance of perAdvance) {
        actualDeduction += applyAdvanceDeduction(db, advance.id, advance.amount)
      }

      const newNetPay = Math.round((item.gross_pay - (
        item.epf_employee + item.socso_employee + item.eis_employee + item.pcb + actualDeduction
      )) * 100) / 100

      db.prepare(`
        UPDATE payroll_run_items
        SET advance_deduction = @advance_deduction, net_pay = @net_pay, updated_at = @updated_at
        WHERE id = @id
      `).run({
        advance_deduction: actualDeduction,
        net_pay: newNetPay,
        updated_at: now,
        id: item.id,
      })
    }

    db.prepare(`
      UPDATE payroll_runs SET status = 'finalized', updated_at = @updated_at WHERE id = @id
    `).run({ updated_at: now, id: runId })
  })

  finalizeAll()

  return queryRunById(db, runId)!
}

export interface UnfinalizeResult {
  run: PayrollRun
  advancesToVerify: Array<{ employee_id: number; employee_name: string; amount: number }>
}

/**
 * Reverts a finalized payroll run back to 'draft' so it can be corrected and
 * recalculated — e.g. a run finalized before migration 0020 linked payroll_runs to
 * their real Payroll Period (see the 2026-08-26 decision log entry). This is a
 * deliberate, audited reversal through the app, not a raw database edit — finalize
 * is otherwise meant as a one-way lock (historical integrity, Claude.md §4), so this
 * exists specifically to correct a run that was finalized with wrong data.
 *
 * IMPORTANT — does NOT touch salary_advances balances. finalizePayrollRun() only
 * ever snapshots the TOTAL advance deduction per employee onto payroll_run_items,
 * not which specific advance(s) it came from — an employee can have more than one
 * concurrent advance, so guessing which advance(s) to credit back could silently
 * corrupt an unrelated advance's balance. Instead, every employee whose run item had
 * advance_deduction > 0 is returned in `advancesToVerify` so the admin can manually
 * add the amount back to the correct advance under Salary Advances, rather than the
 * app guessing.
 */
export function unfinalizePayrollRun(db: Database.Database, runId: number): UnfinalizeResult {
  const run = queryRunById(db, runId)
  if (!run) throw new Error(`Payroll run ${runId} not found`)
  if (run.status !== 'finalized') throw new Error('Only a finalized payroll run can be un-finalized')

  const items = getPayrollRunItems(db, runId)
  const now = new Date().toISOString()

  const advancesToVerify = items
    .filter((item) => item.advance_deduction > 0)
    .map((item) => ({
      employee_id: item.employee_id,
      employee_name: item.employee_name ?? `ID ${item.employee_id}`,
      amount: item.advance_deduction,
    }))

  db.prepare(`
    UPDATE payroll_runs SET status = 'draft', updated_at = @updated_at WHERE id = @id
  `).run({ updated_at: now, id: runId })

  return { run: queryRunById(db, runId)!, advancesToVerify }
}
