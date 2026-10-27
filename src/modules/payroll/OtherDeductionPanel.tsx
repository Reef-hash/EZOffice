// OtherDeductionPanel — one-off or catch-up deductions for a draft payroll run, each
// with its own label (e.g. "Caruman tertunggak SOCSO/EIS Jan–Sep"). An employee can
// have several. They show as their own line on the payslip, so they must be used for
// money the employee genuinely owes the company, not disguised as a salary advance.
// Entries are draft-only (locked once finalized — enforced server-side in
// electron/services/payroll/otherDeductions.ts). List + inline add row, no
// edit-in-place — correcting an entry is delete-and-recreate.

import { useState, useMemo } from 'react'
import { Card } from '@/shared/components/Card'
import { Button } from '@/shared/components/Button'
import { Input, Select } from '@/shared/components/Input'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { SelectOption } from '@/shared/components/Input'
import type { Employee, PayrollRunDeduction } from '@/shared/types/entities'
import type { CreatePayrollRunDeductionInput } from '@/shared/types/inputs'

interface OtherDeductionPanelProps {
  runId: number
  disabled: boolean
}

function formatCurrency(amount: number): string {
  return `RM ${amount.toFixed(2)}`
}

export function OtherDeductionPanel({ runId, disabled }: OtherDeductionPanelProps) {
  const queryKey = ['payroll', 'runs', String(runId), 'deductions']

  const { data: deductions = [], isLoading } = useIpcQuery<PayrollRunDeduction[]>(
    queryKey,
    () => window.api.payroll.runs.deductions.list(runId),
  )

  const { data: employees = [] } = useIpcQuery<Employee[]>(
    ['employees'],
    () => window.api.employees.list(),
  )

  const employeeOptions: SelectOption[] = useMemo(
    () => employees
      .filter((e) => e.status === 'active')
      .map((e) => ({ value: String(e.id), label: `${e.name} (${e.employee_code})` })),
    [employees],
  )

  const [employeeId, setEmployeeId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PayrollRunDeduction | null>(null)

  const parsedAmount = amount === '' ? null : Number(amount)
  const canAdd = !!employeeId && !!description.trim() && parsedAmount != null && parsedAmount > 0

  const createMutation = useIpcMutation<PayrollRunDeduction, CreatePayrollRunDeductionInput>(
    (data) => window.api.payroll.runs.deductions.create(runId, data),
    [queryKey],
    { onSuccessMessage: 'Deduction saved. Click Calculate/Recalculate below to apply it.' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (deductionId) => window.api.payroll.runs.deductions.delete(runId, deductionId),
    [queryKey],
    { onSuccessMessage: 'Deduction removed.' },
  )

  async function handleAdd() {
    if (!canAdd || parsedAmount == null) return
    await createMutation.mutateAsync({
      employee_id: Number(employeeId),
      description: description.trim(),
      amount: parsedAmount,
      note: note.trim() ? note.trim() : null,
    })
    setEmployeeId('')
    setDescription('')
    setAmount('')
    setNote('')
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return
    await deleteMutation.mutateAsync(pendingDelete.id)
    setPendingDelete(null)
  }

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-white">Other Deductions (this run only)</h3>
      <p className="mb-4 text-xs text-neutral-500">
        One-off or catch-up deductions with their own label, e.g. the employee's share of SOCSO/EIS the
        company paid but never deducted. Enter only what the employee owes (never the employer's share).
        Each shows as its own line on the payslip and is taken from net pay in full, before any salary
        advance. {disabled
          ? 'This run is finalized — deduction entries are locked.'
          : 'Add entries below, then click Calculate/Recalculate to apply them.'}
      </p>

      {!isLoading && deductions.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {deductions.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium text-neutral-800 dark:text-white">
                  {d.employee_name || `ID ${d.employee_id}`}
                </span>
                <span className="ml-2 text-neutral-700">{d.description}</span>
                {d.note && <span className="ml-2 text-xs text-neutral-500">{d.note}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums">{formatCurrency(d.amount)}</span>
                {!disabled && (
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(d)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1.5fr_2fr_1fr_1.5fr_auto]">
          <Select
            label="Employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            options={employeeOptions}
            placeholder="Select an employee"
          />
          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Caruman tertunggak SOCSO/EIS Jan–Sep"
          />
          <Input
            label="Amount (RM)"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button onClick={handleAdd} isLoading={createMutation.isPending} disabled={!canAdd}>
            Add
          </Button>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!pendingDelete}
        title="Remove Deduction"
        message={`Remove "${pendingDelete?.description}" for ${pendingDelete?.employee_name || 'this employee'}?`}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  )
}
