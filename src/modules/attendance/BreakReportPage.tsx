// BreakReportPage — aggregated per-employee "over the allowed rest/lunch break"
// report for a chosen month. Mirrors LateReportPage.tsx's shape and pattern.
// Only employees with at least one day over their shift's break_minutes allowance
// appear here (see getBreakReport in attendance.ts) — an employee who never
// exceeds their break simply doesn't show up, same as the late report.

import { useState, useMemo } from 'react'
import { Table } from '@/shared/components/Table'
import { Input } from '@/shared/components/Input'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery } from '@/shared/hooks/useIpcQuery'
import type { Column } from '@/shared/components/Table'
import type { BreakReportRow } from '@/shared/types/entities'

function formatMinutes(min: number): string {
  if (min <= 0) return '0m'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function BreakReportPage() {
  const now = new Date()
  const [year, setYear] = useState(String(now.getFullYear()))
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))

  // The IPC handler validates with breakReportSchema (year 2000-2100, month 1-12).
  const yearNum = Number(year)
  const monthNum = Number(month)
  const enabled = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100 && monthNum >= 1 && monthNum <= 12

  const { data: rows = [], isLoading } = useIpcQuery<BreakReportRow[]>(
    ['attendance', 'breakReport', year, month],
    () => window.api.attendance.getBreakReport(yearNum, monthNum),
    { enabled },
  )

  const columns: Column<BreakReportRow>[] = useMemo(() => [
    {
      key: 'employee_name',
      header: 'Employee',
      accessor: (r) => r.employee_name,
      sortable: true,
      sortValue: (r) => r.employee_name,
    },
    {
      key: 'days_over_limit',
      header: 'Days Over',
      accessor: (r) => r.days_over_limit,
      sortable: true,
      sortValue: (r) => r.days_over_limit,
      align: 'right',
      width: '100px',
    },
    {
      key: 'total_minutes_over',
      header: 'Total Over',
      accessor: (r) => formatMinutes(r.total_minutes_over),
      sortable: true,
      sortValue: (r) => r.total_minutes_over,
      align: 'right',
      width: '120px',
    },
    {
      key: 'avg_minutes_over',
      header: 'Avg Over/Day',
      accessor: (r) => formatMinutes(r.avg_minutes_over),
      sortable: true,
      sortValue: (r) => r.avg_minutes_over,
      align: 'right',
      width: '130px',
    },
  ], [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Break Report"
        subtitle={`${rows.length} employee${rows.length !== 1 ? 's' : ''} exceeding their allowed rest/lunch break`}
      />

      <div className="flex items-end gap-3">
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

      <Table
        columns={columns}
        data={rows}
        rowKey={(r) => String(r.employee_id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No break overages',
          description: 'No employees exceeded their shift\'s allowed break in the selected month, or the month has no attendance data yet.',
        }}
      />
    </div>
  )
}
