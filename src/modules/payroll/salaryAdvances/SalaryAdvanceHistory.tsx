// SalaryAdvanceHistory — read-only record of every top-up (migration 0027) and manual
// adjustment (migration 0028) made to an advance, so its balance and total issued are
// never unexplained numbers.

import { useMemo } from 'react'
import { useIpcQuery } from '@/shared/hooks/useIpcQuery'
import type { SalaryAdvanceAdjustment, SalaryAdvanceTopUp } from '@/shared/types/entities'
import { formatRm } from './formatRm'

interface SalaryAdvanceHistoryProps {
  advanceId: number
}

interface HistoryEntry {
  key: string
  sortKey: string
  label: string
  detail: string
}

export function SalaryAdvanceHistory({ advanceId }: SalaryAdvanceHistoryProps) {
  const { data: topUps = [] } = useIpcQuery<SalaryAdvanceTopUp[]>(
    ['payroll', 'salaryAdvances', 'topUps', String(advanceId)],
    () => window.api.payroll.salaryAdvances.listTopUps(advanceId),
  )
  const { data: adjustments = [] } = useIpcQuery<SalaryAdvanceAdjustment[]>(
    ['payroll', 'salaryAdvances', 'adjustments', String(advanceId)],
    () => window.api.payroll.salaryAdvances.listAdjustments(advanceId),
  )

  const entries = useMemo<HistoryEntry[]>(() => {
    const fromTopUps = topUps.map((t) => ({
      key: `t${t.id}`,
      sortKey: t.created_at,
      label: `${t.date_issued} — Top up${t.note ? ` (${t.note})` : ''}`,
      detail: `+ ${formatRm(t.amount)}`,
    }))
    const fromAdjustments = adjustments.map((a) => ({
      key: `a${a.id}`,
      sortKey: a.created_at,
      label: `${a.created_at.slice(0, 10)} — Adjustment: ${a.reason}`,
      // Balance first, and said plainly when it did not move: a line reading
      // "RM 500 → RM 500, total 2,000 → 1,500" was misread as the balance becoming 1,500.
      detail:
        (a.balance_before !== a.balance_after
          ? `Balance outstanding ${formatRm(a.balance_before)} → ${formatRm(a.balance_after)}`
          : `Balance outstanding unchanged (${formatRm(a.balance_after)})`) +
        (a.amount_before !== a.amount_after
          ? ` · Total issued ${formatRm(a.amount_before)} → ${formatRm(a.amount_after)}`
          : ''),
    }))
    return [...fromTopUps, ...fromAdjustments].sort((x, y) => x.sortKey.localeCompare(y.sortKey))
  }, [topUps, adjustments])

  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-neutral-900">History</h3>
      <ul className="flex flex-col gap-1.5 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
        {entries.map((e) => (
          <li key={e.key} className="flex flex-col gap-0.5">
            <span>{e.label}</span>
            <span className="tabular-nums font-medium">{e.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
