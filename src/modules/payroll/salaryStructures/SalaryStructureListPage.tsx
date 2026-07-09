// SalaryStructureListPage — list + CRUD for per-employee salary structures.
// Mirrors SupplierListPage.tsx's structure.

import { useState, useCallback, useMemo } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { SalaryStructureForm } from './SalaryStructureForm'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import type { Column } from '@/shared/components/Table'
import type { Employee, SalaryStructure } from '@/shared/types/entities'
import type { CreateSalaryStructureInput, UpdateSalaryStructureInput } from '@/shared/types/inputs'
import { RATE_TYPE_LABEL } from '../constants'

const columns: Column<SalaryStructure>[] = [
  { key: 'employee_name', header: 'Employee', accessor: (r) => r.employee_name || `ID ${r.employee_id}`, sortable: true, sortValue: (r) => r.employee_name || '' },
  { key: 'effective_from', header: 'Effective From', accessor: (r) => r.effective_from, sortable: true, sortValue: (r) => r.effective_from },
  { key: 'rate_type', header: 'Rate Type', accessor: (r) => RATE_TYPE_LABEL[r.rate_type], sortable: true, sortValue: (r) => r.rate_type, align: 'center' },
  { key: 'rate_amount', header: 'Rate', accessor: (r) => `RM ${r.rate_amount.toFixed(2)}`, sortable: true, sortValue: (r) => r.rate_amount, align: 'right' },
  { key: 'standard_hours', header: 'Std Hrs/Day', accessor: (r) => r.standard_hours_per_day, sortable: true, sortValue: (r) => r.standard_hours_per_day, align: 'right', width: '100px' },
  {
    key: 'statutory',
    header: 'Statutory',
    accessor: (r) => (
      <div className="flex justify-center gap-1">
        <StatusBadge tone={r.subject_to_epf ? 'success' : 'neutral'}>EPF</StatusBadge>
        <StatusBadge tone={r.subject_to_socso ? 'success' : 'neutral'}>SOCSO</StatusBadge>
        <StatusBadge tone={r.subject_to_eis ? 'success' : 'neutral'}>EIS</StatusBadge>
      </div>
    ),
    align: 'center',
  },
]

export function SalaryStructureListPage() {
  const { data: structures = [], isLoading } = useIpcQuery<SalaryStructure[]>(
    ['payroll', 'salaryStructures'],
    () => window.api.payroll.salaryStructures.list(),
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
  const [editingStructure, setEditingStructure] = useState<SalaryStructure | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const createMutation = useIpcMutation<SalaryStructure, CreateSalaryStructureInput>(
    (data) => window.api.payroll.salaryStructures.create(data),
    [['payroll', 'salaryStructures']],
    { onSuccessMessage: 'Salary structure created successfully' },
  )

  const updateMutation = useIpcMutation<SalaryStructure, { id: number; data: UpdateSalaryStructureInput }>(
    ({ id, data }) => window.api.payroll.salaryStructures.update(id, data),
    [['payroll', 'salaryStructures']],
    { onSuccessMessage: 'Salary structure updated successfully' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.payroll.salaryStructures.delete(id),
    [['payroll', 'salaryStructures']],
    { onSuccessMessage: 'Salary structure deleted successfully' },
  )

  const handleCreate = useCallback(() => {
    setEditingStructure(null)
    setIsFormOpen(true)
  }, [])

  const handleEdit = useCallback((structure: SalaryStructure) => {
    setEditingStructure(structure)
    setIsFormOpen(true)
  }, [])

  const handleFormSubmit = useCallback(
    async (data: CreateSalaryStructureInput | UpdateSalaryStructureInput) => {
      if (editingStructure) {
        await updateMutation.mutateAsync({ id: editingStructure.id, data: data as UpdateSalaryStructureInput })
      } else {
        await createMutation.mutateAsync(data as CreateSalaryStructureInput)
      }
      setIsFormOpen(false)
      setEditingStructure(null)
    },
    [editingStructure, createMutation, updateMutation],
  )

  const handleDelete = useCallback(async () => {
    if (!editingStructure) return
    setShowDeleteConfirm(true)
  }, [editingStructure])

  const handleConfirmDelete = useCallback(async () => {
    if (!editingStructure) return
    try {
      await deleteMutation.mutateAsync(editingStructure.id)
      setIsFormOpen(false)
      setEditingStructure(null)
      setShowDeleteConfirm(false)
    } catch {
      // Handled by global onError toast
    }
  }, [editingStructure, deleteMutation])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          {structures.length} salary structure{structures.length !== 1 ? 's' : ''}
        </p>
        <Button onClick={handleCreate}>Add Salary Structure</Button>
      </div>

      <Table
        columns={columns}
        data={structures}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No salary structures yet',
          description: 'Add a salary structure for each employee before running payroll.',
          action: (
            <div className="mt-3 flex justify-center">
              <Button size="sm" onClick={handleCreate}>Add Salary Structure</Button>
            </div>
          ),
        }}
        onRowClick={handleEdit}
      />

      <SalaryStructureForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingStructure(null) }}
        onSubmit={handleFormSubmit}
        onDelete={handleDelete}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isDeleting={deleteMutation.isPending}
        structure={editingStructure}
        employeeOptions={employeeOptions}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Salary Structure"
        message="Are you sure you want to delete this salary structure? This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
