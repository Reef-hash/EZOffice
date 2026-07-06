// AttendanceSummaryPage — per-employee monthly attendance calendar + Excel export (Phase C4).
// Fetches attendance:getMonthlyCalendar for a chosen employee × year × month and renders a
// day grid (IN/OUT times, hours, status badge, leave type) plus monthly totals. The "Export
// to Excel" button calls attendance:exportMonthly (all employees for that month) and the IPC
// handler opens the generated file via shell.openPath.

import { useState, useMemo } from 'react'
import { Table } from '@/shared/components/Table'
import { Input, Select } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { Column } from '@/shared/components/Table'
import type {
  Employee,
  AttendanceMonthlyCalendar,
  AttendanceSummaryDay,
} from '@/shared/types/entities'
import {
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUS_TONE,
  ATTENDANCE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
} from './constants'

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function dayStatusBadge(day: AttendanceSummaryDay) {
  if (day.status === 'leave') {
    return <StatusBadge tone="info">{day.leave_type ? LEAVE_TYPE_LABEL[day.leave_type] : 'Leave'}</StatusBadge>
  }
  if (day.status === ATTENDANCE_STATUS.ON_TIME) {
    return <StatusBadge tone={ATTENDANCE_STATUS_TONE[ATTENDANCE_STATUS.ON_TIME]}>On Time</StatusBadge>
  }
  return <StatusBadge tone={ATTENDANCE_STATUS_TONE[day.status]}>{ATTENDANCE_STATUS_LABEL[day.status]}</StatusBadge>
}

export function AttendanceSummaryPage() {
  const now = new Date()
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [year, setYear] = useState(String(now.getFullYear()))
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))

  const { data: employees = [] } = useIpcQuery<Employee[]>(
    ['employees'],
    () => window.api.employees.list(),
  )

  const employeeOptions = employees.map((e) => ({
    value: String(e.id),
    label: `${e.name} (${e.employee_code})`,
  }))

  const yearNum = Number(year)
  const monthNum = Number(month)
  const canFetch =
    employeeId !== null &&
    Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100 &&
    monthNum >= 1 && monthNum <= 12

  const { data: calendar, isLoading } = useIpcQuery<AttendanceMonthlyCalendar>(
    ['attendance', 'monthlyCalendar', String(employeeId), String(year), String(month)],
    () => window.api.attendance.getMonthlyCalendar(employeeId!, yearNum, monthNum),
    { enabled: canFetch },
  )

  const exportMutation = useIpcMutation<
    { filePath: string; filename: string },
    { year: number; month: number }
  >(
    ({ year, month }) => window.api.attendance.exportMonthly(year, month),
    [],
  )

  const handleExport = () => {
    if (!Number.isInteger(yearNum) || !monthNum) return
    exportMutation.mutate({ year: yearNum, month: monthNum })
  }

  const columns: Column<AttendanceSummaryDay>[] = useMemo(() => [
    {
      key: 'date',
      header: 'Date',
      accessor: (d) => d.date,
      sortable: true,
      sortValue: (d) => d.date,
      width: '120px',
    },
    {
      key: 'first_in',
      header: 'In',
      accessor: (d) => formatTime(d.first_in),
      align: 'center',
      width: '80px',
    },
    {
      key: 'last_out',
      header: 'Out',
      accessor: (d) => formatTime(d.last_out),
      align: 'center',
      width: '80px',
    },
    {
      key: 'hours_worked',
      header: 'Hours',
      accessor: (d) => d.hours_worked > 0 ? d.hours_worked.toFixed(2) : '—',
      sortable: true,
      sortValue: (d) => d.hours_worked,
      align: 'right',
      width: '90px',
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (d) => dayStatusBadge(d),
      align: 'center',
      width: '130px',
    },
  ], [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Monthly Summary"
        subtitle={calendar ? `${calendar.employee_name ?? `Employee ${calendar.employee_id}`} — ${calendar.year}-${String(calendar.month).padStart(2, '0')}` : 'Choose an employee and month'}
        actions={
          <Button
            onClick={handleExport}
            isLoading={exportMutation.isPending}
            disabled={!Number.isInteger(yearNum) || !monthNum}
          >
            Export to Excel
          </Button>
        }
      />

      <div className="flex items-end gap-3">
        <div className="min-w-[240px]">
          <Select
            label="Employee"
            options={employeeOptions}
            value={employeeId !== null ? String(employeeId) : ''}
            onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}
            placeholder="Select an employee"
          />
        </div>
        <div className="w-32">
          <Input
            label="Year"
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <div className="w-32">
          <Input
            label="Month"
            type="number"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="1-12"
          />
        </div>
      </div>

      {exportMutation.error && (
        <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">
          {exportMutation.error.message}
        </p>
      )}

      {calendar && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-neutral-500">Total Hours</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">{calendar.total_hours.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-neutral-500">Days Worked</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">{calendar.days_worked}</p>
          </div>
          <div className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-neutral-500">Days Late</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">{calendar.days_late}</p>
          </div>
          <div className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-neutral-500">Days Leave</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">{calendar.days_leave}</p>
          </div>
        </div>
      )}

      <Table
        columns={columns}
        data={calendar?.days ?? []}
        rowKey={(d) => d.date}
        isLoading={isLoading}
        emptyState={{
          title: employeeId === null ? 'Select an employee' : 'No data for this month',
          description: employeeId === null
            ? 'Pick an employee above to view their monthly attendance calendar.'
            : 'There are no attendance logs or leave records for this employee in the selected month.',
        }}
      />
    </div>
  )
}
