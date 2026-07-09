// AttendanceListPage — hub for attendance management.
// Tabs: Logs (quick clock + table), Shifts, Leave, Late Report, Monthly Summary,
// and Device Settings (fingerprint reader sync). Phase C adds shifts/leave/late/summary.

import { useState, useCallback, useMemo } from 'react'
import type { ChangeEvent } from 'react'
import { cn } from '@/shared/lib/cn'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Select } from '@/shared/components/Input'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { AttendanceLogForm } from './AttendanceLogForm'
import { DeviceSettingsPage } from './DeviceSettingsPage'
import { ShiftManagementPanel } from './ShiftManagementPanel'
import { LeaveRequestForm } from './LeaveRequestForm'
import { LeaveApprovalPanel } from './LeaveApprovalPanel'
import { LateReportPage } from './LateReportPage'
import { AttendanceSummaryPage } from './AttendanceSummaryPage'
import { ExceptionsPanel } from './ExceptionsPanel'
import type { Column } from '@/shared/components/Table'
import type { Employee, AttendanceLog } from '@/shared/types/entities'
import type { CreateAttendanceLogInput, UpdateAttendanceLogInput } from '@/shared/types/inputs'
import {
  ATTENDANCE_TYPE,
  ATTENDANCE_TYPE_TONE,
  ATTENDANCE_TYPE_LABEL,
  ATTENDANCE_SOURCE_TONE,
  ATTENDANCE_SOURCE_LABEL,
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUS_TONE,
  ATTENDANCE_STATUS_LABEL,
} from './constants'

type AttendanceTab = 'logs' | 'deviceSettings' | 'shifts' | 'leave' | 'lateReport' | 'summary' | 'exceptions'

const TABS: Array<{ key: AttendanceTab; label: string }> = [
  { key: 'logs', label: 'Logs' },
  { key: 'shifts', label: 'Shifts' },
  { key: 'leave', label: 'Leave' },
  { key: 'lateReport', label: 'Late Report' },
  { key: 'summary', label: 'Monthly Summary' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'deviceSettings', label: 'Device Settings' },
]

const columns: Column<AttendanceLog>[] = [
  { key: 'employee_name', header: 'Employee', accessor: (r) => r.employee_name || `ID ${r.employee_id}`, sortable: true, sortValue: (r) => r.employee_name || '' },
  { key: 'type', header: 'Type', accessor: (r) => <StatusBadge tone={ATTENDANCE_TYPE_TONE[r.type]}>{ATTENDANCE_TYPE_LABEL[r.type]}</StatusBadge>, sortable: true, sortValue: (r) => r.type, align: 'center', width: '80px' },
  { key: 'timestamp', header: 'Timestamp', accessor: (r) => formatTimestamp(r.timestamp), sortable: true, sortValue: (r) => r.timestamp },
  {
    key: 'shift_name',
    header: 'Shift',
    accessor: (r) => r.shift_name || '—',
    sortable: true,
    sortValue: (r) => r.shift_name || '',
    align: 'center',
    width: '110px',
  },
  {
    key: 'status',
    header: 'Status',
    accessor: (r) => (
      <StatusBadge tone={ATTENDANCE_STATUS_TONE[r.status]}>
        {ATTENDANCE_STATUS_LABEL[r.status]}
      </StatusBadge>
    ),
    sortable: true,
    sortValue: (r) => r.status,
    align: 'center',
    width: '100px',
  },
  { key: 'source', header: 'Source', accessor: (r) => <StatusBadge tone={ATTENDANCE_SOURCE_TONE[r.source]}>{ATTENDANCE_SOURCE_LABEL[r.source]}</StatusBadge>, sortable: true, sortValue: (r) => r.source, align: 'center', width: '80px' },
  { key: 'note', header: 'Note', accessor: (r) => r.note || '—', sortable: true, sortValue: (r) => r.note || '' },
]

export function AttendanceListPage() {
  const [activeTab, setActiveTab] = useState<AttendanceTab>('logs')
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [clockEmployeeId, setClockEmployeeId] = useState('')

  const filters = useMemo(() => ({ dateFrom, dateTo }), [dateFrom, dateTo])

  const { data: logs = [], isLoading } = useIpcQuery<AttendanceLog[]>(
    ['attendance', 'list', dateFrom, dateTo],
    () => window.api.attendance.list(filters),
  )

  const { data: employees = [] } = useIpcQuery<Employee[]>(
    ['employees'],
    () => window.api.employees.list(),
  )

  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: String(e.id), label: `${e.name} (${e.employee_code})` })),
    [employees],
  )

  // Quick Clock: get last log for selected employee to show current status
  const clockedEmployeeId = clockEmployeeId ? Number(clockEmployeeId) : null

  const { data: lastLog, refetch: refetchLastLog } = useIpcQuery<AttendanceLog | null>(
    ['attendance', 'lastForEmployee', clockEmployeeId],
    () => clockedEmployeeId
      ? window.api.attendance.getLastForEmployee(clockedEmployeeId)
      : Promise.resolve(null),
    { enabled: !!clockedEmployeeId },
  )

  const currentStatus: 'none' | 'in' | 'out' = !lastLog
    ? 'none'
    : lastLog.type === ATTENDANCE_TYPE.IN
      ? 'in'
      : 'out'

  // ── Mutations ──────────────────────────────────────────

  const clockInMutation = useIpcMutation<AttendanceLog, { employee_id: number }>(
    ({ employee_id }) => window.api.attendance.clockIn(employee_id),
    [['attendance', 'list'], ['attendance', 'lastForEmployee']],
  )

  const clockOutMutation = useIpcMutation<AttendanceLog, { employee_id: number }>(
    ({ employee_id }) => window.api.attendance.clockOut(employee_id),
    [['attendance', 'list'], ['attendance', 'lastForEmployee']],
  )

  const createMutation = useIpcMutation<AttendanceLog, CreateAttendanceLogInput>(
    (data) => window.api.attendance.create(data),
    [['attendance', 'list']],
  )

  const updateMutation = useIpcMutation<AttendanceLog, { id: number; data: UpdateAttendanceLogInput }>(
    ({ id, data }) => window.api.attendance.update(id, data),
    [['attendance', 'list']],
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.attendance.delete(id),
    [['attendance', 'list']],
  )

  // Phase C3 — mark a late clock-in as excused (admin override).
  const excuseMutation = useIpcMutation<AttendanceLog, number>(
    (logId) => window.api.attendance.excuseLate(logId),
    [['attendance', 'list']],
  )

  // Phase C2 — create a leave request on behalf of an employee.
  const createLeaveMutation = useIpcMutation<
    import('@/shared/types/entities').LeaveRecord,
    import('@/shared/types/inputs').CreateLeaveRequestInput
  >(
    (data) => window.api.attendance.createLeaveRequest(data),
    [['attendance', 'leave']],
  )

  // Actions column for the logs table: show an "Excuse" button on late clock-in rows.
  // Defined inside the component so it can call the excuse mutation.
  const logColumns: Column<AttendanceLog>[] = useMemo(() => [
    ...columns,
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '120px',
      accessor: (r) =>
        r.type === ATTENDANCE_TYPE.IN && r.status === ATTENDANCE_STATUS.LATE ? (
          <Button
            size="sm"
            variant="secondary"
            isLoading={excuseMutation.isPending}
            onClick={(e) => {
              e.stopPropagation()
              excuseMutation.mutate(r.id)
            }}
          >
            Excuse
          </Button>
        ) : (
          '—'
        ),
    },
  ], [excuseMutation])

  // ── Form state ─────────────────────────────────────────

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingLog, setEditingLog] = useState<AttendanceLog | null>(null)

  // Phase C2 — leave request form
  const [isLeaveFormOpen, setIsLeaveFormOpen] = useState(false)

  const handleCreate = useCallback(() => {
    setEditingLog(null)
    setIsFormOpen(true)
  }, [])

  const handleEdit = useCallback((log: AttendanceLog) => {
    setEditingLog(log)
    setIsFormOpen(true)
  }, [])

  const handleFormSubmit = useCallback(
    async (data: CreateAttendanceLogInput | UpdateAttendanceLogInput) => {
      if (editingLog) {
        await updateMutation.mutateAsync({ id: editingLog.id, data: data as UpdateAttendanceLogInput })
      } else {
        await createMutation.mutateAsync(data as CreateAttendanceLogInput)
      }
      setIsFormOpen(false)
      setEditingLog(null)
    },
    [editingLog, createMutation, updateMutation],
  )

  const handleDelete = useCallback(
    async () => {
      if (!editingLog) return
      if (!confirm(`Delete this attendance log? This cannot be undone.`)) return
      await deleteMutation.mutateAsync(editingLog.id)
      setIsFormOpen(false)
      setEditingLog(null)
    },
    [editingLog, deleteMutation],
  )

  const handleExport = useCallback(async () => {
    try {
      await window.api.export.attendance(dateFrom, dateTo)
    } catch (err) {
      alert(`Export failed: ${String(err)}`)
    }
  }, [dateFrom, dateTo])

  // ── Quick Clock actions ────────────────────────────────

  const handleClockIn = useCallback(async () => {
    if (!clockedEmployeeId) return
    try {
      await clockInMutation.mutateAsync({ employee_id: clockedEmployeeId })
      await refetchLastLog()
    } catch {
      // Error is shown by react-query automatically
    }
  }, [clockedEmployeeId, clockInMutation, refetchLastLog])

  const handleClockOut = useCallback(async () => {
    if (!clockedEmployeeId) return
    try {
      await clockOutMutation.mutateAsync({ employee_id: clockedEmployeeId })
      await refetchLastLog()
    } catch {
      // Error is shown by react-query automatically
    }
  }, [clockedEmployeeId, clockOutMutation, refetchLastLog])

  const clockError =
    clockInMutation.error?.message || clockOutMutation.error?.message || null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        subtitle={subtitleForTab(activeTab, logs.length)}
        actions={actionsForTab(activeTab, handleCreate, () => setIsLeaveFormOpen(true), handleExport)}
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-neutral-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'border-b-2 border-primary-600 text-primary-700'
                : 'border-b-2 border-transparent text-neutral-500 hover:text-neutral-800',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'deviceSettings' && (
        <DeviceSettingsPage />
      )}

      {activeTab === 'shifts' && (
        <ShiftManagementPanel />
      )}

      {activeTab === 'leave' && (
        <LeaveApprovalPanel />
      )}

      {activeTab === 'lateReport' && (
        <LateReportPage />
      )}

      {activeTab === 'summary' && (
        <AttendanceSummaryPage />
      )}

      {activeTab === 'exceptions' && (
        <ExceptionsPanel />
      )}

      {activeTab === 'logs' && (
      <div>

      {/* Quick Clock panel */}
      <div className="mb-6 rounded-md border border-neutral-200 bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-900">Quick Clock</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px]">
            <Select
              label="Employee"
              value={clockEmployeeId}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                setClockEmployeeId(e.target.value)
                clockInMutation.reset()
                clockOutMutation.reset()
              }}
              options={employeeOptions}
              placeholder="Select an employee"
            />
          </div>

          {clockedEmployeeId && (
            <div className="flex items-end gap-2">
              <span className="self-center text-sm text-neutral-600">
                Status:{' '}
                {currentStatus === 'none' ? (
                  'No logs yet'
                ) : (
                  <StatusBadge tone={ATTENDANCE_TYPE_TONE[currentStatus]}>
                    {ATTENDANCE_TYPE_LABEL[currentStatus]}
                  </StatusBadge>
                )}
              </span>

              <Button
                size="sm"
                variant="primary"
                disabled={currentStatus === 'in'}
                isLoading={clockInMutation.isPending}
                onClick={handleClockIn}
              >
                Clock In
              </Button>

              <Button
                size="sm"
                variant="secondary"
                disabled={currentStatus !== 'in'}
                isLoading={clockOutMutation.isPending}
                onClick={handleClockOut}
              >
                Clock Out
              </Button>
            </div>
          )}
        </div>

        {clockError && (
          <p className="mt-2 rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">
            {clockError}
          </p>
        )}
      </div>

      {/* Date filter */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-neutral-700">Filter:</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 rounded-sm border border-neutral-300 px-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-700/40"
        />
        <span className="text-sm text-neutral-500">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-9 rounded-sm border border-neutral-300 px-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-700/40"
        />
      </div>

      {/* Log table */}
      <Table
        columns={logColumns}
        data={logs}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No attendance logs found',
          description: 'No logs match the current date filter. Try a wider range or add a new log.',
          action: (
            <div className="mt-3 flex justify-center">
              <Button size="sm" onClick={handleCreate}>Add Log</Button>
            </div>
          ),
        }}
        onRowClick={handleEdit}
      />

      <AttendanceLogForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingLog(null) }}
        onSubmit={handleFormSubmit}
        onDelete={handleDelete}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isDeleting={deleteMutation.isPending}
        log={editingLog}
      />
      </div>
      )}

      {/* Phase C2 — leave request form (available from the Leave tab header) */}
      <LeaveRequestForm
        isOpen={isLeaveFormOpen}
        onClose={() => setIsLeaveFormOpen(false)}
        onSubmit={async (data) => {
          await createLeaveMutation.mutateAsync(data)
          setIsLeaveFormOpen(false)
        }}
        isSubmitting={createLeaveMutation.isPending}
      />
    </div>
  )
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// --- Tab header helpers -------------------------------------------------------

function subtitleForTab(tab: AttendanceTab, logCount: number): React.ReactNode {
  switch (tab) {
    case 'logs':
      return `${logCount} log${logCount !== 1 ? 's' : ''}`
    case 'deviceSettings':
      return 'Configure fingerprint reader'
    case 'shifts':
      return 'Define work shifts and standard hours'
    case 'leave':
      return 'Review and approve leave requests'
    case 'lateReport':
      return 'Lateness summary by employee'
    case 'summary':
      return 'Per-employee monthly attendance calendar'
    case 'exceptions':
      return 'Anomalies to resolve before running payroll'
  }
}

function actionsForTab(
  tab: AttendanceTab,
  onAddLog: () => void,
  onAddLeave: () => void,
  onExport: () => void,
): React.ReactNode {
  switch (tab) {
    case 'logs':
      return (
        <>
          <Button variant="secondary" onClick={onExport}>Export</Button>
          <Button onClick={onAddLog}>Add Log</Button>
        </>
      )
    case 'leave':
      return <Button onClick={onAddLeave}>New Leave Request</Button>
    default:
      return undefined
  }
}
