// SalaryAdvanceListPage — list + CRUD for employee salary advances/loans.

import { useState, useCallback, useMemo } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { SalaryAdvanceForm } from './SalaryAdvanceForm'
import type { Column } from '@/shared/components/Table'
import type { Employee, SalaryAdvance } from '@/shared/types/entities'
import type { CreateSalaryAdvanceInput, UpdateSalaryAdvanceInput } from '@/shared/types/inputs'
import { ADVANCE_STATUS_LABEL, ADVANCE_STATUS_TONE, DEDUCTION_MODE_LABEL } from '../constants'

const columns: Column<SalaryAdvance>[] = [
  { key: 'employee_name', header: 'Employee', accessor: (r) => r.employee_name || `ID ${r.employee_id}`, sortable: true, sortValue: (r) => r.employee_name || '' },
  { key: 'date_issued', header: 'Date Issued', accessor: (r) => r.date_issued, sortable: true, sortValue: (r) => r.date_issued },
  { key: 'amount', header: 'Amount', accessor: (r) => `RM ${r.amount.toFixed(2)}`, sortable: true, sortValue: (r) => r.amount, align: 'right' },
  { key: 'balance', header: 'Balance Outstanding', accessor: (r) => `RM ${r.balance_outstanding.toFixed(2)}`, sortable: true, sortValue: (r) => r.balance_outstanding, align: 'right' },
  { key: 'deduction_mode', header: 'Deduction Mode', accessor: (r) => DEDUCTION_MODE_LABEL[r.deduction_mode], sortable: true, sortValue: (r) => r.deduction_mode },
  {
    key: 'status',
    header: 'Status',
    accessor: (r) => <StatusBadge tone={ADVANCE_STATUS_TONE[r.status]}>{ADVANCE_STATUS_LABEL[r.status]}</StatusBadge>,
    sortable: true,
    sortValue: (r) => r.status,
    align: 'center',
    width: '100px',
  },
]

export function SalaryAdvanceListPage() {
  const { data: advances = [], isLoading } = useIpcQuery<SalaryAdvance[]>(
    ['payroll', 'salaryAdvances'],
    () => window.api.payroll.salaryAdvances.list(),
  )

  const { data: employees = [] } = useIpcQuery<Employee[]>(
    ['employees'],
    () => window.api.employees.list(),
  )

  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: String(e.id), label: `${e.name} (${e.employee_code})` })),
    [employees],
  )

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingAdvance, setEditingAdvance] = useState<SalaryAdvance | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const createMutation = useIpcMutation<SalaryAdvance, CreateSalaryAdvanceInput>(
    (data) => window.api.payroll.salaryAdvances.create(data),
    [['payroll', 'salaryAdvances']],
    { onSuccessMessage: 'Salary advance created successfully' },
  )

  const updateMutation = useIpcMutation<SalaryAdvance, { id: number; data: UpdateSalaryAdvanceInput }>(
    ({ id, data }) => window.api.payroll.salaryAdvances.update(id, data),
    [['payroll', 'salaryAdvances']],
    { onSuccessMessage: 'Salary advance updated successfully' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.payroll.salaryAdvances.delete(id),
    [['payroll', 'salaryAdvances']],
    { onSuccessMessage: 'Salary advance deleted successfully' },
  )

  const handleCreate = useCallback(() => {
    setEditingAdvance(null)
    setIsFormOpen(true)
  }, [])

  const handleEdit = useCallback((advance: SalaryAdvance) => {
    setEditingAdvance(advance)
    setIsFormOpen(true)
  }, [])

  const handleFormSubmit = useCallback(
    async (data: CreateSalaryAdvanceInput | UpdateSalaryAdvanceInput) => {
      if (editingAdvance) {
        await updateMutation.mutateAsync({ id: editingAdvance.id, data: data as UpdateSalaryAdvanceInput })
      } else {
        await createMutation.mutateAsync(data as CreateSalaryAdvanceInput)
      }
      setIsFormOpen(false)
      setEditingAdvance(null)
    },
    [editingAdvance, createMutation, updateMutation],
  )

  const handleDelete = useCallback(async () => {
    if (!editingAdvance) return
    setShowDeleteConfirm(true)
  }, [editingAdvance])

  const handleConfirmDelete = useCallback(async () => {
    if (!editingAdvance) return
    await deleteMutation.mutateAsync(editingAdvance.id)
    setIsFormOpen(false)
    setEditingAdvance(null)
    setShowDeleteConfirm(false)
  }, [editingAdvance, deleteMutation])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          {advances.length} advance{advances.length !== 1 ? 's' : ''}
        </p>
        <Button onClick={handleCreate}>Add Salary Advance</Button>
      </div>

      <Table
        columns={columns}
        data={advances}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No salary advances yet',
          action: (
            <div className="mt-3 flex justify-center">
              <Button size="sm" onClick={handleCreate}>Add Salary Advance</Button>
            </div>
          ),
        }}
        onRowClick={handleEdit}
      />

      <SalaryAdvanceForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingAdvance(null) }}
        onSubmit={handleFormSubmit}
        onDelete={handleDelete}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isDeleting={deleteMutation.isPending}
        advance={editingAdvance}
        employeeOptions={employeeOptions}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Salary Advance"
        message="Are you sure you want to delete this salary advance? This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
