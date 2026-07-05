// LeaveRequestForm — modal form for an admin to file a leave request on behalf of an employee (Phase C2).
// Calls attendance:createLeaveRequest. Shows the selected employee's current leave balance
// (annual/sick) so the admin can see remaining entitlement before submitting.

import { useState, useEffect } from 'react'
import { Input, Select } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useIpcQuery } from '@/shared/hooks/useIpcQuery'
import { LEAVE_TYPE, LEAVE_TYPE_LABEL } from './constants'
import type { Employee, LeaveBalance } from '@/shared/types/entities'
import type { CreateLeaveRequestInput } from '@/shared/types/inputs'

interface LeaveRequestFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateLeaveRequestInput) => Promise<void>
  isSubmitting: boolean
}

export function LeaveRequestForm({ isOpen, onClose, onSubmit, isSubmitting }: LeaveRequestFormProps) {
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [leaveType, setLeaveType] = useState<string>(LEAVE_TYPE.ANNUAL)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [reason, setReason] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const { data: employees = [] } = useIpcQuery<Employee[]>(
    ['employees'],
    () => window.api.employees.list(),
    { enabled: isOpen },
  )

  const employeeOptions = employees.map((e) => ({
    value: String(e.id),
    label: `${e.name} (${e.employee_code})`,
  }))

  const leaveTypeOptions = (Object.keys(LEAVE_TYPE) as Array<keyof typeof LEAVE_TYPE>).map((k) => ({
    value: LEAVE_TYPE[k],
    label: LEAVE_TYPE_LABEL[LEAVE_TYPE[k]],
  }))

  // Fetch the selected employee's leave balance for the current year so the admin can
  // see remaining entitlement before submitting. Unpaid leave has no cap, so the balance
  // is informational only.
  const year = new Date().getFullYear()
  const { data: balance } = useIpcQuery<LeaveBalance>(
    ['attendance', 'leaveBalance', String(employeeId), String(year)],
    () => employeeId
      ? window.api.attendance.getLeaveBalance(employeeId, year)
      : Promise.resolve({ annual: 0, sick: 0, unpaid: 0 }),
    { enabled: isOpen && employeeId !== null },
  )

  useEffect(() => {
    if (!isOpen) return
    setEmployeeId(null)
    setLeaveType(LEAVE_TYPE.ANNUAL)
    setDateFrom('')
    setDateTo('')
    setReason('')
    setValidationError(null)
  }, [isOpen])

  function validate(): boolean {
    if (!employeeId) { setValidationError('Employee is required'); return false }
    if (!dateFrom) { setValidationError('Start date is required'); return false }
    if (!dateTo) { setValidationError('End date is required'); return false }
    if (dateTo < dateFrom) { setValidationError('End date cannot be before start date'); return false }
    return true
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateLeaveRequestInput = {
      employee_id: employeeId!,
      leave_type: leaveType as CreateLeaveRequestInput['leave_type'],
      date_from: dateFrom,
      date_to: dateTo,
      reason: reason.trim() || null,
    }
    await onSubmit(data)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Leave Request"
      size="md"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button isLoading={isSubmitting} onClick={handleSubmit}>Submit Request</Button>
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
          options={employeeOptions}
          value={employeeId !== null ? String(employeeId) : ''}
          onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}
          placeholder="Select an employee"
        />

        {balance && employeeId && (
          <div className="flex gap-2 text-xs text-neutral-600">
            <span>Balance:</span>
            <StatusBadge tone="info">Annual {balance.annual}</StatusBadge>
            <StatusBadge tone="info">Sick {balance.sick}</StatusBadge>
            <span className="self-center">Unpaid (no cap)</span>
          </div>
        )}

        <Select
          label="Leave Type"
          required
          options={leaveTypeOptions}
          value={leaveType}
          onChange={(e) => setLeaveType(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="From"
            type="date"
            required
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <Input
            label="To"
            type="date"
            required
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <Input
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional — e.g. family emergency"
        />
      </form>
    </Modal>
  )
}
