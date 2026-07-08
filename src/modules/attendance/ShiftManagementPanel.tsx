// ShiftManagementPanel — list/create/update/delete shifts (Phase C1).
// Reuses the shared Table/Button/Modal/Input primitives and the useIpcQuery/useIpcMutation hooks.
// Pattern mirrors SupplierListPage + SupplierForm: a list table plus a modal form for add/edit/delete.

import { useState, useCallback, useEffect } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Modal } from '@/shared/components/Modal'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { Column } from '@/shared/components/Table'
import type { Shift } from '@/shared/types/entities'
import type { CreateShiftInput, UpdateShiftInput } from '@/shared/types/inputs'

const columns: Column<Shift>[] = [
  { key: 'name', header: 'Shift Name', accessor: (s) => s.name, sortable: true, sortValue: (s) => s.name },
  { key: 'start_time', header: 'Start', accessor: (s) => s.start_time, sortable: true, sortValue: (s) => s.start_time, align: 'center', width: '100px' },
  { key: 'end_time', header: 'End', accessor: (s) => s.end_time, sortable: true, sortValue: (s) => s.end_time, align: 'center', width: '100px' },
  { key: 'standard_hours', header: 'Std Hours', accessor: (s) => s.standard_hours, sortable: true, sortValue: (s) => s.standard_hours, align: 'right', width: '110px' },
]

export function ShiftManagementPanel() {
  const { data: shifts = [], isLoading } = useIpcQuery<Shift[]>(
    ['attendance', 'shifts'],
    () => window.api.attendance.listShifts(),
  )

  const createMutation = useIpcMutation<Shift, CreateShiftInput>(
    (data) => window.api.attendance.createShift(data),
    [['attendance', 'shifts']],
    { onSuccessMessage: 'Shift created successfully' },
  )

  const updateMutation = useIpcMutation<Shift, { id: number; data: UpdateShiftInput }>(
    ({ id, data }) => window.api.attendance.updateShift(id, data),
    [['attendance', 'shifts']],
    { onSuccessMessage: 'Shift updated successfully' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.attendance.deleteShift(id),
    [['attendance', 'shifts']],
    { onSuccessMessage: 'Shift deleted successfully' },
  )

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingShift, setEditingShift] = useState<Shift | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleCreate = useCallback(() => {
    setEditingShift(null)
    setIsFormOpen(true)
  }, [])

  const handleEdit = useCallback((shift: Shift) => {
    setEditingShift(shift)
    setIsFormOpen(true)
  }, [])

  const handleFormSubmit = useCallback(
    async (data: CreateShiftInput | UpdateShiftInput) => {
      if (editingShift) {
        await updateMutation.mutateAsync({ id: editingShift.id, data: data as UpdateShiftInput })
      } else {
        await createMutation.mutateAsync(data as CreateShiftInput)
      }
      setIsFormOpen(false)
      setEditingShift(null)
    },
    [editingShift, createMutation, updateMutation],
  )

  const handleDelete = useCallback(async () => {
    if (!editingShift) return
    setShowDeleteConfirm(true)
  }, [editingShift])

  const handleConfirmDelete = useCallback(async () => {
    if (!editingShift) return
    await deleteMutation.mutateAsync(editingShift.id)
    setIsFormOpen(false)
    setEditingShift(null)
    setShowDeleteConfirm(false)
  }, [editingShift, deleteMutation])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shifts"
        subtitle={`${shifts.length} shift${shifts.length !== 1 ? 's' : ''} defined`}
        actions={<Button onClick={handleCreate}>Add Shift</Button>}
      />

      <Table
        columns={columns}
        data={shifts}
        rowKey={(s) => String(s.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No shifts defined',
          description: 'Define shifts so clock-in times can be validated against a start time and grace period.',
          action: (
            <div className="mt-3 flex justify-center">
              <Button size="sm" onClick={handleCreate}>Add Shift</Button>
            </div>
          ),
        }}
        onRowClick={handleEdit}
      />

      <ShiftForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingShift(null) }}
        onSubmit={handleFormSubmit}
        onDelete={handleDelete}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isDeleting={deleteMutation.isPending}
        shift={editingShift}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Shift"
        message={`Are you sure you want to delete shift "${editingShift?.name || ''}"? Employees assigned to it will lose their shift.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}

// --- ShiftForm — modal add/edit form for a single shift. ---------------------

interface ShiftFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateShiftInput | UpdateShiftInput) => Promise<void>
  onDelete?: () => Promise<void>
  isSubmitting: boolean
  isDeleting?: boolean
  shift?: Shift | null
}

function ShiftForm({ isOpen, onClose, onSubmit, onDelete, isSubmitting, isDeleting, shift }: ShiftFormProps) {
  const isEdit = !!shift

  const [name, setName] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('18:00')
  const [standardHours, setStandardHours] = useState('8')
  const [validationError, setValidationError] = useState<string | null>(null)

  // Reset fields whenever the modal opens or the shift being edited changes.
  useEffect(() => {
    if (!isOpen) return
    if (shift) {
      setName(shift.name)
      setStartTime(shift.start_time)
      setEndTime(shift.end_time)
      setStandardHours(String(shift.standard_hours))
    } else {
      setName('')
      setStartTime('09:00')
      setEndTime('18:00')
      setStandardHours('8')
    }
    setValidationError(null)
  }, [isOpen, shift])

  function validate(): boolean {
    if (!name.trim()) { setValidationError('Shift name is required'); return false }
    if (!/^\d{2}:\d{2}$/.test(startTime)) { setValidationError('Start time must be HH:MM'); return false }
    if (!/^\d{2}:\d{2}$/.test(endTime)) { setValidationError('End time must be HH:MM'); return false }
    const hrs = Number(standardHours)
    if (!Number.isFinite(hrs) || hrs <= 0) { setValidationError('Standard hours must be a positive number'); return false }
    return true
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateShiftInput = {
      name: name.trim(),
      start_time: startTime,
      end_time: endTime,
      standard_hours: Number(standardHours),
    }
    await onSubmit(data)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Shift' : 'Add Shift'}
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
          <Button isLoading={isSubmitting} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Add Shift'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <Input
          label="Shift Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Morning Shift"
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Start Time"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            placeholder="09:00"
          />
          <Input
            label="End Time"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            placeholder="18:00"
          />
        </div>

        <Input
          label="Standard Hours"
          required
          type="number"
          value={standardHours}
          onChange={(e) => setStandardHours(e.target.value)}
          placeholder="8"
        />
      </form>
    </Modal>
  )
}
