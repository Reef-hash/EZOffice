// SalaryAdvanceTopUpSection — adds more money to an existing active advance and shows
// its top-up history. Topping up (rather than opening a second advance) keeps a single
// monthly installment — see topUpSalaryAdvance in electron/services/payroll/salaryAdvances.ts.

import { useState } from 'react'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { SalaryAdvance, SalaryAdvanceTopUp } from '@/shared/types/entities'
import type { TopUpSalaryAdvanceInput } from '@/shared/types/inputs'

interface SalaryAdvanceTopUpSectionProps {
  advance: SalaryAdvance
  onToppedUp: () => void
}

export function SalaryAdvanceTopUpSection({ advance, onToppedUp }: SalaryAdvanceTopUpSectionProps) {
  const isActive = advance.status === 'active'

  const { data: topUps = [] } = useIpcQuery<SalaryAdvanceTopUp[]>(
    ['payroll', 'salaryAdvances', 'topUps', String(advance.id)],
    () => window.api.payroll.salaryAdvances.listTopUps(advance.id),
  )

  const [amount, setAmount] = useState('')
  const [dateIssued, setDateIssued] = useState(new Date().toISOString().slice(0, 10))
  const [limitMax, setLimitMax] = useState('')
  const [installment, setInstallment] = useState('')
  const [note, setNote] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const topUpMutation = useIpcMutation<SalaryAdvance, TopUpSalaryAdvanceInput>(
    (data) => window.api.payroll.salaryAdvances.topUp(advance.id, data),
    [['payroll', 'salaryAdvances']],
    { onSuccessMessage: 'Salary advance topped up successfully' },
  )

  const topUpAmount = Number(amount) || 0
  const newTotal = advance.amount + topUpAmount
  const newBalance = advance.balance_outstanding + topUpAmount
  const effectiveLimit = limitMax ? Number(limitMax) : advance.limit_max
  const exceedsLimit = topUpAmount > 0 && newTotal > effectiveLimit

  async function handleTopUp() {
    setValidationError(null)
    if (topUpAmount <= 0) { setValidationError('Top-up amount must be a positive number'); return }
    if (!dateIssued) { setValidationError('Date issued is required'); return }
    if (exceedsLimit) {
      setValidationError(`New total RM ${newTotal.toFixed(2)} exceeds the approved limit — raise the limit below`)
      return
    }
    if (installment && Number(installment) <= 0) { setValidationError('Installment must be positive'); return }

    try {
      await topUpMutation.mutateAsync({
        amount: topUpAmount,
        date_issued: dateIssued,
        limit_max: limitMax ? Number(limitMax) : undefined,
        installment_amount: installment ? Number(installment) : undefined,
        note: note || undefined,
      })
      onToppedUp()
    } catch {
      // Handled by global onError toast
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">Top Up This Advance</h3>
        <p className="text-xs text-neutral-500">
          Add more money to this advance instead of creating a new one — the employee keeps a
          single balance and a single monthly installment.
        </p>
      </div>

      {topUps.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
          {topUps.map((t) => (
            <li key={t.id} className="flex justify-between gap-3">
              <span>{t.date_issued}{t.note ? ` — ${t.note}` : ''}</span>
              <span className="tabular-nums font-medium">+ RM {t.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}

      {isActive && (
        <>
          {validationError && (
            <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Top-up Amount (RM)"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              label="Date Issued"
              type="date"
              value={dateIssued}
              onChange={(e) => setDateIssued(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="New Approved Limit (RM)"
              type="number"
              step="0.01"
              value={limitMax}
              onChange={(e) => setLimitMax(e.target.value)}
              helperText={`Optional. Current limit: RM ${advance.limit_max.toFixed(2)}`}
            />
            <Input
              label="New Installment (RM)"
              type="number"
              step="0.01"
              value={installment}
              onChange={(e) => setInstallment(e.target.value)}
              disabled={advance.deduction_mode !== 'fixed_installment'}
              helperText={
                advance.deduction_mode === 'fixed_installment'
                  ? `Optional. Current: RM ${(advance.installment_amount ?? 0).toFixed(2)} per run`
                  : 'Full-balance mode deducts the whole balance next run.'
              }
            />
          </div>
          <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} />

          {topUpAmount > 0 && (
            <p className="text-sm text-neutral-700">
              After top-up: total <span className="font-medium">RM {newTotal.toFixed(2)}</span>, balance
              outstanding <span className="font-medium">RM {newBalance.toFixed(2)}</span>
            </p>
          )}

          <div className="flex justify-end">
            <Button variant="secondary" isLoading={topUpMutation.isPending} onClick={handleTopUp}>
              Top Up
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
