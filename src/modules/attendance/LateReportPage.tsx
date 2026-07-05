// LateReportPage — aggregated per-employee lateness report for a chosen month (Phase C3).
// Shows count_late / count_excused / total_minutes_late / avg_minutes_late per employee,
// sorted by the service (count_late DESC). The "Excuse" action for individual late logs
// lives on the Logs tab (where individual rows are visible), not here — this view is a summary.

import { useState, useMemo } from 'react'
import { Table } from '@/shared/components/Table'
import { Input } from '@/shared/components/Input'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery } from '@/shared/hooks/useIpcQuery'
import type { Column } from '@/shared/components/Table'
import type { LateReportRow } from '@/shared/types/entities'

function formatMinutes(min: number): string {
  if (min <= 0) return '0m'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function LateReportPage() {
  const now = new Date()
  const [year, setYear] = useState(String(now.getFullYear()))
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))

  // The IPC handler validates with lateReportSchema (year 2000-2100, month 1-12).
  const yearNum = Number(year)
  const monthNum = Number(month)
  const enabled = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100 && monthNum >= 1 && monthNum <= 12

  const { data: rows = [], isLoading } = useIpcQuery<LateReportRow[]>(
    ['attendance', 'lateReport', year, month],
    () => window.api.attendance.getLateReport(yearNum, monthNum),
    { enabled },
  )

  const columns: Column<LateReportRow>[] = useMemo(() => [
    {
      key: 'employee_name',
      header: 'Employee',
      accessor: (r) => r.employee_name,
      sortable: true,
      sortValue: (r) => r.employee_name,
    },
    {
      key: 'count_late',
      header: 'Late',
      accessor: (r) => r.count_late,
      sortable: true,
      sortValue: (r) => r.count_late,
      align: 'right',
      width: '80px',
    },
    {
      key: 'count_excused',
      header: 'Excused',
      accessor: (r) => r.count_excused,
      sortable: true,
      sortValue: (r) => r.count_excused,
      align: 'right',
      width: '90px',
    },
    {
      key: 'total_minutes_late',
      header: 'Total Late',
      accessor: (r) => formatMinutes(r.total_minutes_late),
      sortable: true,
      sortValue: (r) => r.total_minutes_late,
      align: 'right',
      width: '120px',
    },
    {
      key: 'avg_minutes_late',
      header: 'Avg Late',
      accessor: (r) => formatMinutes(r.avg_minutes_late),
      sortable: true,
      sortValue: (r) => r.avg_minutes_late,
      align: 'right',
      width: '120px',
    },
  ], [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Late Report"
        subtitle={`${rows.length} employee${rows.length !== 1 ? 's' : ''} with late arrivals`}
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
          title: 'No late arrivals',
          description: 'No employees were late in the selected month, or the month has no attendance data yet.',
        }}
      />
    </div>
  )
}
