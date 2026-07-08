// EmployeeListPage — list + CRUD + CSV import for Employees.

import { useState, useCallback } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PageHeader } from '@/shared/components/PageHeader'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useToast } from '@/shared/components/Toast'
import { useKeyboardShortcut } from '@/shared/hooks/useKeyboardShortcut'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { EmployeeForm } from './EmployeeForm'
import { EmployeeImportDialog } from './EmployeeImportDialog'
import { EMPLOYEE_STATUS_TONE, EMPLOYEE_STATUS_LABEL } from './constants'
import type { Column } from '@/shared/components/Table'
import type { Employee } from '@/shared/types/entities'
import type { CreateEmployeeInput, UpdateEmployeeInput } from '@/shared/types/inputs'

const columns: Column<Employee>[] = [
  { key: 'employee_code', header: 'Code', accessor: (r) => r.employee_code, sortable: true, sortValue: (r) => r.employee_code, width: '90px' },
  { key: 'name', header: 'Name', accessor: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: 'ic_number', header: 'IC Number', accessor: (r) => r.ic_number, sortable: true, sortValue: (r) => r.ic_number, width: '140px' },
  { key: 'department_name', header: 'Department', accessor: (r) => r.department_name || '—', sortable: true, sortValue: (r) => r.department_name || '' },
  { key: 'position', header: 'Position', accessor: (r) => r.position || '—', sortable: true, sortValue: (r) => r.position || '' },
  {
    key: 'status',
    header: 'Status',
    accessor: (r) => (
      <StatusBadge tone={EMPLOYEE_STATUS_TONE[r.status]}>
        {EMPLOYEE_STATUS_LABEL[r.status]}
      </StatusBadge>
    ),
    sortable: true,
    sortValue: (r) => r.status,
    width: '90px',
  },
]

export function EmployeeListPage() {
  const { addToast } = useToast()
  const { data: employees = [], isLoading } = useIpcQuery<Employee[]>(
    ['employees'],
    () => window.api.employees.list(),
  )

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Mutations
  const createMutation = useIpcMutation<Employee, CreateEmployeeInput>(
    (data) => window.api.employees.create(data),
    [['employees']],
    { onSuccessMessage: 'Employee created successfully' },
  )

  const updateMutation = useIpcMutation<Employee, { id: number; data: UpdateEmployeeInput }>(
    ({ id, data }) => window.api.employees.update(id, data),
    [['employees']],
    { onSuccessMessage: 'Employee updated successfully' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.employees.delete(id),
    [['employees']],
    { onSuccessMessage: 'Employee deleted successfully' },
  )

  const handleCreate = useCallback(() => {
    setEditingEmployee(null)
    setIsFormOpen(true)
  }, [])

  useKeyboardShortcut([
    {
      key: 'n',
      ctrlKey: true,
      callback: handleCreate,
    },
  ])

  const handleEdit = useCallback((employee: Employee) => {
    setEditingEmployee(employee)
    setIsFormOpen(true)
  }, [])

  const handleFormSubmit = useCallback(
    async (data: CreateEmployeeInput | UpdateEmployeeInput) => {
      if (editingEmployee) {
        await updateMutation.mutateAsync({ id: editingEmployee.id, data })
      } else {
        await createMutation.mutateAsync(data as CreateEmployeeInput)
      }
      setIsFormOpen(false)
      setEditingEmployee(null)
    },
    [editingEmployee, createMutation, updateMutation],
  )

  const handleExport = useCallback(async () => {
    try {
      await window.api.export.employees()
    } catch (err) {
      addToast(`Export failed: ${String(err)}`, 'error')
    }
  }, [addToast])

  const handleDelete = useCallback(async () => {
    if (!editingEmployee) return
    setShowDeleteConfirm(true)
  }, [editingEmployee])

  const handleConfirmDelete = useCallback(async () => {
    if (!editingEmployee) return
    try {
      await deleteMutation.mutateAsync(editingEmployee.id)
      setIsFormOpen(false)
      setEditingEmployee(null)
      setShowDeleteConfirm(false)
    } catch {
      // Handled by global onError toast
    }
  }, [editingEmployee, deleteMutation])

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${employees.length} employee${employees.length !== 1 ? 's' : ''}`}
        actions={
          <>
            <Button variant="secondary" onClick={handleExport}>
              Export
            </Button>
            <Button variant="secondary" onClick={() => setIsImportOpen(true)}>
              Import CSV
            </Button>
            <Button onClick={handleCreate}>Add Employee</Button>
          </>
        }
      />

      <Table
        columns={columns}
        data={employees}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No employees yet',
          description: 'Add your first employee manually or import from a CSV file.',
          action: (
            <div className="mt-3 flex justify-center gap-2">
              <Button size="sm" onClick={handleCreate}>
                Add Employee
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setIsImportOpen(true)}>
                Import CSV
              </Button>
            </div>
          ),
        }}
        onRowClick={handleEdit}
      />

      {/* Inline action buttons per row — using a separate action column approach via onRowClick */}
      <div className="mt-4 flex gap-2">
        {employees.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              // Delete is handled per-row via the onRowClick → edit → delete pattern,
              // but we also give a quick action hint
            }}
            className="invisible"
          >
            Delete
          </Button>
        )}
      </div>

      <EmployeeForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false)
          setEditingEmployee(null)
        }}
        onSubmit={handleFormSubmit}
        onDelete={handleDelete}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isDeleting={deleteMutation.isPending}
        employee={editingEmployee}
      />

      <EmployeeImportDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImport={async (rows) => {
          return window.api.employees.importCsv(rows)
        }}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Employee"
        message={`Are you sure you want to delete employee "${editingEmployee?.name || ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
