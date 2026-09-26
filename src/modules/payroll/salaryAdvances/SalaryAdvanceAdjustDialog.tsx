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
  const [reason, setReason] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!advance) return
    setBalance(String(advance.balance_outstanding))
    setAmount(String(advance.amount))
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
  const newAmount = Number(amount)

  async function handleSave() {
    setValidationError(null)
    if (balance === '' || Number.isNaN(newBalance) || newBalance < 0) {
      setValidationError('Enter the correct balance outstanding (0 or more)')
      return
    }
    if (!amount || Number.isNaN(newAmount) || newAmount <= 0) {
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
        amount: newAmount !== advance!.amount ? newAmount : undefined,
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
          Use this only to fix a wrong balance. Enter the <strong>correct</strong> figures, not an
          amount to add or subtract. To lend more money, use Top Up instead.
        </p>

        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Correct Balance Outstanding (RM)"
            type="number"
            step="0.01"
            required
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            helperText={`Currently ${formatRm(advance.balance_outstanding)}. This is what will be deducted.`}
          />
          <Input
            label="Correct Total Issued (RM)"
            type="number"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            helperText={`Currently ${formatRm(advance.amount)}.`}
          />
        </div>

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
