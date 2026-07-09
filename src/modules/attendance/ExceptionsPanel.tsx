// ExceptionsPanel — H2/D5 UI for docs/DEVICE_SYNC_AUDIT.md.
// Lists attendance_exceptions for a chosen month, lets the admin compute new
// ones, and resolve/dismiss each. This is the UI that makes the payroll
// pre-flight gate (D5, in calculatePayrollRun) actually usable — without it,
// a blocked payroll run has no way to show the admin what to fix.

import { useState, useMemo } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Input, Select } from '@/shared/components/Input'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PageHeader } from '@/shared/components/PageHeader'
import { Modal } from '@/shared/components/Modal/Modal'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { useToast } from '@/shared/components/Toast'
import type { Column } from '@/shared/components/Table'
import type { AttendanceException, ExceptionStatus } from '@/shared/types/entities'
import { EXCEPTION_STATUS, EXCEPTION_TYPE_LABEL, EXCEPTION_STATUS_TONE, EXCEPTION_STATUS_LABEL } from './constants'

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: EXCEPTION_STATUS.OPEN, label: EXCEPTION_STATUS_LABEL[EXCEPTION_STATUS.OPEN] },
  { value: EXCEPTION_STATUS.RESOLVED, label: EXCEPTION_STATUS_LABEL[EXCEPTION_STATUS.RESOLVED] },
  { value: EXCEPTION_STATUS.DISMISSED, label: EXCEPTION_STATUS_LABEL[EXCEPTION_STATUS.DISMISSED] },
]

export function ExceptionsPanel() {
  const { addToast } = useToast()
  const now = new Date()
  const [year, setYear] = useState(String(now.getFullYear()))
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [dismissTarget, setDismissTarget] = useState<AttendanceException | null>(null)
  const [dismissNote, setDismissNote] = useState('')

  const yearNum = Number(year)
  const monthNum = Number(month)
  const enabled = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100 && monthNum >= 1 && monthNum <= 12

  const filters = useMemo(
    () => ({
      year: yearNum,
      month: monthNum,
      status: statusFilter ? (statusFilter as ExceptionStatus) : undefined,
    }),
    [yearNum, monthNum, statusFilter],
  )

  const { data: exceptions = [], isLoading } = useIpcQuery<AttendanceException[]>(
    ['attendance', 'exceptions', year, month, statusFilter],
    () => window.api.attendance.listExceptions(filters),
    { enabled },
  )

  const computeMutation = useIpcMutation<{ created: number }, void>(
    () => window.api.attendance.computeExceptions({ year: yearNum, month: monthNum }),
    [['attendance', 'exceptions']],
  )

  const resolveMutation = useIpcMutation<AttendanceException, number>(
    (id) => window.api.attendance.resolveException({ id }),
    [['attendance', 'exceptions']],
  )

  const dismissMutation = useIpcMutation<AttendanceException, { id: number; note: string }>(
    ({ id, note }) => window.api.attendance.dismissException({ id, note }),
    [['attendance', 'exceptions']],
  )

  const handleCompute = async () => {
    try {
      const result = await computeMutation.mutateAsync()
      addToast(
        result.created > 0
          ? `${result.created} new exception(s) found`
          : 'No new exceptions found — attendance for this month looks clean',
        result.created > 0 ? 'warning' : 'success',
      )
    } catch (err) {
      addToast(`Failed to compute exceptions: ${String(err)}`, 'error')
    }
  }

  const handleDismissConfirm = async () => {
    if (!dismissTarget || !dismissNote.trim()) return
    try {
      await dismissMutation.mutateAsync({ id: dismissTarget.id, note: dismissNote.trim() })
      setDismissTarget(null)
      setDismissNote('')
    } catch (err) {
      addToast(`Failed to dismiss exception: ${String(err)}`, 'error')
    }
  }

  const openCount = exceptions.filter((e) => e.status === EXCEPTION_STATUS.OPEN).length

  const columns: Column<AttendanceException>[] = [
    {
      key: 'date',
      header: 'Date',
      accessor: (r) => r.date,
      sortable: true,
      sortValue: (r) => r.date,
      width: '110px',
    },
    {
      key: 'employee_name',
      header: 'Employee',
      accessor: (r) => r.employee_name || `ID ${r.employee_id}`,
      sortable: true,
      sortValue: (r) => r.employee_name || '',
    },
    {
      key: 'exception_type',
      header: 'Type',
      accessor: (r) => EXCEPTION_TYPE_LABEL[r.exception_type],
      sortable: true,
      sortValue: (r) => r.exception_type,
      width: '160px',
    },
    {
      key: 'description',
      header: 'Description',
      accessor: (r) => r.description,
      sortable: true,
      sortValue: (r) => r.description,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => <StatusBadge tone={EXCEPTION_STATUS_TONE[r.status]}>{EXCEPTION_STATUS_LABEL[r.status]}</StatusBadge>,
      sortable: true,
      sortValue: (r) => r.status,
      align: 'center',
      width: '100px',
    },
    {
      key: 'note',
      header: 'Note',
      accessor: (r) => r.note || '—',
      width: '160px',
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '180px',
      accessor: (r) =>
        r.status === EXCEPTION_STATUS.OPEN ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="primary"
              isLoading={resolveMutation.isPending}
              onClick={(e) => {
                e.stopPropagation()
                resolveMutation.mutate(r.id)
              }}
            >
              Resolve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation()
                setDismissTarget(r)
                setDismissNote('')
              }}
            >
              Dismiss
            </Button>
          </div>
        ) : (
          '—'
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance Exceptions"
        subtitle={`${openCount} open — payroll is blocked for this month while any exception is open`}
        actions={
          <Button onClick={handleCompute} isLoading={computeMutation.isPending}>
            Compute Exceptions
          </Button>
        }
      />

      <div className="flex items-end gap-3">
        <div className="w-32">
          <Input label="Year" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="w-32">
          <Input label="Month" type="number" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="1-12" />
        </div>
        <div className="w-56">
          <Select
            label="Status"
            options={STATUS_FILTER_OPTIONS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </div>
      </div>

      <Table
        columns={columns}
        data={exceptions}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No exceptions',
          description: 'Click "Compute Exceptions" to scan this month\'s attendance for missing punches, over-long sessions, and punches on leave days.',
        }}
      />

      <Modal
        isOpen={dismissTarget !== null}
        onClose={() => setDismissTarget(null)}
        title="Dismiss Exception"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDismissTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!dismissNote.trim()}
              isLoading={dismissMutation.isPending}
              onClick={handleDismissConfirm}
            >
              Dismiss
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-neutral-600">
          {dismissTarget?.description}
        </p>
        <Input
          label="Note (required)"
          type="text"
          value={dismissNote}
          onChange={(e) => setDismissNote(e.target.value)}
          placeholder="Explain why this is acceptable as-is"
          required
        />
      </Modal>
    </div>
  )
}
