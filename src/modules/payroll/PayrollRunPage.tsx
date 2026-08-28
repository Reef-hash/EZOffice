// PayrollRunPage — detail view for a single payroll run.
// Shows run items table with earnings/deductions breakdown.
// Actions: Calculate (draft runs only), Finalize, Print Payslip per employee.

import { useState, useCallback, useMemo } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PageHeader } from '@/shared/components/PageHeader'
import { Card } from '@/shared/components/Card'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { useToast } from '@/shared/components/Toast'
import type { Column } from '@/shared/components/Table'
import type { PayrollRun, PayrollRunItem, UnfinalizeResult } from '@/shared/types/entities'
import { PAYROLL_RUN_STATUS_LABEL, PAYROLL_RUN_STATUS_TONE, PAYROLL_RUN_PAY_GROUP_LABEL } from './constants'
import { CommissionPanel } from './CommissionPanel'

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
  { key: 'commission', header: 'Commission', accessor: (r) => r.commission > 0 ? formatCurrency(r.commission) : '—', sortable: true, sortValue: (r) => r.commission, align: 'right' },
  {
    key: 'attendance_shortfall',
    header: 'Shortfall',
    accessor: (r) => r.attendance_shortfall_amount > 0
      ? `-${formatCurrency(r.attendance_shortfall_amount)} (${r.attendance_shortfall_hours.toFixed(1)}h)`
      : '—',
    sortable: true,
    sortValue: (r) => r.attendance_shortfall_amount,
    align: 'right',
  },
  { key: 'rest_day_pay', header: 'Rest Day', accessor: (r) => r.rest_day_pay > 0 ? formatCurrency(r.rest_day_pay) : '—', sortable: true, sortValue: (r) => r.rest_day_pay, align: 'right' },
  { key: 'holiday_pay', header: 'Holiday', accessor: (r) => r.holiday_pay > 0 ? formatCurrency(r.holiday_pay) : '—', sortable: true, sortValue: (r) => r.holiday_pay, align: 'right' },
  { key: 'gross_pay', header: 'Gross Pay', accessor: (r) => formatCurrency(r.gross_pay), sortable: true, sortValue: (r) => r.gross_pay, align: 'right' },
  {
    key: 'epf_wage_base',
    header: 'EPF/SOCSO/EIS Base',
    accessor: (r) => r.epf_wage_base > 0 && r.epf_wage_base !== r.gross_pay ? formatCurrency(r.epf_wage_base) : '—',
    sortable: true,
    sortValue: (r) => r.epf_wage_base,
    align: 'right',
  },
  { key: 'net_pay', header: 'Net Pay', accessor: (r) => formatCurrency(r.net_pay), sortable: true, sortValue: (r) => r.net_pay, align: 'right' },
  { key: 'advance', header: 'Adv Ded', accessor: (r) => r.advance_deduction > 0 ? formatCurrency(r.advance_deduction) : '—', sortable: true, sortValue: (r) => r.advance_deduction, align: 'right' },
]

export function PayrollRunPage({ runId, onBack }: PayrollRunPageProps) {
  const { addToast } = useToast()
  const [calculating, setCalculating] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showConfirmUnfinalize, setShowConfirmUnfinalize] = useState(false)
  const [advancesToVerify, setAdvancesToVerify] = useState<UnfinalizeResult['advancesToVerify']>([])

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
    { onSuccessMessage: 'Payroll run calculated successfully' },
  )

  const finalizeMutation = useIpcMutation<PayrollRun, number>(
    (id) => window.api.payroll.runs.finalize(id),
    [['payroll', 'runs'], ['payroll', 'runs', String(runId)]],
    { onSuccessMessage: 'Payroll run finalized successfully' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.payroll.runs.delete(id),
    [['payroll', 'runs']],
    { onSuccessMessage: 'Payroll run deleted' },
  )

  const unfinalizeMutation = useIpcMutation<UnfinalizeResult, number>(
    (id) => window.api.payroll.runs.unfinalize(id),
    [['payroll', 'runs'], ['payroll', 'runs', String(runId)], ['payroll', 'runs', String(runId), 'items']],
  )

  const handleDelete = useCallback(async () => {
    try {
      await deleteMutation.mutateAsync(runId)
      setShowConfirmDelete(false)
      onBack()
    } catch {
      // error handled via mutation state
    }
  }, [deleteMutation, runId, onBack])

  const handleUnfinalize = useCallback(async () => {
    try {
      const result = await unfinalizeMutation.mutateAsync(runId)
      setShowConfirmUnfinalize(false)
      setAdvancesToVerify(result.advancesToVerify)
      addToast('Payroll run reverted to draft.', 'success')
    } catch {
      // error handled via mutation state
    }
  }, [unfinalizeMutation, runId, addToast])

  const handleCalculate = useCallback(async () => {
    setCalculating(true)
    try {
      await calculateMutation.mutateAsync(runId)
    } finally {
      setCalculating(false)
    }
  }, [calculateMutation, runId])

  const handleFinalize = useCallback(async () => {
    try {
      await finalizeMutation.mutateAsync(runId)
      addToast('Payroll run finalized successfully.', 'success')
    } catch {
      // finalizeMutation.error is rendered inline below — no duplicate toast needed
    }
  }, [finalizeMutation, runId, addToast])

  const handlePrintPayslip = useCallback(async (employeeId: number) => {
    try {
      await window.api.payroll.runs.printPayslip(runId, employeeId)
      addToast('Payslip generated and opened.', 'success')
    } catch (err) {
      addToast(`Failed to generate payslip: ${String(err)}`, 'error')
    }
  }, [runId, addToast])

  const isDraft = run?.status === 'draft'
  const isLegacyRun = run != null && run.payroll_period_id == null
  const periodLabel = run
    ? run.period_name
      ? `${run.period_name} (${run.period_start_date} – ${run.period_end_date})`
      : `${run.year}-${String(run.month).padStart(2, '0')}`
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
          <span className="flex items-center gap-2">
            <StatusBadge tone={PAYROLL_RUN_STATUS_TONE[run.status]}>
              {PAYROLL_RUN_STATUS_LABEL[run.status]}
            </StatusBadge>
            <span className="text-xs text-neutral-500">
              {PAYROLL_RUN_PAY_GROUP_LABEL[run.pay_group] ?? run.pay_group}
              {run.pay_date && ` · Pay date: ${new Date(run.pay_date).toLocaleDateString()}`}
            </span>
          </span>
        }
        actions={
          <Button variant="ghost" onClick={onBack}>← Back to Runs</Button>
        }
      />

      {/* Legacy run warning — created before payroll runs were linked to a Payroll
          Period (migration 0020); its hours may not reflect the real period range. */}
      {isLegacyRun && (
        <div className="rounded-md border border-error-600 bg-error-50 px-4 py-3 text-sm text-error-700">
          <strong>This run predates Payroll Periods linking.</strong> Its hours were computed from a
          plain calendar month, not the real payroll period date range, and could be wrong if the
          period spans two months. {isDraft
            ? 'Delete this draft and create a new one against the correct Payroll Period.'
            : 'Use "Un-finalize" below to revert it to Draft, then Recalculate.'}
          {isDraft && (
            <div className="mt-2">
              <Button variant="ghost" onClick={() => setShowConfirmDelete(true)}>
                Delete This Draft Run
              </Button>
            </div>
          )}
        </div>
      )}

      {showConfirmDelete && (
        <ConfirmDialog
          isOpen
          title="Delete Payroll Run"
          message="This will permanently delete this draft payroll run and its calculated items. This cannot be undone. Continue?"
          confirmLabel="Delete"
          tone="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowConfirmDelete(false)}
        />
      )}

      {/* Empty rate table warning — shown for draft runs only; finalization will be blocked anyway */}
      {isDraft && rateTableCheck && rateTableCheck.missing.length > 0 && (
        <div className="rounded-md border border-warning-600 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <strong>Warning:</strong> The following statutory rate tables are empty:{' '}
          <strong>{rateTableCheck.missing.join(', ')}</strong>. All deductions will compute as RM 0.00
          until you populate the rate tables under{' '}
          <span className="font-medium">Statutory Rate Tables</span>. Finalizing is blocked until this is resolved.
        </div>
      )}

      <CommissionPanel runId={runId} disabled={!isDraft} />

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
          <>
            <span className="text-sm text-neutral-500">
              This run is finalized — calculations are locked.
            </span>
            <Button
              variant="ghost"
              onClick={() => setShowConfirmUnfinalize(true)}
              isLoading={unfinalizeMutation.isPending}
            >
              Un-finalize (Revert to Draft)
            </Button>
          </>
        )}
      </div>

      {showConfirmUnfinalize && (
        <ConfirmDialog
          isOpen
          title="Un-finalize Payroll Run"
          message="This reverts the run to Draft so it can be corrected and recalculated. It does NOT automatically reverse any salary advance deductions already applied — you'll get a list of employees to manually verify under Salary Advances. Payslips already given to employees will no longer match once you recalculate. Continue?"
          confirmLabel="Un-finalize"
          tone="danger"
          onConfirm={handleUnfinalize}
          onCancel={() => setShowConfirmUnfinalize(false)}
        />
      )}

      {advancesToVerify.length > 0 && (
        <div className="rounded-md border border-warning-600 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <strong>Manual action needed:</strong> this run had salary advance deductions applied for the
          employees below. Un-finalizing did not reverse them automatically (see Payroll Run history —
          the exact advance each deduction came from isn't tracked separately). Go to{' '}
          <span className="font-medium">Payroll → Salary Advances</span> and manually add the amount
          back to the correct advance for each:
          <ul className="mt-2 list-disc pl-5">
            {advancesToVerify.map((a) => (
              <li key={a.employee_id}>{a.employee_name}: {formatCurrency(a.amount)}</li>
            ))}
          </ul>
        </div>
      )}

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
      {unfinalizeMutation.error && (
        <Card>
          <p className="text-sm text-error-700">{unfinalizeMutation.error.message}</p>
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
