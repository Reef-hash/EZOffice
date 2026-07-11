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
import type { PayrollRun, PayrollRunItem } from '../../../src/shared/types/entities'
import type { CreatePayrollRunInput } from '../../../src/shared/types/inputs'
import { getMonthlySummaryFromDailyRecords } from '../attendanceProcessor'
import { getCurrentSalaryStructure } from './salaryStructure'
import { getPayrollSettings } from './settings'
import { lookupEpfRate, lookupSocsoRate, lookupEisRate, lookupPcbBracket, checkRateTablesForRun } from './statutoryRates'
import { getActiveAdvancesForEmployee, applyAdvanceDeduction } from './salaryAdvances'
import { calculatePay, type OtRule } from './calculationEngine'

// ── Helpers ──────────────────────────────────────────────

function queryRunById(db: Database.Database, id: number): PayrollRun | null {
  const row = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id) as PayrollRun | undefined
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

/** ISO date for the last day of a given year-month */
function monthEndDate(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

/**
 * Reads public holidays for the given month from the public_holidays table.
 * Returns a Set of YYYY-MM-DD strings so workingDaysInMonth can exclude them.
 */
function getPublicHolidayDates(db: Database.Database, year: number, month: number): Set<string> {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const rows = db.prepare(
    `SELECT date FROM public_holidays WHERE date LIKE ?`,
  ).all(`${monthPrefix}%`) as Array<{ date: string }>
  return new Set(rows.map((r) => r.date))
}

/** Count working days in a month (Mon–Fri), excluding weekends and public holidays. */
function workingDaysInMonth(year: number, month: number, publicHolidays: Set<string>): number {
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  let count = 0
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`
    const dow = new Date(year, month - 1, d).getDay()
    if (dow !== 0 && dow !== 6 && !publicHolidays.has(dateStr)) count++
  }
  return count
}

// ── Public API ───────────────────────────────────────────

export function listPayrollRuns(db: Database.Database): PayrollRun[] {
  return db.prepare('SELECT * FROM payroll_runs ORDER BY year DESC, month DESC').all() as PayrollRun[]
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
 * Create a draft payroll run for a given year/month.
 * UNIQUE(year, month) constraint prevents duplicate runs.
 */
export function createPayrollRun(
  db: Database.Database,
  input: CreatePayrollRunInput,
): PayrollRun {
  const now = new Date().toISOString()
  const runDate = now

  try {
    const result = db.prepare(`
      INSERT INTO payroll_runs (year, month, status, run_date, created_at, updated_at)
      VALUES (@year, @month, 'draft', @run_date, @created_at, @updated_at)
    `).run({
      year: input.year,
      month: input.month,
      run_date: runDate,
      created_at: now,
      updated_at: now,
    })

    return queryRunById(db, result.lastInsertRowid as number)!
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('UNIQUE') || msg.includes('UNIQUE constraint')) {
      throw new Error(`A payroll run for ${input.year}-${String(input.month).padStart(2, '0')} already exists`)
    }
    throw err
  }
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

  const { year, month } = run

  // ── D5: pre-flight gate — block on open attendance exceptions ──────────────
  // computeAttendanceExceptions is called first so the admin sees a complete list
  // of issues in one shot, rather than discovering them one by one.
  const hasExceptionsTable = db.prepare(
    `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='attendance_exceptions'`,
  ).get() as { cnt: number }
  if (hasExceptionsTable.cnt > 0) {
    const openExceptions = db.prepare(`
      SELECT COUNT(*) AS cnt FROM attendance_exceptions
      WHERE year = ? AND month = ? AND status = 'open'
    `).get(year, month) as { cnt: number }

    if (openExceptions.cnt > 0) {
      throw new Error(
        `Cannot calculate payroll for ${year}-${String(month).padStart(2, '0')}: ` +
        `${openExceptions.cnt} unresolved attendance exception(s) exist for this month. ` +
        'Open Attendance → Exceptions, fix or dismiss each item, then recalculate.',
      )
    }
  }

  const asOfDate = monthEndDate(year, month)
  const publicHolidays = getPublicHolidayDates(db, year, month)
  const workingDays = workingDaysInMonth(year, month, publicHolidays)

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

  // ── Get monthly attendance summaries from Daily Records (Phase 5) ──
  const summaries = getMonthlySummaryFromDailyRecords(db, { employeeIds, year, month })
  const summaryMap = new Map<number, { employee_id: number; total_regular_hours: number; total_ot_hours: number; days_worked: number }>()
  for (const s of summaries) {
    summaryMap.set(s.employee_id, s)
  }

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

      // Get attendance summary (use zeroed if none)
      const summary = summaryMap.get(employeeId) ?? {
        employee_id: employeeId,
        total_regular_hours: 0,
        total_ot_hours: 0,
        days_worked: 0,
      }

      // Monthly wage estimate (for statutory bracket lookup)
      // For daily-rate employees: daily_rate × working_days_in_month
      // For hourly-rate employees: hourly_rate × standard_hours × working_days
      const monthlyWage =
        structure.rate_type === 'daily'
          ? structure.rate_amount * workingDays
          : structure.rate_amount * structure.standard_hours_per_day * workingDays

      // Look up statutory rates
      const epfRate = structure.subject_to_epf ? lookupEpfRate(db, monthlyWage, asOfDate) : null
      const socsoRate = structure.subject_to_socso ? lookupSocsoRate(db, monthlyWage, asOfDate) : null
      const eisRate = structure.subject_to_eis ? lookupEisRate(db, monthlyWage, asOfDate) : null

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
        workingDaysInMonth: workingDays,
      })

      // ── Insert snapshotted payroll_run_item ──
      db.prepare(`
        INSERT INTO payroll_run_items (
          payroll_run_id, employee_id, salary_structure_id,
          snapshot_rate_type, snapshot_rate_amount, snapshot_standard_hours_per_day,
          snapshot_subject_to_epf, snapshot_subject_to_socso, snapshot_subject_to_eis,
          total_regular_hours, total_ot_hours,
          gross_regular_pay, gross_ot_pay, gross_pay,
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
          @gross_regular_pay, @gross_ot_pay, @gross_pay,
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
