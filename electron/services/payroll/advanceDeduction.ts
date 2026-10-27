// Decides how much of an employee's scheduled salary advance deductions fit into
// this run's pay. Pure (no DB access) so the rule can be tested on its own and is
// shared by payroll calculation and finalize, which must always agree.
//
// Why a cap exists: without one, an advance larger than the month's pay drove net
// pay negative and the whole balance was written off as settled, so the part the
// employee could not cover was silently lost (CLAUDE.md decision log, 2026-10-27).

/**
 * Largest share of an employee's net pay (after EPF/SOCSO/EIS/LINDUNG/PCB, before
 * the advance) that salary advance deductions may take in one run. Chosen by the
 * project owner; whether the Employment Act sets its own limit has not been checked.
 */
export const MAX_ADVANCE_DEDUCTION_RATIO = 0.5

export interface ScheduledAdvanceDeduction {
  id: number
  amount: number
}

export interface AdvanceDeductionAllocation {
  /** What is actually deducted per advance this run. */
  perAdvance: ScheduledAdvanceDeduction[]
  /** Sum of perAdvance. */
  total: number
  /** Scheduled amount that did not fit and stays on the advances' balances. */
  deferred: number
}

const toCents = (value: number): number => Math.round(value * 100) / 100

/**
 * Spends the available allowance on the scheduled deductions in the order given
 * (oldest advance first), so an employee with several advances repays them in the
 * order they were lent.
 */
export function allocateAdvanceDeductions(
  scheduled: ScheduledAdvanceDeduction[],
  netPayBeforeAdvance: number,
): AdvanceDeductionAllocation {
  let remaining = toCents(Math.max(0, netPayBeforeAdvance) * MAX_ADVANCE_DEDUCTION_RATIO)
  const perAdvance = scheduled.map((advance) => {
    const amount = toCents(Math.min(advance.amount, remaining))
    remaining = toCents(remaining - amount)
    return { id: advance.id, amount }
  })
  const total = toCents(perAdvance.reduce((sum, a) => sum + a.amount, 0))
  const scheduledTotal = scheduled.reduce((sum, a) => sum + a.amount, 0)
  return { perAdvance, total, deferred: toCents(scheduledTotal - total) }
}
