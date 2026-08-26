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
import type { PayrollRun, PayrollRunItem, PayrollPeriod } from '../../../src/shared/types/entities'
import type { CreatePayrollRunInput } from '../../../src/shared/types/inputs'
import { getAttendanceSummaryForDateRange } from '../attendanceProcessor'
import { getCurrentSalaryStructure } from './salaryStructure'
import { getPayrollSettings } from './settings'
import { lookupEpfRate, lookupSocsoRate, lookupEisRate, lookupPcbBracket, checkRateTablesForRun } from './statutoryRates'
import { getActiveAdvancesForEmployee, applyAdvanceDeduction } from './salaryAdvances'
import { getCommissionMapForRun } from './commissions'
import { calculatePay, type OtRule } from './calculationEngine'

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
 * Reads public holidays within an explicit date range from the public_holidays table.
 * Returns a Set of YYYY-MM-DD strings so workingDaysInRange can exclude them.
 */
function getPublicHolidayDatesInRange(db: Database.Database, startDate: string, endDate: string): Set<string> {
  const rows = db.prepare(
    `SELECT date FROM public_holidays WHERE date >= ? AND date <= ?`,
  ).all(startDate, endDate) as Array<{ date: string }>
  return new Set(rows.map((r) => r.date))
}

/**
 * Count working days (Mon–Fri) within an inclusive date range, excluding public holidays.
 * Replaces the old calendar-month version — a payroll period's real date range (e.g.
 * 26 Jul – 25 Aug) does not line up with a calendar month, so working days must be
 * counted across the period's actual start_date/end_date, not a derived year/month.
 */
function workingDaysInRange(startDate: string, endDate: string, publicHolidays: Set<string>): number {
  let count = 0
  const cursor = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  while (cursor <= end) {
    const y = cursor.getFullYear()
    const m = cursor.getMonth() + 1
    const d = cursor.getDate()
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6 && !publicHolidays.has(dateStr)) count++
    cursor.setDate(cursor.getDate() + 1)
  }
  return count
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
  const publicHolidays = getPublicHolidayDatesInRange(db, periodStart, periodEnd)
  const workingDays = workingDaysInRange(periodStart, periodEnd, publicHolidays)

  // Get payroll settings (OT rule)
  const settings = getPayrollSettings(db)
  const otRule: OtRule = {
    ot_rule_type: settings.ot_rule_type,
    ot_rule_value: settings.ot_rule_value,
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
  const summaryMap = new Map<number, { employee_id: number; total_regular_hours: number; total_ot_hours: number; days_worked: number }>()
  for (const s of summaries) {
    summaryMap.set(s.employee_id, s)
  }

  // Ad-hoc per-run commission entries (see commissions.ts) — admin-entered before
  // calculating, folded into gross pay + statutory base below.
  const commissionMap = getCommissionMapForRun(db, runId)

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
      const summary = summaryMap.get(employeeId) ?? {
        employee_id: employeeId,
        total_regular_hours: 0,
        total_ot_hours: 0,
        days_worked: 0,
      }

      const commissionEntry = commissionMap.get(employeeId)
      const commission = commissionEntry?.amount ?? 0

      // Monthly wage estimate (for PCB bracket lookup — PCB always uses full gross
      // wage including commission, per docs/COMMISSION_PAYROLL_PLAN.md).
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

      // EPF/SOCSO/EIS bracket lookup + calculation base. Commission-only employees
      // use an explicit contribution base (per-run override, else the employee's
      // recurring default) instead of their commission amount. Every other rate
      // type is left undefined so the calculation engine falls back to the actual
      // gross pay — the pre-existing behavior, unchanged.
      const statutoryBase: number | undefined = structure.rate_type === 'commission_only'
        ? (commissionEntry?.statutoryBaseOverride ?? structure.rate_amount)
        : undefined
      const statutoryBaseForBrackets = statutoryBase ?? monthlyWage

      // Look up statutory rates
      const epfRate = structure.subject_to_epf ? lookupEpfRate(db, statutoryBaseForBrackets, asOfDate) : null
      const socsoRate = structure.subject_to_socso ? lookupSocsoRate(db, statutoryBaseForBrackets, asOfDate) : null
      const eisRate = structure.subject_to_eis ? lookupEisRate(db, statutoryBaseForBrackets, asOfDate) : null

      // PCB: use per-employee category and children count from salary_structures (migration 0005)
      const pcbBracket = lookupPcbBracket(db, monthlyWage, structure.pcb_category, structure.pcb_children_count, asOfDate)

      // Preview the advance deduction for this employee — NOT applied yet.
      // Balances are only mutated when the run is finalized (see finalizePayrollRun).
      const { total: advanceDeduction } = previewAdvanceDeductions(db, employeeId)

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
        },
        otRule,
        epfRate,
        socsoRate,
        eisRate,
        pcbBracket,
        advanceDeduction,
        commission,
        statutoryBase,
        workingDaysInMonth: workingDays,
      })

      // ── Insert snapshotted payroll_run_item ──
      db.prepare(`
        INSERT INTO payroll_run_items (
          payroll_run_id, employee_id, salary_structure_id,
          snapshot_rate_type, snapshot_rate_amount, snapshot_standard_hours_per_day,
          snapshot_subject_to_epf, snapshot_subject_to_socso, snapshot_subject_to_eis,
          total_regular_hours, total_ot_hours,
          gross_regular_pay, gross_ot_pay, commission, gross_pay, statutory_base,
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
          @gross_regular_pay, @gross_ot_pay, @commission, @gross_pay, @statutory_base,
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
        gross_pay: payResult.gross_pay,
        statutory_base: payResult.statutory_base,
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
