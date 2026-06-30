// AttendanceLogForm — Add/Edit form for attendance_logs.
// Mirrors SupplierForm.tsx's prop shape: isOpen, onClose, onSubmit, onDelete, isSubmitting, isDeleting.

import { useState, useEffect, useMemo } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Input } from '@/shared/components/Input'
import { Select } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { useIpcQuery } from '@/shared/hooks/useIpcQuery'
import type { Employee, AttendanceLog } from '@/shared/types/entities'
import type { CreateAttendanceLogInput, UpdateAttendanceLogInput } from '@/shared/types/inputs'
import { ATTENDANCE_TYPE_LABEL } from './constants'

interface AttendanceLogFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateAttendanceLogInput | UpdateAttendanceLogInput) => Promise<void>
  onDelete?: () => Promise<void>
  isSubmitting: boolean
  isDeleting?: boolean
  log?: AttendanceLog | null
}

export function AttendanceLogForm({
  isOpen,
  onClose,
  onSubmit,
  onDelete,
  isSubmitting,
  isDeleting,
  log,
}: AttendanceLogFormProps) {
  const isEdit = !!log

  const { data: employees = [] } = useIpcQuery<Employee[]>(
    ['employees'],
    () => window.api.employees.list(),
    { enabled: isOpen },
  )

  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: String(e.id), label: `${e.name} (${e.employee_code})` })),
    [employees],
  )

  const typeOptions = useMemo(
    () => [
      { value: 'in', label: ATTENDANCE_TYPE_LABEL.in },
      { value: 'out', label: ATTENDANCE_TYPE_LABEL.out },
    ],
    [],
  )

  const [employeeId, setEmployeeId] = useState('')
  const [type, setType] = useState<'in' | 'out'>('in')
  const [timestamp, setTimestamp] = useState('')
  const [note, setNote] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (log) {
      setEmployeeId(String(log.employee_id))
      setType(log.type)
      // Convert ISO timestamp to datetime-local compatible format
      setTimestamp(toLocalDatetime(log.timestamp))
      setNote(log.note ?? '')
    } else {
      setEmployeeId('')
      setType('in')
      setTimestamp(toLocalDatetime(new Date().toISOString()))
      setNote('')
    }
    setValidationError(null)
  }, [isOpen, log])

  function validate(): boolean {
    if (!employeeId) { setValidationError('Employee is required'); return false }
    if (!timestamp.trim()) { setValidationError('Timestamp is required'); return false }
    return true
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateAttendanceLogInput = {
      employee_id: Number(employeeId),
      type,
      timestamp: new Date(timestamp).toISOString(),
      note: note.trim() || null,
    }

    await onSubmit(data)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Attendance Log' : 'Add Attendance Log'}
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
            {isEdit ? 'Save Changes' : 'Add Log'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <Select
          label="Employee"
          required
          value={employeeId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setEmployeeId(e.target.value)}
          options={employeeOptions}
          placeholder="Select an employee"
          disabled={isEdit}
        />

        <Select
          label="Type"
          required
          value={type}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setType(e.target.value as 'in' | 'out')}
          options={typeOptions}
        />

        <Input
          label="Timestamp"
          required
          type="datetime-local"
          value={timestamp}
          onChange={(e) => setTimestamp(e.target.value)}
        />

        <Input
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason for backfill / adjustment"
        />
      </form>
    </Modal>
  )
}

/** Converts an ISO 8601 string to a datetime-local input value (YYYY-MM-DDTHH:mm). */
function toLocalDatetime(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
