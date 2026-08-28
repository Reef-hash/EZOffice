// AttendanceSummaryPage — per-employee attendance calendar + Excel export (Phase C4).
//
// Viewable by calendar month OR by payroll period. Period mode added 2026-08-27: payroll
// pays on periods (e.g. 26 Jul - 25 Aug), so a month-only view could not be reconciled
// against a payroll run and made correct payroll figures look inflated.
//
// Hours are shown as Regular / OT / Rest-Holiday, not just raw clocked time, for the same
// reason — the clocked figure is larger than what payroll pays as regular, which reads as
// a discrepancy when the two screens are compared side by side. Rest-day and public-
// holiday hours get their own column because payroll pays them from their own buckets at
// a premium rate; folding them into Regular here made this screen over-report.

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
  PayrollPeriod,
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

type ViewMode = 'period' | 'month'

export function AttendanceSummaryPage() {
  const now = new Date()
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  // Period is the default: it is what payroll pays on, so it is the view that
  // reconciles. Month remains available for a plain calendar look.
  const [mode, setMode] = useState<ViewMode>('period')
  const [periodId, setPeriodId] = useState('')
  const [year, setYear] = useState(String(now.getFullYear()))
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))

  const { data: employees = [] } = useIpcQuery<Employee[]>(
    ['employees'],
    () => window.api.employees.list(),
  )

  const { data: periods = [] } = useIpcQuery<PayrollPeriod[]>(
    ['payroll', 'periods'],
    () => window.api.payroll.periods.list(),
  )

  // Only processed periods have daily records behind them.
  const periodOptions = periods
    .filter((p) => p.status !== 'open')
    .map((p) => ({ value: String(p.id), label: `${p.name} (${p.start_date} – ${p.end_date})` }))

  const employeeOptions = employees.map((e) => ({
    value: String(e.id),
    label: `${e.name} (${e.employee_code})`,
  }))

  const yearNum = Number(year)
  const monthNum = Number(month)
  const monthValid =
    Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100 &&
    monthNum >= 1 && monthNum <= 12
  const canFetch = employeeId !== null && (mode === 'period' ? periodId !== '' : monthValid)

  const { data: calendar, isLoading } = useIpcQuery<AttendanceMonthlyCalendar>(
    ['attendance', 'calendar', mode, String(employeeId), mode === 'period' ? periodId : `${year}-${month}`],
    () => (mode === 'period'
      ? window.api.attendance.getPeriodCalendar(employeeId!, Number(periodId))
      : window.api.attendance.getMonthlyCalendar(employeeId!, yearNum, monthNum)),
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
      header: 'Clocked',
      accessor: (d) => d.hours_worked > 0 ? d.hours_worked.toFixed(2) : '—',
      sortable: true,
      sortValue: (d) => d.hours_worked,
      align: 'right',
      width: '90px',
    },
    {
      key: 'regular_hours',
      header: 'Regular',
      accessor: (d) => d.regular_hours > 0 ? d.regular_hours.toFixed(2) : '—',
      sortable: true,
      sortValue: (d) => d.regular_hours,
      align: 'right',
      width: '90px',
    },
    {
      key: 'ot_hours',
      header: 'OT',
      accessor: (d) => d.ot_hours > 0 ? d.ot_hours.toFixed(2) : '—',
      sortable: true,
      sortValue: (d) => d.ot_hours,
      align: 'right',
      width: '80px',
    },
    {
      key: 'premium_hours',
      header: 'Rest/Holiday',
      accessor: (d) => d.premium_hours > 0 ? d.premium_hours.toFixed(2) : '—',
      sortable: true,
      sortValue: (d) => d.premium_hours,
      align: 'right',
      width: '110px',
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
        title="Attendance Summary"
        subtitle={calendar
          ? `${calendar.employee_name ?? `Employee ${calendar.employee_id}`} — ${calendar.period_name ?? `${calendar.year}-${String(calendar.month).padStart(2, '0')}`} (${calendar.start_date} → ${calendar.end_date})`
          : 'Choose an employee and a payroll period'}
        actions={
          mode === 'month' ? (
            <Button
              onClick={handleExport}
              isLoading={exportMutation.isPending}
              disabled={!monthValid}
            >
              Export to Excel
            </Button>
          ) : undefined
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
        <div className="w-44">
          <Select
            label="View By"
            options={[
              { value: 'period', label: 'Payroll Period' },
              { value: 'month', label: 'Calendar Month' },
            ]}
            value={mode}
            onChange={(e) => setMode(e.target.value as ViewMode)}
          />
        </div>

        {mode === 'period' ? (
          <div className="min-w-[300px]">
            <Select
              label="Payroll Period"
              options={periodOptions}
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              placeholder="Select a payroll period"
            />
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      {mode === 'period' && periodOptions.length === 0 && (
        <p className="text-sm text-neutral-500">
          No processed payroll periods yet. Process a period under Payroll → Payroll Periods first.
        </p>
      )}

      {exportMutation.error && (
        <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">
          {exportMutation.error.message}
        </p>
      )}

      {calendar && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
          <div className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-neutral-500">Regular Hours</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">{calendar.total_regular_hours.toFixed(2)}</p>
            <p className="mt-0.5 text-xs text-neutral-500">Clocked {calendar.total_hours.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-neutral-500">OT Hours</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">{calendar.total_ot_hours.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-neutral-500">Rest/Holiday Hours</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">{calendar.total_premium_hours.toFixed(2)}</p>
            <p className="mt-0.5 text-xs text-neutral-500">Paid at premium rate</p>
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
          title: employeeId === null ? 'Select an employee' : 'No data for this range',
          description: employeeId === null
            ? 'Pick an employee above to view their attendance calendar.'
            : 'There are no processed attendance records for this employee in the selected range.',
        }}
      />
    </div>
  )
}
