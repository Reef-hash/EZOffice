// EmployeeForm — Add/Edit form using Modal + shared Input/Select/Button components.
// Validates required fields client-side before submitting via IPC.

import { useState, useEffect } from 'react'
import { Input, Select } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { EMPLOYEE_STATUS, EMPLOYEE_STATUS_LABEL } from './constants'
import type { Employee, Department, Shift } from '@/shared/types/entities'
import type { CreateEmployeeInput, UpdateEmployeeInput } from '@/shared/types/inputs'
import { useIpcQuery } from '@/shared/hooks/useIpcQuery'

interface EmployeeFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateEmployeeInput | UpdateEmployeeInput) => Promise<void>
  onDelete?: () => Promise<void>
  isSubmitting: boolean
  isDeleting?: boolean
  employee?: Employee | null // null = create mode
}

export function EmployeeForm({ isOpen, onClose, onSubmit, onDelete, isSubmitting, isDeleting, employee }: EmployeeFormProps) {
  const isEdit = !!employee

  // Form state
  const [employeeCode, setEmployeeCode] = useState('')
  const [name, setName] = useState('')
  const [icNumber, setIcNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [shiftId, setShiftId] = useState<number | null>(null)
  const [position, setPosition] = useState('')
  const [status, setStatus] = useState<string>(EMPLOYEE_STATUS.ACTIVE)
  const [dateJoined, setDateJoined] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  // Fetch departments for the dropdown
  const { data: departments = [] } = useIpcQuery<Department[]>(
    ['departments'],
    () => window.api.departments.list(),
    { enabled: isOpen },
  )

  // Phase C: fetch shifts for the dropdown
  const { data: shifts = [] } = useIpcQuery<Shift[]>(
    ['attendance', 'shifts'],
    () => window.api.attendance.listShifts(),
    { enabled: isOpen },
  )

  // Reset form when opening or switching between create/edit
  useEffect(() => {
    if (!isOpen) return
    if (employee) {
      setEmployeeCode(employee.employee_code)
      setName(employee.name)
      setIcNumber(employee.ic_number)
      setPhone(employee.phone ?? '')
      setEmail(employee.email ?? '')
      setDepartmentId(employee.department_id)
      setShiftId(employee.shift_id ?? null)
      setPosition(employee.position ?? '')
      setStatus(employee.status)
      setDateJoined(employee.date_joined.slice(0, 10))
    } else {
      setEmployeeCode('')
      setName('')
      setIcNumber('')
      setPhone('')
      setEmail('')
      setDepartmentId(null)
      setShiftId(null)
      setPosition('')
      setStatus(EMPLOYEE_STATUS.ACTIVE)
      setDateJoined('')
    }
    setValidationError(null)
  }, [isOpen, employee])

  function validate(): boolean {
    if (!employeeCode.trim()) { setValidationError('Employee code is required'); return false }
    if (!name.trim()) { setValidationError('Name is required'); return false }
    if (!icNumber.trim()) { setValidationError('IC number is required'); return false }
    if (!dateJoined) { setValidationError('Date joined is required'); return false }
    return true
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateEmployeeInput = {
      employee_code: employeeCode.trim(),
      name: name.trim(),
      ic_number: icNumber.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      department_id: departmentId,
      position: position.trim() || null,
      status: status as 'active' | 'inactive',
      date_joined: dateJoined,
      // Phase C: shift assignment (optional). The shift-aware schema accepts this;
      // the base CreateEmployeeInput type doesn't declare it, so cast through.
      shift_id: shiftId,
    } as CreateEmployeeInput

    await onSubmit(data)
  }

  const departmentOptions = [
    { value: '', label: '— None —' },
    ...departments.map((d) => ({ value: String(d.id), label: d.name })),
  ]

  const shiftOptions = [
    { value: '', label: '— No fixed shift —' },
    ...shifts.map((s) => ({
      value: String(s.id),
      label: `${s.name} (${s.start_time}–${s.end_time})`,
    })),
  ]

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Employee' : 'Add Employee'}
      size="md"
      footer={
        <>
          {isEdit && onDelete && (
            <Button variant="danger" isLoading={isDeleting} onClick={onDelete}>
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button isLoading={isSubmitting} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Add Employee'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Employee Code"
            required
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
            placeholder="e.g. EMP001"
          />
          <Input
            label="IC Number"
            required
            value={icNumber}
            onChange={(e) => setIcNumber(e.target.value)}
            placeholder="e.g. 900101-01-1234"
          />
        </div>

        <Input
          label="Full Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Employee full name"
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 012-3456789"
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="employee@company.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Department"
            options={departmentOptions}
            value={departmentId !== null ? String(departmentId) : ''}
            onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)}
          />
          <Input
            label="Position"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="e.g. Software Engineer"
          />
        </div>

        <Select
          label="Assigned Shift"
          options={shiftOptions}
          value={shiftId !== null ? String(shiftId) : ''}
          onChange={(e) => setShiftId(e.target.value ? Number(e.target.value) : null)}
        />

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Status"
            options={[
              { value: EMPLOYEE_STATUS.ACTIVE, label: EMPLOYEE_STATUS_LABEL[EMPLOYEE_STATUS.ACTIVE] },
              { value: EMPLOYEE_STATUS.INACTIVE, label: EMPLOYEE_STATUS_LABEL[EMPLOYEE_STATUS.INACTIVE] },
            ]}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
          <Input
            label="Date Joined"
            required
            type="date"
            value={dateJoined}
            onChange={(e) => setDateJoined(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  )
}
