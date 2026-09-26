// SalaryAdvanceTopUpDialog — adds more money to an existing active advance.
//
// Deliberately its own modal with its own primary button. It used to be a section
// inside the edit form, which also has a "Save Changes" button that only saves the
// edit fields — clicking that after filling in the top-up silently did nothing.
// Topping up (rather than opening a second advance) keeps a single monthly
// installment — see topUpSalaryAdvance in electron/services/payroll/salaryAdvances.ts.

import { useState, useEffect } from 'react'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { SalaryAdvance } from '@/shared/types/entities'
import type { TopUpSalaryAdvanceInput } from '@/shared/types/inputs'
import { formatRm } from './formatRm'

interface SalaryAdvanceTopUpDialogProps {
  advance: SalaryAdvance | null
  onClose: () => void
}

export function SalaryAdvanceTopUpDialog({ advance, onClose }: SalaryAdvanceTopUpDialogProps) {
  const [amount, setAmount] = useState('')
  const [dateIssued, setDateIssued] = useState('')
  const [limitMax, setLimitMax] = useState('')
  const [installment, setInstallment] = useState('')
  const [note, setNote] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!advance) return
    setAmount('')
    setDateIssued(new Date().toISOString().slice(0, 10))
    setLimitMax('')
    setInstallment('')
    setNote('')
    setValidationError(null)
  }, [advance])

  const topUpMutation = useIpcMutation<SalaryAdvance, TopUpSalaryAdvanceInput>(
    (data) => window.api.payroll.salaryAdvances.topUp(advance!.id, data),
    [['payroll', 'salaryAdvances']],
    { onSuccessMessage: 'Salary advance topped up successfully' },
  )

  if (!advance) return null

  const topUpAmount = Number(amount) || 0
  const newTotal = advance.amount + topUpAmount
  const newBalance = advance.balance_outstanding + topUpAmount
  const effectiveLimit = limitMax ? Number(limitMax) : advance.limit_max
  const exceedsLimit = topUpAmount > 0 && newTotal > effectiveLimit
  const isFixedInstallment = advance.deduction_mode === 'fixed_installment'

  async function handleTopUp() {
    setValidationError(null)
    if (topUpAmount <= 0) { setValidationError('Top-up amount must be a positive number'); return }
    if (!dateIssued) { setValidationError('Date issued is required'); return }
    if (exceedsLimit) {
      setValidationError(
        `Total issued would become ${formatRm(newTotal)}, above the approved limit of ${formatRm(effectiveLimit)}. ` +
        'Enter a New Approved Limit of at least that amount.',
      )
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
      onClose()
    } catch {
      // Handled by global onError toast
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Top Up Advance — ${advance.employee_name ?? `ID ${advance.employee_id}`}`}
      size="md"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button isLoading={topUpMutation.isPending} onClick={handleTopUp}>Confirm Top Up</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-500">
          Adds more money to this advance instead of creating a new one, so the employee keeps a
          single balance and a single monthly installment.
        </p>

        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Top-up Amount (RM)"
            type="number"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            helperText="The extra money given now — not the new total."
          />
          <Input
            label="Date Issued"
            type="date"
            required
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
            helperText={`Optional. Current limit: ${formatRm(advance.limit_max)}`}
          />
          <Input
            label="New Installment (RM)"
            type="number"
            step="0.01"
            value={installment}
            onChange={(e) => setInstallment(e.target.value)}
            disabled={!isFixedInstallment}
            helperText={
              isFixedInstallment
                ? `Optional. Current: ${formatRm(advance.installment_amount ?? 0)} per run`
                : 'Full-balance mode deducts the whole balance next run.'
            }
          />
        </div>

        <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} />

        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-1 font-medium" />
              <th className="py-1 text-right font-medium">Now</th>
              <th className="py-1 text-right font-medium">After top-up</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-neutral-200 font-semibold text-neutral-900">
              <td className="py-2">Balance outstanding (to be deducted)</td>
              <td className="py-2 text-right">{formatRm(advance.balance_outstanding)}</td>
              <td className="py-2 text-right">{formatRm(newBalance)}</td>
            </tr>
            <tr className="border-t border-neutral-200 text-neutral-600">
              <td className="py-2">Total ever issued</td>
              <td className="py-2 text-right">{formatRm(advance.amount)}</td>
              <td className="py-2 text-right">{formatRm(newTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
