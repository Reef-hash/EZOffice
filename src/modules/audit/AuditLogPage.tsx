// AuditLogPage — view admin audit trail.
// Shows all mutations (create/update/delete) with admin who made the change.

import { useState, useMemo } from 'react'
import type { ChangeEvent } from 'react'
import { Table } from '@/shared/components/Table'
import { PageHeader } from '@/shared/components/PageHeader'
import { Select } from '@/shared/components/Input'
import { useIpcQuery } from '@/shared/hooks/useIpcQuery'
import type { Column } from '@/shared/components/Table'
import type { AuditEntry } from '@/shared/types/api'

import { StatusBadge } from '@/shared/components/StatusBadge'
import { AUDIT_ACTION_TONE } from './constants'

const ACTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All Actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
]

const TIMEFRAMES: Array<{ value: number; label: string }> = [
  { value: 0, label: 'All Time' },
  { value: 7, label: 'Last 7 Days' },
  { value: 30, label: 'Last 30 Days' },
  { value: 90, label: 'Last 90 Days' },
]

const columns: Column<AuditEntry>[] = [
  {
    key: 'timestamp',
    header: 'Timestamp',
    accessor: (r) => new Date(r.timestamp).toLocaleString(),
    sortable: true,
    sortValue: (r) => r.timestamp,
    width: '150px',
  },
  {
    key: 'action',
    header: 'Action',
    accessor: (r) => (
      <StatusBadge tone={AUDIT_ACTION_TONE[r.action] || 'neutral'}>
        {r.action}
      </StatusBadge>
    ),
    sortable: true,
    sortValue: (r) => r.action,
    align: 'center',
    width: '100px',
  },
  {
    key: 'table_name',
    header: 'Table',
    accessor: (r) => r.table_name || '—',
    sortable: true,
    sortValue: (r) => r.table_name || '',
  },
  {
    key: 'record_id',
    header: 'Record ID',
    accessor: (r) => r.record_id || '—',
    sortable: true,
    sortValue: (r) => r.record_id || 0,
    align: 'center',
  },
  {
    key: 'details',
    header: 'Details',
    accessor: (r) => {
      if (!r.details) return '—'
      try {
        const details = JSON.parse(r.details)
        return <span className="text-xs text-neutral-600">{JSON.stringify(details).substring(0, 50)}...</span>
      } catch {
        return <span className="text-xs text-neutral-600">{r.details.substring(0, 50)}...</span>
      }
    },
    sortable: false,
  },
]

export function AuditLogPage() {
  const [selectedAction, setSelectedAction] = useState('')
  const [selectedTimeframe, setSelectedTimeframe] = useState('0')

  const filters = useMemo(
    () => ({
      action: selectedAction || undefined,
      limitDays: selectedTimeframe !== '0' ? Number(selectedTimeframe) : undefined,
    }),
    [selectedAction, selectedTimeframe],
  )

  const { data: logs = [], isLoading } = useIpcQuery<AuditEntry[]>(
    ['audit', 'list', selectedAction, selectedTimeframe],
    () => window.api.audit.list(filters),
  )

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle={`${logs.length} entries`}
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-[180px]">
          <Select
            label="Action"
            value={selectedAction}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedAction(e.target.value)}
            options={ACTIONS}
          />
        </div>

        <div className="min-w-[180px]">
          <Select
            label="Timeframe"
            value={selectedTimeframe}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedTimeframe(e.target.value)}
            options={TIMEFRAMES.map((t) => ({ value: String(t.value), label: t.label }))}
          />
        </div>
      </div>

      {/* Table */}
      <Table
        columns={columns}
        data={logs}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No audit entries found',
          description: 'No activity matches the current filters.',
        }}
      />
    </div>
  )
}
