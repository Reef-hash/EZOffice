// CommissionPanel — ad-hoc, per-run sales commission entry for a draft payroll run.
// Entries are draft-only (locked once the run is finalized — enforced server-side in
// electron/services/payroll/commissions.ts). List + inline add row, no edit-in-place —
// re-adding the same employee overwrites the amount (UNIQUE(payroll_run_id, employee_id)
// upsert), same lightweight pattern as the rate table sections.

import { useState, useMemo } from 'react'
import { Card } from '@/shared/components/Card'
import { Button } from '@/shared/components/Button'
import { Input, Select } from '@/shared/components/Input'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { SelectOption } from '@/shared/components/Input'
import type { Employee, PayrollRunCommission } from '@/shared/types/entities'
import type { UpsertPayrollRunCommissionInput } from '@/shared/types/inputs'

interface CommissionPanelProps {
  runId: number
  disabled: boolean
}

function formatCurrency(amount: number): string {
  return `RM ${amount.toFixed(2)}`
}

export function CommissionPanel({ runId, disabled }: CommissionPanelProps) {
  const queryKey = ['payroll', 'runs', String(runId), 'commissions']

  const { data: commissions = [], isLoading } = useIpcQuery<PayrollRunCommission[]>(
    queryKey,
    () => window.api.payroll.runs.commissions.list(runId),
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
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PayrollRunCommission | null>(null)

  const upsertMutation = useIpcMutation<PayrollRunCommission, UpsertPayrollRunCommissionInput>(
    (data) => window.api.payroll.runs.commissions.upsert(runId, data),
    [queryKey],
    { onSuccessMessage: 'Commission saved. Click Calculate/Recalculate below to apply it.' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (targetEmployeeId) => window.api.payroll.runs.commissions.delete(runId, targetEmployeeId),
    [queryKey],
    { onSuccessMessage: 'Commission removed.' },
  )

  async function handleAdd() {
    if (!employeeId || amount === '' || Number(amount) < 0) return
    await upsertMutation.mutateAsync({
      employee_id: Number(employeeId),
      amount: Number(amount),
      note: note.trim() ? note.trim() : null,
    })
    setEmployeeId('')
    setAmount('')
    setNote('')
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return
    await deleteMutation.mutateAsync(pendingDelete.employee_id)
    setPendingDelete(null)
  }

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-white">Commission (this run only)</h3>
      <p className="mb-4 text-xs text-neutral-500">
        One-off sales commission for selected employees, this payroll period only — included in the
        EPF/SOCSO/EIS/PCB base same as basic wages. {disabled
          ? 'This run is finalized — commission entries are locked.'
          : 'Add entries below, then click Calculate/Recalculate to apply them.'}
      </p>

      {!isLoading && commissions.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {commissions.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium text-neutral-800 dark:text-white">
                  {c.employee_name || `ID ${c.employee_id}`}
                </span>
                {c.note && <span className="ml-2 text-xs text-neutral-500">{c.note}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums">{formatCurrency(c.amount)}</span>
                {!disabled && (
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(c)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_2fr_auto]">
          <Select
            label="Employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            options={employeeOptions}
            placeholder="Select an employee"
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
          <Button onClick={handleAdd} isLoading={upsertMutation.isPending}>
            Add
          </Button>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!pendingDelete}
        title="Remove Commission"
        message={`Remove the commission entry for ${pendingDelete?.employee_name || 'this employee'}?`}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  )
}
