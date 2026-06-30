// PcbBracketSection — list + inline "add row" form for the PCB Schedule lookup table.
// Distinct shape from EPF/SOCSO/EIS (category × children count × income bracket -> tax amount),
// so it isn't folded into RateBracketSection.

import { useState } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Input, Select } from '@/shared/components/Input'
import { Card } from '@/shared/components/Card'
import type { Column } from '@/shared/components/Table'
import type { PcbBracket } from '@/shared/types/entities'
import type { CreatePcbBracketInput } from '@/shared/types/inputs'
import { PCB_CATEGORY_LABEL, PCB_CATEGORY_OPTIONS } from '../constants'

interface PcbBracketSectionProps {
  rows: PcbBracket[]
  isLoading: boolean
  onCreate: (draft: CreatePcbBracketInput) => Promise<void>
  onDelete: (id: number) => Promise<void>
  isCreating: boolean
}

const columns: Column<PcbBracket>[] = [
  { key: 'effective_from', header: 'Effective From', accessor: (r) => r.effective_from, sortable: true, sortValue: (r) => r.effective_from },
  { key: 'category', header: 'Category', accessor: (r) => PCB_CATEGORY_LABEL[r.category], sortable: true, sortValue: (r) => r.category },
  { key: 'children', header: 'Children', accessor: (r) => r.children_count, align: 'center', width: '80px' },
  { key: 'income_range', header: 'Chargeable Income (RM)', accessor: (r) => `${r.chargeable_income_from} – ${r.chargeable_income_to ?? '∞'}`, align: 'right' },
  { key: 'tax_amount', header: 'PCB (RM)', accessor: (r) => r.tax_amount.toFixed(2), align: 'right' },
]

export function PcbBracketSection({ rows, isLoading, onCreate, onDelete, isCreating }: PcbBracketSectionProps) {
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10))
  const [category, setCategory] = useState<CreatePcbBracketInput['category']>('single')
  const [childrenCount, setChildrenCount] = useState('0')
  const [incomeFrom, setIncomeFrom] = useState('0')
  const [incomeTo, setIncomeTo] = useState('')
  const [taxAmount, setTaxAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const tableColumns: Column<PcbBracket>[] = [
    ...columns,
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '90px',
      accessor: (r) => (
        <Button size="sm" variant="ghost" onClick={() => onDelete(r.id)}>Delete</Button>
      ),
    },
  ]

  async function handleAdd() {
    setError(null)
    if (!effectiveFrom || incomeFrom === '' || taxAmount === '') {
      setError('Effective date, chargeable income from, and PCB amount are required')
      return
    }
    await onCreate({
      effective_from: effectiveFrom,
      category,
      children_count: Number(childrenCount),
      chargeable_income_from: Number(incomeFrom),
      chargeable_income_to: incomeTo === '' ? null : Number(incomeTo),
      tax_amount: Number(taxAmount),
    })
    setIncomeFrom('0')
    setIncomeTo('')
    setTaxAmount('')
  }

  return (
    <Card
      title="PCB Schedule (Monthly Tax Deduction)"
      subtitle="Simplified bracket lookup — see CLAUDE.md §7 for the decision to use the PCB Schedule rather than the full MTD formula."
    >
      <div className="flex flex-col gap-4">
        <Table
          columns={tableColumns}
          data={rows}
          rowKey={(r) => String(r.id)}
          isLoading={isLoading}
          emptyState={{ title: 'No PCB brackets entered yet — add rows from the official LHDN PCB Schedule below.' }}
        />

        <div className="flex flex-wrap items-end gap-3 border-t border-neutral-200 pt-4">
          <Input label="Effective From" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="w-40" />
          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as CreatePcbBracketInput['category'])}
            options={PCB_CATEGORY_OPTIONS}
            className="w-56"
          />
          <Input label="Children" type="number" value={childrenCount} onChange={(e) => setChildrenCount(e.target.value)} className="w-20" />
          <Input label="Income From" type="number" value={incomeFrom} onChange={(e) => setIncomeFrom(e.target.value)} className="w-28" />
          <Input label="Income To" type="number" value={incomeTo} onChange={(e) => setIncomeTo(e.target.value)} placeholder="no limit" className="w-28" />
          <Input label="PCB Amount (RM)" type="number" step="0.01" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} className="w-32" />
          <Button size="sm" isLoading={isCreating} onClick={handleAdd}>Add Row</Button>
        </div>
        {error && <p className="text-sm text-error-700">{error}</p>}
      </div>
    </Card>
  )
}
