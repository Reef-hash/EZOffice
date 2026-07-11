// PayrollListPage — main payroll hub: run list, create new run, data quality warnings.
// Sub-pages (salary structures, rate tables, advances) are linked from card sections.

import { useState, useCallback } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Card } from '@/shared/components/Card'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PageHeader } from '@/shared/components/PageHeader'
import { Modal } from '@/shared/components/Modal'
import { Select } from '@/shared/components/Input'
import { cn } from '@/shared/lib/cn'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { useKeyboardShortcut } from '@/shared/hooks/useKeyboardShortcut'
import { PayrollRunPage } from './PayrollRunPage'
import { SalaryStructureListPage } from './salaryStructures/SalaryStructureListPage'
import { PayrollSettingsPage } from './settings/PayrollSettingsPage'
import { RateTablesPage } from './rateTables/RateTablesPage'
import { SalaryAdvanceListPage } from './salaryAdvances/SalaryAdvanceListPage'
import { PayrollPeriodListPage } from './payrollPeriods/PayrollPeriodListPage'
import type { Column } from '@/shared/components/Table'
import type { PayrollRun } from '@/shared/types/entities'
import type { CreatePayrollRunInput } from '@/shared/types/inputs'
import { PAYROLL_RUN_STATUS_LABEL, PAYROLL_RUN_STATUS_TONE } from './constants'

type PayrollTab = 'runs' | 'salaryStructures' | 'settings' | 'rateTables' | 'advances' | 'periods'

const TABS: Array<{ key: PayrollTab; label: string }> = [
  { key: 'runs', label: 'Payroll Runs' },
  { key: 'periods', label: 'Payroll Periods' },
  { key: 'salaryStructures', label: 'Salary Structures' },
  { key: 'advances', label: 'Salary Advances' },
  { key: 'rateTables', label: 'Statutory Rate Tables' },
  { key: 'settings', label: 'Settings' },
]

const runColumns: Column<PayrollRun>[] = [
  {
    key: 'period',
    header: 'Period',
    accessor: (r) => `${r.year}-${String(r.month).padStart(2, '0')}`,
    sortable: true,
    sortValue: (r) => `${r.year}-${String(r.month).padStart(2, '0')}`,
  },
  {
    key: 'status',
    header: 'Status',
    accessor: (r) => (
      <StatusBadge tone={PAYROLL_RUN_STATUS_TONE[r.status]}>
        {PAYROLL_RUN_STATUS_LABEL[r.status]}
      </StatusBadge>
    ),
    sortable: true,
    sortValue: (r) => r.status,
    align: 'center',
    width: '100px',
  },
  {
    key: 'run_date',
    header: 'Run Date',
    accessor: (r) => new Date(r.run_date).toLocaleDateString(),
    sortable: true,
    sortValue: (r) => r.run_date,
  },
]

const MONTHS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
]

const currentYear = new Date().getFullYear()
const currentMonth = new Date().getMonth() + 1
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => ({
  value: String(currentYear - 2 + i),
  label: String(currentYear - 2 + i),
}))

export function PayrollListPage() {
  const [activeTab, setActiveTab] = useState<PayrollTab>('runs')
  const [showCreateRun, setShowCreateRun] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [newYear, setNewYear] = useState(String(currentYear))
  const [newMonth, setNewMonth] = useState(String(currentMonth))

  const handleKeyboardN = useCallback(() => {
    if (activeTab === 'runs') {
      setShowCreateRun(true)
    }
  }, [activeTab])

  useKeyboardShortcut([
    {
      key: 'n',
      ctrlKey: true,
      callback: handleKeyboardN,
    },
  ])

  // ── Payroll runs list ──
  const { data: runs = [], isLoading } = useIpcQuery<PayrollRun[]>(
    ['payroll', 'runs'],
    () => window.api.payroll.runs.list(),
  )

  const createRunMutation = useIpcMutation<PayrollRun, CreatePayrollRunInput>(
    (data) => window.api.payroll.runs.create(data),
    [['payroll', 'runs']],
    { onSuccessMessage: 'Payroll run created successfully' },
  )

  const handleCreateRun = useCallback(async () => {
    try {
      const result = await createRunMutation.mutateAsync({
        year: Number(newYear),
        month: Number(newMonth),
      })
      setShowCreateRun(false)
      setSelectedRunId(result.id)
    } catch {
      // error handled via mutation state
    }
  }, [createRunMutation, newYear, newMonth])

  if (selectedRunId) {
    return (
      <PayrollRunPage
        runId={selectedRunId}
        onBack={() => setSelectedRunId(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payroll"
        subtitle="Manage salary structures, statutory rates, advances, and monthly payroll runs"
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

      <div key={activeTab} className="animate-[fade-in_0.15s_ease-out]">
        {activeTab === 'runs' && (
          <>
          {/* Quick Actions */}
          <div className="flex items-center gap-3">
            <Button variant="dark" onClick={() => setShowCreateRun(true)}>
              + New Payroll Run
            </Button>
          </div>

          {/* Data Quality Warning */}
          <Card>
            <div className="flex items-start gap-3 text-sm">
              <span className="text-base">⚠️</span>
              <div>
                <p className="font-medium text-neutral-800 dark:text-white">Rate Table Data Required</p>
                <p className="text-neutral-500 mt-0.5">
                  EPF, SOCSO, EIS, and PCB rate tables are empty or contain placeholder values only.
                  Enter authoritative figures from official KWSP/PERKESO/LHDN publications (see the
                  Statutory Rate Tables tab) before running payroll. A payroll run will still produce
                  calculations, but statutory deductions will default to zero.
                </p>
              </div>
            </div>
          </Card>

          {/* Run List */}
          <Table<PayrollRun>
            columns={runColumns}
            data={runs}
            rowKey={(r) => String(r.id)}
            isLoading={isLoading}
            emptyState={{ title: 'No payroll runs yet. Create one to get started.' }}
            onRowClick={(run) => setSelectedRunId(run.id)}
          />

          {/* Create Run Modal */}
          <Modal
            isOpen={showCreateRun}
            onClose={() => setShowCreateRun(false)}
            title="Create Payroll Run"
          >
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="Year"
                  options={YEAR_OPTIONS}
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value)}
                />
                <Select
                  label="Month"
                  options={MONTHS}
                  value={newMonth}
                  onChange={(e) => setNewMonth(e.target.value)}
                />
              </div>
              {createRunMutation.error && (
                <p className="text-sm text-error-700">{createRunMutation.error.message}</p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setShowCreateRun(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCreateRun}
                  isLoading={createRunMutation.isPending}
                >
                  Create Run
                </Button>
              </div>
            </div>
          </Modal>
        </>
      )}

        {activeTab === 'periods' && <PayrollPeriodListPage />}
        {activeTab === 'salaryStructures' && <SalaryStructureListPage />}
        {activeTab === 'advances' && <SalaryAdvanceListPage />}
        {activeTab === 'rateTables' && <RateTablesPage />}
        {activeTab === 'settings' && <PayrollSettingsPage />}
      </div>
    </div>
  )
}
