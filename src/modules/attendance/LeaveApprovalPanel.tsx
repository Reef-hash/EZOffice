// LeaveApprovalPanel — list of leave requests with approve/reject actions for pending ones (Phase C2).
// Uses attendance:listLeave (with optional status filter), attendance:approveLeave, attendance:rejectLeave.
// The list filter keys are snake_case to match the leaveListSchema on the IPC side.

import { useState, useMemo } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Select } from '@/shared/components/Input'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { Column } from '@/shared/components/Table'
import type { LeaveRecord, LeaveStatus } from '@/shared/types/entities'
import { LEAVE_STATUS, LEAVE_STATUS_LABEL, LEAVE_STATUS_TONE, LEAVE_TYPE_LABEL } from './constants'

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: LEAVE_STATUS.PENDING, label: LEAVE_STATUS_LABEL[LEAVE_STATUS.PENDING] },
  { value: LEAVE_STATUS.APPROVED, label: LEAVE_STATUS_LABEL[LEAVE_STATUS.APPROVED] },
  { value: LEAVE_STATUS.REJECTED, label: LEAVE_STATUS_LABEL[LEAVE_STATUS.REJECTED] },
]

export function LeaveApprovalPanel() {
  const [statusFilter, setStatusFilter] = useState<string>('')

  // leaveListSchema expects snake_case keys; empty values are omitted to keep the query clean.
  const filters = useMemo(
    () => (statusFilter ? { status: statusFilter as LeaveStatus } : {}),
    [statusFilter],
  )

  const { data: leaveRecords = [], isLoading } = useIpcQuery<LeaveRecord[]>(
    ['attendance', 'leave', statusFilter],
    () => window.api.attendance.listLeave(filters),
  )

  const approveMutation = useIpcMutation<LeaveRecord, number>(
    (id) => window.api.attendance.approveLeave(id),
    [['attendance', 'leave']],
  )

  const rejectMutation = useIpcMutation<LeaveRecord, number>(
    (id) => window.api.attendance.rejectLeave(id),
    [['attendance', 'leave']],
  )

  const columns: Column<LeaveRecord>[] = [
    {
      key: 'employee_name',
      header: 'Employee',
      accessor: (r) => r.employee_name || `ID ${r.employee_id}`,
      sortable: true,
      sortValue: (r) => r.employee_name || '',
    },
    {
      key: 'leave_type',
      header: 'Type',
      accessor: (r) => LEAVE_TYPE_LABEL[r.leave_type],
      sortable: true,
      sortValue: (r) => r.leave_type,
      align: 'center',
      width: '90px',
    },
    {
      key: 'date_from',
      header: 'From',
      accessor: (r) => r.date_from,
      sortable: true,
      sortValue: (r) => r.date_from,
      width: '120px',
    },
    {
      key: 'date_to',
      header: 'To',
      accessor: (r) => r.date_to,
      sortable: true,
      sortValue: (r) => r.date_to,
      width: '120px',
    },
    {
      key: 'reason',
      header: 'Reason',
      accessor: (r) => r.reason || '—',
      sortable: true,
      sortValue: (r) => r.reason || '',
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => <StatusBadge tone={LEAVE_STATUS_TONE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</StatusBadge>,
      sortable: true,
      sortValue: (r) => r.status,
      align: 'center',
      width: '100px',
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '180px',
      accessor: (r) =>
        r.status === LEAVE_STATUS.PENDING ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="primary"
              isLoading={approveMutation.isPending}
              onClick={(e) => {
                e.stopPropagation()
                approveMutation.mutate(r.id)
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              isLoading={rejectMutation.isPending}
              onClick={(e) => {
                e.stopPropagation()
                rejectMutation.mutate(r.id)
              }}
            >
              Reject
            </Button>
          </div>
        ) : (
          '—'
        ),
    },
  ]

  const pendingCount = leaveRecords.filter((r) => r.status === LEAVE_STATUS.PENDING).length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leave Requests"
        subtitle={
          statusFilter === LEAVE_STATUS.PENDING
            ? `${pendingCount} pending`
            : `${leaveRecords.length} record${leaveRecords.length !== 1 ? 's' : ''}`
        }
      />

      <div className="flex items-end gap-3">
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
        data={leaveRecords}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No leave records',
          description: 'No leave requests match this filter.',
        }}
      />
    </div>
  )
}
