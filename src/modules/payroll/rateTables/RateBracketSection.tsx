// RateBracketSection — shared list + inline "add row" form for a wage-bracket rate table
// (EPF/SOCSO/EIS/LINDUNG share this exact shape: wage range -> employee/employer contribution).
// Editing existing rows isn't supported — these are rarely-changed reference tables,
// so delete + re-add covers corrections without the complexity of an edit form (Claude.md §6).
// Built-in rows (shipped with the app, migration 0029) are read-only and show no Delete.

import { useState } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Card } from '@/shared/components/Card'
import { StatusBadge } from '@/shared/components/StatusBadge'
import type { Column } from '@/shared/components/Table'
import { RATE_TABLE_SOURCE } from '@/shared/types/entities'
import type { RateTableSource } from '@/shared/types/entities'

export interface RateBracketRow {
  id: number
  effective_from: string
  employee_category: string
  wage_from: number
  wage_to: number | null
  contribution_employee: number
  contribution_employer: number
  source?: RateTableSource
}

export interface RateBracketDraft {
  effective_from: string
  employee_category: string
  wage_from: number
  wage_to: number | null
  contribution_employee: number
  contribution_employer: number
}

interface RateBracketSectionProps {
  title: string
  description?: string
  rows: RateBracketRow[]
  isLoading: boolean
  employeeFieldLabel: string
  /** Omit for an employee-only table (LINDUNG 24 Jam) — hides the column and sends 0. */
  employerFieldLabel?: string
  onCreate: (draft: RateBracketDraft) => Promise<void>
  onDelete: (id: number) => Promise<void>
  isCreating: boolean
}

export function RateBracketSection({
  title, description, rows, isLoading, employeeFieldLabel, employerFieldLabel, onCreate, onDelete, isCreating,
}: RateBracketSectionProps) {
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10))
  const [category, setCategory] = useState('all')
  const [wageFrom, setWageFrom] = useState('0')
  const [wageTo, setWageTo] = useState('')
  const [contribEmployee, setContribEmployee] = useState('')
  const [contribEmployer, setContribEmployer] = useState('')
  const [error, setError] = useState<string | null>(null)

  const columns: Column<RateBracketRow>[] = [
    { key: 'effective_from', header: 'Effective From', accessor: (r) => r.effective_from, sortable: true, sortValue: (r) => r.effective_from },
    { key: 'category', header: 'Category', accessor: (r) => r.employee_category, sortable: true, sortValue: (r) => r.employee_category },
    {
      key: 'wage_range',
      header: 'Wage Range (RM)',
      accessor: (r) => r.wage_to === null ? `above ${r.wage_from}` : `${r.wage_from} – ${r.wage_to}`,
      align: 'right',
    },
    { key: 'employee', header: employeeFieldLabel, accessor: (r) => r.contribution_employee, align: 'right' },
    ...(employerFieldLabel
      ? [{ key: 'employer', header: employerFieldLabel, accessor: (r: RateBracketRow) => r.contribution_employer, align: 'right' as const }]
      : []),
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '90px',
      accessor: (r) => r.source === RATE_TABLE_SOURCE.BUILTIN
        ? <StatusBadge tone="info">Built-in</StatusBadge>
        : <Button size="sm" variant="ghost" onClick={() => onDelete(r.id)}>Delete</Button>,
    },
  ]

  async function handleAdd() {
    setError(null)
    if (!effectiveFrom || !category.trim() || wageFrom === '' || contribEmployee === '' || (employerFieldLabel && contribEmployer === '')) {
      setError('All fields except Not Exceeding are required')
      return
    }
    await onCreate({
      effective_from: effectiveFrom,
      employee_category: category.trim(),
      wage_from: Number(wageFrom),
      wage_to: wageTo === '' ? null : Number(wageTo),
      contribution_employee: Number(contribEmployee),
      contribution_employer: employerFieldLabel ? Number(contribEmployer) : 0,
    })
    setWageFrom('0')
    setWageTo('')
    setContribEmployee('')
    setContribEmployer('')
  }

  return (
    <Card title={title} subtitle={description}>
      <div className="flex flex-col gap-4">
        <Table
          columns={columns}
          data={rows}
          rowKey={(r) => String(r.id)}
          isLoading={isLoading}
          emptyState={{ title: 'No rates entered yet — add the official bracket rows below.' }}
        />

        <div className="flex flex-wrap items-end gap-3 border-t border-neutral-200 pt-4">
          <Input label="Effective From" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="w-40" />
          <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="all" className="w-28" />
          <Input label="Wage Exceeding" type="number" value={wageFrom} onChange={(e) => setWageFrom(e.target.value)} className="w-28" />
          <Input label="Not Exceeding" type="number" value={wageTo} onChange={(e) => setWageTo(e.target.value)} placeholder="no limit" className="w-28" />
          <Input label={employeeFieldLabel} type="number" step="0.01" value={contribEmployee} onChange={(e) => setContribEmployee(e.target.value)} className="w-32" />
          {employerFieldLabel && (
            <Input label={employerFieldLabel} type="number" step="0.01" value={contribEmployer} onChange={(e) => setContribEmployer(e.target.value)} className="w-32" />
          )}
          <Button size="sm" isLoading={isCreating} onClick={handleAdd}>Add Row</Button>
        </div>
        {error && <p className="text-sm text-error-700">{error}</p>}
      </div>
    </Card>
  )
}
