// PayrollRunPage — detail view for a single payroll run.
// Shows run items table with earnings/deductions breakdown.
// Actions: Calculate (draft runs only), Finalize, Print Payslip per employee.

import { useState, useCallback, useMemo } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PageHeader } from '@/shared/components/PageHeader'
import { Card } from '@/shared/components/Card'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { Column } from '@/shared/components/Table'
import type { PayrollRun, PayrollRunItem } from '@/shared/types/entities'
import { PAYROLL_RUN_STATUS_LABEL, PAYROLL_RUN_STATUS_TONE } from './constants'

interface PayrollRunPageProps {
  runId: number
  onBack: () => void
}

function formatCurrency(amount: number): string {
  return `RM ${amount.toFixed(2)}`
}

const itemColumns: Column<PayrollRunItem>[] = [
  { key: 'employee_name', header: 'Employee', accessor: (r) => r.employee_name || `ID ${r.employee_id}`, sortable: true, sortValue: (r) => r.employee_name || '' },
  { key: 'regular_hours', header: 'Reg Hrs', accessor: (r) => r.total_regular_hours.toFixed(1), sortable: true, sortValue: (r) => r.total_regular_hours, align: 'right', width: '80px' },
  { key: 'ot_hours', header: 'OT Hrs', accessor: (r) => r.total_ot_hours.toFixed(1), sortable: true, sortValue: (r) => r.total_ot_hours, align: 'right', width: '80px' },
  { key: 'gross_pay', header: 'Gross Pay', accessor: (r) => formatCurrency(r.gross_pay), sortable: true, sortValue: (r) => r.gross_pay, align: 'right' },
  { key: 'net_pay', header: 'Net Pay', accessor: (r) => formatCurrency(r.net_pay), sortable: true, sortValue: (r) => r.net_pay, align: 'right' },
  { key: 'advance', header: 'Adv Ded', accessor: (r) => r.advance_deduction > 0 ? formatCurrency(r.advance_deduction) : '—', sortable: true, sortValue: (r) => r.advance_deduction, align: 'right' },
]

export function PayrollRunPage({ runId, onBack }: PayrollRunPageProps) {
  const [calculating, setCalculating] = useState(false)

  const { data: run, isLoading: runLoading } = useIpcQuery<PayrollRun | null>(
    ['payroll', 'runs', String(runId)],
    () => window.api.payroll.runs.getById(runId),
  )

  const { data: rateTableCheck } = useIpcQuery<{ missing: string[] }>(
    ['payroll', 'runs', 'checkRateTables'],
    () => window.api.payroll.runs.checkRateTables(),
  )

  const { data: items = [], isLoading: itemsLoading } = useIpcQuery<PayrollRunItem[]>(
    ['payroll', 'runs', String(runId), 'items'],
    () => window.api.payroll.runs.getItems(runId),
  )

  const calculateMutation = useIpcMutation<PayrollRun, number>(
    (id) => window.api.payroll.runs.calculate(id),
    [['payroll', 'runs', String(runId)], ['payroll', 'runs', String(runId), 'items']],
  )

  const finalizeMutation = useIpcMutation<PayrollRun, number>(
    (id) => window.api.payroll.runs.finalize(id),
    [['payroll', 'runs'], ['payroll', 'runs', String(runId)]],
  )

  const handleCalculate = useCallback(async () => {
    setCalculating(true)
    try {
      await calculateMutation.mutateAsync(runId)
    } finally {
      setCalculating(false)
    }
  }, [calculateMutation, runId])

  const handleFinalize = useCallback(async () => {
    await finalizeMutation.mutateAsync(runId)
  }, [finalizeMutation, runId])

  const handlePrintPayslip = useCallback(async (employeeId: number) => {
    try {
      await window.api.payroll.runs.printPayslip(runId, employeeId)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to print payslip:', err)
    }
  }, [runId])

  const isDraft = run?.status === 'draft'
  const periodLabel = run
    ? `${run.year}-${String(run.month).padStart(2, '0')}`
    : ''

  // Summary totals
  const totals = useMemo(() => {
    if (items.length === 0) return { gross: 0, net: 0, count: 0 }
    return {
      gross: items.reduce((sum, i) => sum + i.gross_pay, 0),
      net: items.reduce((sum, i) => sum + i.net_pay, 0),
      count: items.length,
    }
  }, [items])

  if (runLoading) {
    return <div className="p-6 text-neutral-500">Loading payroll run...</div>
  }

  if (!run) {
    return (
      <div className="p-6 text-neutral-500">
        Payroll run not found.
        <Button variant="ghost" onClick={onBack} className="ml-2">Go back</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Payroll Run: ${periodLabel}`}
        subtitle={
          <StatusBadge tone={PAYROLL_RUN_STATUS_TONE[run.status]}>
            {PAYROLL_RUN_STATUS_LABEL[run.status]}
          </StatusBadge>
        }
        actions={
          <Button variant="ghost" onClick={onBack}>← Back to Runs</Button>
        }
      />

      {/* Empty rate table warning — shown for draft runs only; finalization will be blocked anyway */}
      {isDraft && rateTableCheck && rateTableCheck.missing.length > 0 && (
        <div className="rounded-md border border-warning-600 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <strong>Warning:</strong> The following statutory rate tables are empty:{' '}
          <strong>{rateTableCheck.missing.join(', ')}</strong>. All deductions will compute as RM 0.00
          until you populate the rate tables under{' '}
          <span className="font-medium">Statutory Rate Tables</span>. Finalizing is blocked until this is resolved.
        </div>
      )}

      {/* Actions bar */}
      <div className="flex items-center gap-3">
        {isDraft && (
          <>
            <Button
              variant="primary"
              onClick={handleCalculate}
              isLoading={calculating || calculateMutation.isPending}
            >
              {items.length > 0 ? 'Recalculate' : 'Calculate'}
            </Button>
            {items.length > 0 && (
              <Button
                variant="dark"
                onClick={handleFinalize}
                isLoading={finalizeMutation.isPending}
              >
                Finalize Run
              </Button>
            )}
          </>
        )}
        {!isDraft && (
          <span className="text-sm text-neutral-500">
            This run is finalized — calculations are locked.
          </span>
        )}
      </div>

      {calculateMutation.error && (
        <Card>
          <p className="text-sm text-error-700">{calculateMutation.error.message}</p>
        </Card>
      )}
      {finalizeMutation.error && (
        <Card>
          <p className="text-sm text-error-700">{finalizeMutation.error.message}</p>
        </Card>
      )}

      {/* Summary Cards */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <p className="text-xs font-medium uppercase text-neutral-500">Employees</p>
            <p className="text-2xl font-bold text-neutral-800 dark:text-white">{totals.count}</p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase text-neutral-500">Total Gross</p>
            <p className="text-2xl font-bold text-neutral-800 dark:text-white">{formatCurrency(totals.gross)}</p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase text-neutral-500">Total Net Pay</p>
            <p className="text-2xl font-bold text-success-700">{formatCurrency(totals.net)}</p>
          </Card>
        </div>
      )}

      {/* Run Items Table */}
      <Table<PayrollRunItem>
        columns={itemColumns}
        data={items}
        rowKey={(r) => String(r.id)}
        isLoading={itemsLoading}
        emptyState={{
          title: isDraft
            ? 'Click "Calculate" to compute payroll for all active employees with salary structures.'
            : 'No items in this payroll run.',
        }}
        onRowClick={(item) => handlePrintPayslip(item.employee_id)}
      />

      {items.length > 0 && (
        <p className="text-xs text-neutral-400 text-center">
          Click any row to generate the payslip PDF for that employee.
        </p>
      )}
    </div>
  )
}
