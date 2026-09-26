// SalaryAdvanceTopUpHistory — read-only list of top-ups made to an advance, so its
// principal is never an unexplained number (see migration 0027).

import { useIpcQuery } from '@/shared/hooks/useIpcQuery'
import type { SalaryAdvanceTopUp } from '@/shared/types/entities'

interface SalaryAdvanceTopUpHistoryProps {
  advanceId: number
}

export function SalaryAdvanceTopUpHistory({ advanceId }: SalaryAdvanceTopUpHistoryProps) {
  const { data: topUps = [] } = useIpcQuery<SalaryAdvanceTopUp[]>(
    ['payroll', 'salaryAdvances', 'topUps', String(advanceId)],
    () => window.api.payroll.salaryAdvances.listTopUps(advanceId),
  )

  if (topUps.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-neutral-900">Top-up History</h3>
      <ul className="flex flex-col gap-1 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
        {topUps.map((t) => (
          <li key={t.id} className="flex justify-between gap-3">
            <span>{t.date_issued}{t.note ? ` — ${t.note}` : ''}</span>
            <span className="tabular-nums font-medium">+ RM {t.amount.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
