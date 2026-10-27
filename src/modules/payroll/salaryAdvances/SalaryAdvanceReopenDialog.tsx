// SalaryAdvanceReopenDialog — puts a settled advance back to active when the employee
// still owes money on it. The admin types the balance still owed (not a delta) and a
// reason; the change is kept in the advance's history.

import { useState, useEffect } from 'react'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { SalaryAdvance } from '@/shared/types/entities'
import type { ReopenSalaryAdvanceInput } from '@/shared/types/inputs'
import { formatRm } from './formatRm'

interface SalaryAdvanceReopenDialogProps {
  advance: SalaryAdvance | null
  onClose: () => void
}

export function SalaryAdvanceReopenDialog({ advance, onClose }: SalaryAdvanceReopenDialogProps) {
  const [balance, setBalance] = useState('')
  const [reason, setReason] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!advance) return
    setBalance('')
    setReason('')
    setValidationError(null)
  }, [advance])

  const reopenMutation = useIpcMutation<SalaryAdvance, ReopenSalaryAdvanceInput>(
    (data) => window.api.payroll.salaryAdvances.reopen(advance!.id, data),
    [['payroll', 'salaryAdvances']],
    { onSuccessMessage: 'Salary advance reopened' },
  )

  if (!advance) return null

  const newBalance = Number(balance)

  async function handleSave() {
    setValidationError(null)
    if (balance === '' || Number.isNaN(newBalance) || newBalance <= 0) {
      setValidationError('Enter the amount the employee still owes (more than 0)')
      return
    }
    if (newBalance > advance!.amount) {
      setValidationError(`The balance cannot be more than the total issued (${formatRm(advance!.amount)})`)
      return
    }
    if (!reason.trim()) { setValidationError('Please give a reason for reopening'); return }

    try {
      await reopenMutation.mutateAsync({ balance_outstanding: newBalance, reason: reason.trim() })
      onClose()
    } catch {
      // Handled by global onError toast
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Reopen Advance — ${advance.employee_name ?? `ID ${advance.employee_id}`}`}
      size="md"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button isLoading={reopenMutation.isPending} onClick={handleSave}>Reopen Advance</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-500">
          This advance is marked settled. If the employee still owes money on it, enter the
          amount still owed. It becomes active again and is deducted in the next payroll run.
        </p>

        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <Input
          label="Amount Still Owed (RM)"
          type="number"
          step="0.01"
          required
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          helperText={`The balance to be deducted from salary. Total issued on this advance: ${formatRm(advance.amount)}.`}
        />

        <Input
          label="Reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          helperText="Kept in the advance's history, e.g. 'Net pay was too low to deduct the full amount in the September run'."
        />
      </div>
    </Modal>
  )
}
