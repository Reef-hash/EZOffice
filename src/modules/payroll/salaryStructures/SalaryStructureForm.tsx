// SalaryStructureForm — Add/Edit form for per-employee salary structures.
// Mirrors SupplierForm.tsx's prop shape.

import { useState, useEffect } from 'react'
import { Input, Select } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import type { SelectOption } from '@/shared/components/Input'
import type { SalaryStructure } from '@/shared/types/entities'
import type { CreateSalaryStructureInput, UpdateSalaryStructureInput } from '@/shared/types/inputs'
import { RATE_TYPE_OPTIONS, PCB_CATEGORY_OPTIONS } from '../constants'

interface SalaryStructureFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateSalaryStructureInput | UpdateSalaryStructureInput) => Promise<void>
  onDelete?: () => Promise<void>
  isSubmitting: boolean
  isDeleting?: boolean
  structure?: SalaryStructure | null
  employeeOptions: SelectOption[]
}

export function SalaryStructureForm({
  isOpen, onClose, onSubmit, onDelete, isSubmitting, isDeleting, structure, employeeOptions,
}: SalaryStructureFormProps) {
  const isEdit = !!structure

  const [employeeId, setEmployeeId] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [rateType, setRateType] = useState<'daily' | 'hourly' | 'monthly'>('daily')
  const [rateAmount, setRateAmount] = useState('')
  const [standardHoursPerDay, setStandardHoursPerDay] = useState('8')
  const [subjectToEpf, setSubjectToEpf] = useState(true)
  const [subjectToSocso, setSubjectToSocso] = useState(true)
  const [subjectToEis, setSubjectToEis] = useState(true)
  const [pcbCategory, setPcbCategory] = useState<'single' | 'married_no_spouse_income' | 'married_with_spouse_income'>('single')
  const [pcbChildrenCount, setPcbChildrenCount] = useState('0')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (structure) {
      setEmployeeId(String(structure.employee_id))
      setEffectiveFrom(structure.effective_from)
      setRateType(structure.rate_type)
      setRateAmount(String(structure.rate_amount))
      setStandardHoursPerDay(String(structure.standard_hours_per_day))
      setSubjectToEpf(!!structure.subject_to_epf)
      setSubjectToSocso(!!structure.subject_to_socso)
      setSubjectToEis(!!structure.subject_to_eis)
      setPcbCategory(structure.pcb_category)
      setPcbChildrenCount(String(structure.pcb_children_count))
    } else {
      setEmployeeId('')
      setEffectiveFrom(new Date().toISOString().slice(0, 10))
      setRateType('daily')
      setRateAmount('')
      setStandardHoursPerDay('8')
      setSubjectToEpf(true)
      setSubjectToSocso(true)
      setSubjectToEis(true)
      setPcbCategory('single')
      setPcbChildrenCount('0')
    }
    setValidationError(null)
  }, [isOpen, structure])

  function validate(): boolean {
    if (!employeeId) { setValidationError('Employee is required'); return false }
    if (!effectiveFrom) { setValidationError('Effective date is required'); return false }
    if (!rateAmount || Number(rateAmount) <= 0) { setValidationError('Rate must be a positive number'); return false }
    if (rateType !== 'monthly' && (!standardHoursPerDay || Number(standardHoursPerDay) <= 0)) { setValidationError('Standard hours must be a positive number'); return false }
    return true
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateSalaryStructureInput = {
      employee_id: Number(employeeId),
      effective_from: effectiveFrom,
      rate_type: rateType,
      rate_amount: Number(rateAmount),
      standard_hours_per_day: Number(standardHoursPerDay),
      subject_to_epf: subjectToEpf ? 1 : 0,
      subject_to_socso: subjectToSocso ? 1 : 0,
      subject_to_eis: subjectToEis ? 1 : 0,
      pcb_category: pcbCategory,
      pcb_children_count: Number(pcbChildrenCount),
    }

    await onSubmit(data)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Salary Structure' : 'Add Salary Structure'}
      size="md"
      footer={
        <>
          {isEdit && onDelete && (
            <Button variant="danger" isLoading={isDeleting} onClick={onDelete}>
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button isLoading={isSubmitting} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Add Salary Structure'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <Select
          label="Employee"
          required
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          options={employeeOptions}
          placeholder="Select an employee"
          disabled={isEdit}
        />

        <Input
          label="Effective From"
          type="date"
          required
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          helperText="The most recent structure with effective_from on or before a payroll run's month-end is used for that run."
        />

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Rate Type"
            required
            value={rateType}
            onChange={(e) => setRateType(e.target.value as 'daily' | 'hourly' | 'monthly')}
            options={RATE_TYPE_OPTIONS}
          />
          <Input
            label={rateType === 'monthly' ? 'Monthly Salary (RM)' : rateType === 'daily' ? 'Daily Rate (RM)' : 'Hourly Rate (RM)'}
            type="number"
            step="0.01"
            required
            value={rateAmount}
            onChange={(e) => setRateAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>

        {rateType !== 'monthly' && (
        <Input
          label="Standard Hours Per Day"
          type="number"
          step="0.5"
          required
          value={standardHoursPerDay}
          onChange={(e) => setStandardHoursPerDay(e.target.value)}
          helperText="Hours worked beyond this per day count as OT, per the Payroll Settings OT rule."
        />
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-neutral-700">Statutory Contributions</p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={subjectToEpf} onChange={(e) => setSubjectToEpf(e.target.checked)} />
              Subject to EPF
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={subjectToSocso} onChange={(e) => setSubjectToSocso(e.target.checked)} />
              Subject to SOCSO
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={subjectToEis} onChange={(e) => setSubjectToEis(e.target.checked)} />
              Subject to EIS
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="PCB Category"
            value={pcbCategory}
            onChange={(e) => setPcbCategory(e.target.value as typeof pcbCategory)}
            options={PCB_CATEGORY_OPTIONS}
            helperText="Employee's marital status for income tax (PCB) computation."
          />
          <Input
            label="PCB Dependants"
            type="number"
            min="0"
            step="1"
            value={pcbChildrenCount}
            onChange={(e) => setPcbChildrenCount(e.target.value)}
            helperText="Number of qualifying children."
          />
        </div>
      </form>
    </Modal>
  )
}
