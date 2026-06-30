// SalaryAdvanceForm — Add/Edit form for employee salary advances/loans.
// Editing is only allowed while status is 'active' (enforced server-side too — see
// electron/services/payroll/salaryAdvances.ts).

import { useState, useEffect } from 'react'
import { Input, Select } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { StatusBadge } from '@/shared/components/StatusBadge'
import type { SelectOption } from '@/shared/components/Input'
import type { SalaryAdvance } from '@/shared/types/entities'
import type { CreateSalaryAdvanceInput, UpdateSalaryAdvanceInput } from '@/shared/types/inputs'
import { DEDUCTION_MODE_OPTIONS, ADVANCE_STATUS_LABEL, ADVANCE_STATUS_TONE } from '../constants'

interface SalaryAdvanceFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateSalaryAdvanceInput | UpdateSalaryAdvanceInput) => Promise<void>
  onDelete?: () => Promise<void>
  isSubmitting: boolean
  isDeleting?: boolean
  advance?: SalaryAdvance | null
  employeeOptions: SelectOption[]
}

export function SalaryAdvanceForm({
  isOpen, onClose, onSubmit, onDelete, isSubmitting, isDeleting, advance, employeeOptions,
}: SalaryAdvanceFormProps) {
  const isEdit = !!advance
  const isLocked = isEdit && advance.status !== 'active'

  const [employeeId, setEmployeeId] = useState('')
  const [amount, setAmount] = useState('')
  const [dateIssued, setDateIssued] = useState('')
  const [limitMax, setLimitMax] = useState('')
  const [deductionMode, setDeductionMode] = useState<'full_balance' | 'fixed_installment'>('full_balance')
  const [installmentAmount, setInstallmentAmount] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (advance) {
      setEmployeeId(String(advance.employee_id))
      setAmount(String(advance.amount))
      setDateIssued(advance.date_issued)
      setLimitMax(String(advance.limit_max))
      setDeductionMode(advance.deduction_mode)
      setInstallmentAmount(advance.installment_amount != null ? String(advance.installment_amount) : '')
    } else {
      setEmployeeId('')
      setAmount('')
      setDateIssued(new Date().toISOString().slice(0, 10))
      setLimitMax('')
      setDeductionMode('full_balance')
      setInstallmentAmount('')
    }
    setValidationError(null)
  }, [isOpen, advance])

  function validate(): boolean {
    if (!employeeId) { setValidationError('Employee is required'); return false }
    if (!amount || Number(amount) <= 0) { setValidationError('Amount must be a positive number'); return false }
    if (!dateIssued) { setValidationError('Date issued is required'); return false }
    if (!limitMax || Number(limitMax) < Number(amount)) { setValidationError('Limit must be greater than or equal to the amount'); return false }
    if (deductionMode === 'fixed_installment' && (!installmentAmount || Number(installmentAmount) <= 0)) {
      setValidationError('Installment amount is required when deduction mode is Fixed Installment')
      return false
    }
    return true
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateSalaryAdvanceInput = {
      employee_id: Number(employeeId),
      amount: Number(amount),
      date_issued: dateIssued,
      limit_max: Number(limitMax),
      deduction_mode: deductionMode,
      installment_amount: deductionMode === 'fixed_installment' ? Number(installmentAmount) : null,
    }

    await onSubmit(data)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Salary Advance' : 'Add Salary Advance'}
      size="md"
      footer={
        <>
          {isEdit && onDelete && (
            <Button variant="danger" isLoading={isDeleting} onClick={onDelete}>
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {!isLocked && (
            <Button isLoading={isSubmitting} onClick={handleSubmit}>
              {isEdit ? 'Save Changes' : 'Add Advance'}
            </Button>
          )}
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        {isEdit && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-500">Status:</span>
            <StatusBadge tone={ADVANCE_STATUS_TONE[advance.status]}>{ADVANCE_STATUS_LABEL[advance.status]}</StatusBadge>
            <span className="text-neutral-500">Balance outstanding:</span>
            <span className="font-medium text-neutral-900">RM {advance.balance_outstanding.toFixed(2)}</span>
          </div>
        )}

        <Select
          label="Employee"
          required
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          options={employeeOptions}
          placeholder="Select an employee"
          disabled={isEdit || isLocked}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Amount (RM)"
            type="number"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLocked}
          />
          <Input
            label="Date Issued"
            type="date"
            required
            value={dateIssued}
            onChange={(e) => setDateIssued(e.target.value)}
            disabled={isLocked}
          />
        </div>

        <Input
          label="Approved Limit (RM)"
          type="number"
          step="0.01"
          required
          value={limitMax}
          onChange={(e) => setLimitMax(e.target.value)}
          helperText="Must be greater than or equal to the amount issued."
          disabled={isLocked}
        />

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Deduction Mode"
            value={deductionMode}
            onChange={(e) => setDeductionMode(e.target.value as 'full_balance' | 'fixed_installment')}
            options={DEDUCTION_MODE_OPTIONS}
            disabled={isLocked}
          />
          <Input
            label="Installment Amount (RM)"
            type="number"
            step="0.01"
            value={installmentAmount}
            onChange={(e) => setInstallmentAmount(e.target.value)}
            disabled={deductionMode !== 'fixed_installment' || isLocked}
            helperText="Deducted per payroll run until the balance is settled."
          />
        </div>
      </form>
    </Modal>
  )
}
