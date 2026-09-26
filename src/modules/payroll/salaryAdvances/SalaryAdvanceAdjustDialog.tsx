// SalaryAdvanceAdjustDialog — manual correction of an advance whose balance or total
// issued is wrong. The admin types the CORRECT values, not an amount to add/subtract,
// and must give a reason; both old and new values are kept in the advance's history.

import { useState, useEffect } from 'react'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { SalaryAdvance } from '@/shared/types/entities'
import type { AdjustSalaryAdvanceInput } from '@/shared/types/inputs'
import { formatRm } from './formatRm'

interface SalaryAdvanceAdjustDialogProps {
  advance: SalaryAdvance | null
  onClose: () => void
}

export function SalaryAdvanceAdjustDialog({ advance, onClose }: SalaryAdvanceAdjustDialogProps) {
  const [balance, setBalance] = useState('')
  const [amount, setAmount] = useState('')
  // Total issued is almost never what needs fixing, and showing it next to the balance
  // invited typing the intended balance into it (reported against v0.7.1), so it stays
  // hidden until explicitly asked for.
  const [correctTotal, setCorrectTotal] = useState(false)
  const [reason, setReason] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!advance) return
    setBalance(String(advance.balance_outstanding))
    setAmount(String(advance.amount))
    setCorrectTotal(false)
    setReason('')
    setValidationError(null)
  }, [advance])

  const adjustMutation = useIpcMutation<SalaryAdvance, AdjustSalaryAdvanceInput>(
    (data) => window.api.payroll.salaryAdvances.adjust(advance!.id, data),
    [['payroll', 'salaryAdvances']],
    { onSuccessMessage: 'Salary advance corrected' },
  )

  if (!advance) return null

  const newBalance = Number(balance)
  const newAmount = correctTotal ? Number(amount) : advance.amount
  const balanceUnchanged = balance !== '' && newBalance === advance.balance_outstanding

  async function handleSave() {
    setValidationError(null)
    if (balance === '' || Number.isNaN(newBalance) || newBalance < 0) {
      setValidationError('Enter the correct balance outstanding (0 or more)')
      return
    }
    if (correctTotal && (!amount || Number.isNaN(newAmount) || newAmount <= 0)) {
      setValidationError('Total issued must be a positive number')
      return
    }
    if (newBalance > newAmount) {
      setValidationError('Balance outstanding cannot be more than the total issued')
      return
    }
    if (!reason.trim()) { setValidationError('Please give a reason for this correction'); return }

    try {
      await adjustMutation.mutateAsync({
        balance_outstanding: newBalance,
        amount: correctTotal && newAmount !== advance!.amount ? newAmount : undefined,
        reason: reason.trim(),
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
      title={`Correct Advance — ${advance.employee_name ?? `ID ${advance.employee_id}`}`}
      size="md"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button isLoading={adjustMutation.isPending} onClick={handleSave}>Save Correction</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-500">
          Use this only to fix a wrong balance. Enter the <strong>correct</strong> balance the
          employee still owes, not an amount to add or subtract. To lend more money, use Top Up instead.
        </p>

        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <Input
          label="Correct Balance Outstanding (RM)"
          type="number"
          step="0.01"
          required
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          helperText="The amount still to be deducted from salary. This is the number that matters."
        />

        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={correctTotal}
            onChange={(e) => setCorrectTotal(e.target.checked)}
          />
          Also correct the total issued (rarely needed)
        </label>

        {correctTotal && (
          <Input
            label="Correct Total Issued (RM)"
            type="number"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            helperText="Everything ever lent on this advance, including top-ups. Not the balance."
          />
        )}

        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-1 font-medium" />
              <th className="py-1 text-right font-medium">Now</th>
              <th className="py-1 text-right font-medium">After correction</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-neutral-200 font-semibold text-neutral-900">
              <td className="py-2">Balance outstanding (to be deducted)</td>
              <td className="py-2 text-right">{formatRm(advance.balance_outstanding)}</td>
              <td className="py-2 text-right">{balance === '' ? '—' : formatRm(newBalance)}</td>
            </tr>
            <tr className="border-t border-neutral-200 text-neutral-600">
              <td className="py-2">Total ever issued</td>
              <td className="py-2 text-right">{formatRm(advance.amount)}</td>
              <td className="py-2 text-right">{formatRm(newAmount)}</td>
            </tr>
          </tbody>
        </table>

        {balanceUnchanged && (
          <p className="rounded-sm bg-warning-50 px-3 py-2 text-sm text-warning-700">
            The balance outstanding is not changing, so salary deductions will stay the same.
            If you meant to change what the employee still owes, enter it in Correct Balance Outstanding.
          </p>
        )}

        <Input
          label="Reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          helperText="Kept in the advance's history, e.g. 'Top-up entered twice by mistake'."
        />

        {newBalance === 0 && balance !== '' && (
          <p className="rounded-sm bg-warning-50 px-3 py-2 text-sm text-warning-700">
            A balance of RM 0.00 marks this advance as settled.
          </p>
        )}
      </div>
    </Modal>
  )
}
