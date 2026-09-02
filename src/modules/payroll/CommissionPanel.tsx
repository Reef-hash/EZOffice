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
  const [salesAmount, setSalesAmount] = useState('')
  const [commissionRate, setCommissionRate] = useState('')
  const [note, setNote] = useState('')
  const [statutoryBaseOverride, setStatutoryBaseOverride] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PayrollRunCommission | null>(null)

  // Live preview only — the authoritative amount is always recomputed server-side
  // (see commissions.ts upsertCommission) from the same sales_amount/commission_rate.
  const computedAmount = salesAmount !== '' && !Number.isNaN(Number(salesAmount))
    ? Number(salesAmount) * (commissionRate !== '' ? Number(commissionRate) / 100 : 1)
    : null

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
    if (!employeeId || salesAmount === '' || Number(salesAmount) < 0) return
    await upsertMutation.mutateAsync({
      employee_id: Number(employeeId),
      sales_amount: Number(salesAmount),
      commission_rate: commissionRate.trim() ? Number(commissionRate) : undefined,
      note: note.trim() ? note.trim() : null,
      statutory_base_override: statutoryBaseOverride.trim() ? Number(statutoryBaseOverride) : null,
    })
    setEmployeeId('')
    setSalesAmount('')
    setCommissionRate('')
    setNote('')
    setStatutoryBaseOverride('')
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
        Enter the total sales amount and a commission rate — the commission is computed as
        Sales × Rate (e.g. RM12,690 × 20% = RM2,538). Leave Rate blank to use the sales figure
        directly as the commission. For a commission-only employee, the EPF/SOCSO/EIS Base below
        (default: the employee's recurring base) is shown as "Basic Salary" on the payslip and
        given full EPF/SOCSO/EIS treatment; the remainder is shown as "Commission". For any other
        employee, the full commission is added on top of their normal pay. {disabled
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
                {c.sales_amount != null && (
                  <span className="ml-2 text-xs text-neutral-500">
                    ({formatCurrency(c.sales_amount)} × {c.commission_rate ?? 100}%)
                  </span>
                )}
                {c.note && <span className="ml-2 text-xs text-neutral-500">{c.note}</span>}
                {c.statutory_base_override != null && (
                  <span className="ml-2 text-xs text-neutral-500">
                    (EPF/SOCSO/EIS base: {formatCurrency(c.statutory_base_override)})
                  </span>
                )}
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
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_2fr_auto]">
          <Select
            label="Employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            options={employeeOptions}
            placeholder="Select an employee"
          />
          <Input
            label="Sales Amount (RM)"
            type="number"
            step="0.01"
            min="0"
            value={salesAmount}
            onChange={(e) => setSalesAmount(e.target.value)}
          />
          <Input
            label="Commission Rate (%)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={commissionRate}
            onChange={(e) => setCommissionRate(e.target.value)}
            placeholder="100"
            helperText={computedAmount != null ? `= ${formatCurrency(computedAmount)}` : undefined}
          />
          <Input
            label="EPF/SOCSO/EIS Base (RM)"
            type="number"
            step="0.01"
            min="0"
            value={statutoryBaseOverride}
            onChange={(e) => setStatutoryBaseOverride(e.target.value)}
            placeholder="Optional"
            helperText="Only for commission-only employees. Leave blank to use the employee's recurring default."
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
