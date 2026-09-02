// AdhocAllowancePanel — ad-hoc, per-run, variable allowance entries for a draft
// payroll run. Unlike CommissionPanel (one entry per employee per run), an
// employee can have SEVERAL of these in the same run, each with its own
// description (e.g. "Buka Pagar" = 35 trips x RM5, plus a separate "Elaun
// Lain"). Entries are draft-only (locked once finalized — enforced server-side
// in electron/services/payroll/adhocAllowances.ts). List + inline add row, no
// edit-in-place — correcting an entry is delete-and-recreate.

import { useState, useMemo } from 'react'
import { Card } from '@/shared/components/Card'
import { Button } from '@/shared/components/Button'
import { Input, Select } from '@/shared/components/Input'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { SelectOption } from '@/shared/components/Input'
import type { Employee, PayrollRunAllowance } from '@/shared/types/entities'
import type { UpsertPayrollRunAllowanceInput } from '@/shared/types/inputs'

interface AdhocAllowancePanelProps {
  runId: number
  disabled: boolean
}

function formatCurrency(amount: number): string {
  return `RM ${amount.toFixed(2)}`
}

export function AdhocAllowancePanel({ runId, disabled }: AdhocAllowancePanelProps) {
  const queryKey = ['payroll', 'runs', String(runId), 'allowances']

  const { data: allowances = [], isLoading } = useIpcQuery<PayrollRunAllowance[]>(
    queryKey,
    () => window.api.payroll.runs.allowances.list(runId),
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
  const [quantity, setQuantity] = useState('')
  const [ratePerUnit, setRatePerUnit] = useState('')
  const [note, setNote] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PayrollRunAllowance | null>(null)

  const computedAmount = quantity !== '' && ratePerUnit !== ''
    && !Number.isNaN(Number(quantity)) && !Number.isNaN(Number(ratePerUnit))
    ? Number(quantity) * Number(ratePerUnit)
    : null

  const createMutation = useIpcMutation<PayrollRunAllowance, UpsertPayrollRunAllowanceInput>(
    (data) => window.api.payroll.runs.allowances.create(runId, data),
    [queryKey],
    { onSuccessMessage: 'Allowance saved. Click Calculate/Recalculate below to apply it.' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (allowanceId) => window.api.payroll.runs.allowances.delete(runId, allowanceId),
    [queryKey],
    { onSuccessMessage: 'Allowance removed.' },
  )

  async function handleAdd() {
    if (!employeeId || !description.trim() || computedAmount == null) return
    await createMutation.mutateAsync({
      employee_id: Number(employeeId),
      description: description.trim(),
      quantity: Number(quantity),
      rate_per_unit: Number(ratePerUnit),
      note: note.trim() ? note.trim() : null,
    })
    setEmployeeId('')
    setDescription('')
    setQuantity('')
    setRatePerUnit('')
    setNote('')
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return
    await deleteMutation.mutateAsync(pendingDelete.id)
    setPendingDelete(null)
  }

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-white">Ad-hoc Allowances (this run only)</h3>
      <p className="mb-4 text-xs text-neutral-500">
        Variable allowances that change month to month, e.g. "Buka Pagar" = 35 trips × RM5.
        An employee can have several differently-named entries in the same run. Added to
        gross/net pay and PCB, but excluded from the EPF/SOCSO/EIS base (unlike Commission
        above). {disabled
          ? 'This run is finalized — allowance entries are locked.'
          : 'Add entries below, then click Calculate/Recalculate to apply them.'}
      </p>

      {!isLoading && allowances.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {allowances.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium text-neutral-800 dark:text-white">
                  {a.employee_name || `ID ${a.employee_id}`}
                </span>
                <span className="ml-2 text-neutral-700">{a.description}</span>
                {a.quantity != null && a.rate_per_unit != null && (
                  <span className="ml-2 text-xs text-neutral-500">
                    ({a.quantity} × {formatCurrency(a.rate_per_unit)})
                  </span>
                )}
                {a.note && <span className="ml-2 text-xs text-neutral-500">{a.note}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums">{formatCurrency(a.amount)}</span>
                {!disabled && (
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(a)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1.5fr_1.5fr_1fr_1fr_1.5fr_auto]">
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
            placeholder="e.g. Buka Pagar"
          />
          <Input
            label="Quantity"
            type="number"
            step="0.01"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="35"
          />
          <Input
            label="Rate/Unit (RM)"
            type="number"
            step="0.01"
            min="0"
            value={ratePerUnit}
            onChange={(e) => setRatePerUnit(e.target.value)}
            placeholder="5.00"
            helperText={computedAmount != null ? `= ${formatCurrency(computedAmount)}` : undefined}
          />
          <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button onClick={handleAdd} isLoading={createMutation.isPending}>
            Add
          </Button>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!pendingDelete}
        title="Remove Allowance"
        message={`Remove "${pendingDelete?.description}" for ${pendingDelete?.employee_name || 'this employee'}?`}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  )
}
