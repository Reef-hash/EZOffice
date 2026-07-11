import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Modal } from '@/shared/components/Modal'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { Column } from '@/shared/components/Table'
import type { PayrollPeriod, PayrollPeriodStatus, ProcessingRun, DailyAttendanceRecord } from '@/shared/types/entities'
import type { CreatePayrollPeriodInput, UpdatePayrollPeriodStatusInput } from '@/shared/types/inputs'
import { PAYROLL_PERIOD_STATUS } from '@/shared/types/entities'

const STATUS_LABEL: Record<PayrollPeriodStatus, string> = {
  [PAYROLL_PERIOD_STATUS.OPEN]: 'Open',
  [PAYROLL_PERIOD_STATUS.PROCESSING]: 'Processing',
  [PAYROLL_PERIOD_STATUS.FINALIZED]: 'Finalized',
  [PAYROLL_PERIOD_STATUS.CLOSED]: 'Closed',
}

const STATUS_TONE: Record<PayrollPeriodStatus, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  [PAYROLL_PERIOD_STATUS.OPEN]: 'info',
  [PAYROLL_PERIOD_STATUS.PROCESSING]: 'warning',
  [PAYROLL_PERIOD_STATUS.FINALIZED]: 'success',
  [PAYROLL_PERIOD_STATUS.CLOSED]: 'neutral',
}

const columns: Column<PayrollPeriod>[] = [
  { key: 'name', header: 'Period', accessor: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: 'start_date', header: 'Start', accessor: (r) => r.start_date, sortable: true, sortValue: (r) => r.start_date },
  { key: 'end_date', header: 'End', accessor: (r) => r.end_date, sortable: true, sortValue: (r) => r.end_date },
  {
    key: 'status',
    header: 'Status',
    accessor: (r) => (
      <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
    ),
    sortable: true,
    sortValue: (r) => r.status,
    align: 'center',
  },
]

const TRANSITIONS: Record<PayrollPeriodStatus, PayrollPeriodStatus | null> = {
  open: 'processing',
  processing: 'finalized',
  finalized: 'closed',
  closed: null,
}

const TRANSITION_LABELS: Record<string, string> = {
  open_processing: 'Start Processing',
  processing_finalized: 'Finalize',
  finalized_closed: 'Close',
}

export function PayrollPeriodListPage() {
  const [showCreate, setShowCreate] = useState(false)
  const [showConfirmTransition, setShowConfirmTransition] = useState<PayrollPeriod | null>(null)
  const [showConfirmReopen, setShowConfirmReopen] = useState<PayrollPeriod | null>(null)
  const [showConfirmDelete, setShowConfirmDelete] = useState<PayrollPeriod | null>(null)
  const [periodName, setPeriodName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [processingPeriodId, setProcessingPeriodId] = useState<number | null>(null)
  const [viewRunsPeriodId, setViewRunsPeriodId] = useState<number | null>(null)
  const [viewRecordsPeriodId, setViewRecordsPeriodId] = useState<number | null>(null)

  const { data: periods = [], isLoading } = useIpcQuery<PayrollPeriod[]>(
    ['payroll', 'periods'],
    () => window.api.payroll.periods.list(),
  )

  const { data: processingRuns = [] } = useIpcQuery<ProcessingRun[]>(
    ['processing', 'runs', String(viewRunsPeriodId ?? 0)],
    () => viewRunsPeriodId ? window.api.attendance.listProcessingRuns(viewRunsPeriodId) : Promise.resolve([]),
    { enabled: viewRunsPeriodId !== null },
  )

  const { data: dailyRecords = [] } = useIpcQuery<DailyAttendanceRecord[]>(
    ['daily-records', String(viewRecordsPeriodId ?? 0)],
    () => viewRecordsPeriodId ? window.api.attendance.getDailyRecordsByPeriod(viewRecordsPeriodId) : Promise.resolve([]),
    { enabled: viewRecordsPeriodId !== null },
  )

  const createMutation = useIpcMutation<PayrollPeriod, CreatePayrollPeriodInput>(
    (data) => window.api.payroll.periods.create(data),
    [['payroll', 'periods']],
    { onSuccessMessage: 'Payroll period created' },
  )

  const updateStatusMutation = useIpcMutation<PayrollPeriod, { id: number; data: UpdatePayrollPeriodStatusInput }>(
    ({ id, data }) => window.api.payroll.periods.updateStatus(id, data),
    [['payroll', 'periods']],
  )

  const reopenMutation = useIpcMutation<PayrollPeriod, number>(
    (id) => window.api.payroll.periods.reopen(id),
    [['payroll', 'periods']],
    { onSuccessMessage: 'Payroll period reopened' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.payroll.periods.delete(id),
    [['payroll', 'periods']],
    { onSuccessMessage: 'Payroll period deleted' },
  )

  const processMutation = useIpcMutation<ProcessingRun, { payroll_period_id: number }>(
    (data) => window.api.attendance.triggerProcessing(data),
    [['payroll', 'periods'], ['processing', 'runs', String(processingPeriodId ?? 0)]],
    { onSuccessMessage: 'Attendance processed successfully' },
  )

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!periodName.trim() || !startDate || !endDate) return
    createMutation.mutate({ name: periodName.trim(), start_date: startDate, end_date: endDate })
    setShowCreate(false)
    setPeriodName('')
    setStartDate('')
    setEndDate('')
  }

  async function handleProcessClick(period: PayrollPeriod) {
    setProcessingPeriodId(period.id)
    // Transition to 'processing' first, then run the processor
    updateStatusMutation.mutate(
      { id: period.id, data: { status: 'processing' } },
      {
        onSuccess: () => {
          processMutation.mutate({ payroll_period_id: period.id })
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          Payroll periods define date ranges for grouping attendance and payroll calculations.
        </p>
        <Button onClick={() => setShowCreate(true)}>Add Period</Button>
      </div>

      <Table
        columns={columns}
        data={periods}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{ title: 'No payroll periods yet', description: 'Create your first payroll period to begin processing.' }}
      />

      {/* Action cards per period */}
      <div className="flex flex-col gap-3">
        {periods.map((period) => {
          const next = TRANSITIONS[period.status]
          return (
            <div key={period.id} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-neutral-900">{period.name}</p>
                <p className="text-xs text-neutral-500">
                  {period.start_date} → {period.end_date}
                </p>
              </div>
              <StatusBadge tone={STATUS_TONE[period.status]}>{STATUS_LABEL[period.status]}</StatusBadge>

              {period.status === 'open' && (
                <Button size="sm" onClick={() => handleProcessClick(period)} isLoading={processMutation.isPending && processingPeriodId === period.id}>
                  Process Attendance
                </Button>
              )}

              {next && period.status !== 'open' && (
                <Button
                  size="sm"
                  onClick={() => setShowConfirmTransition(period)}
                  isLoading={updateStatusMutation.isPending && showConfirmTransition?.id === period.id}
                >
                  {TRANSITION_LABELS[`${period.status}_${next}`] || `Advance`}
                </Button>
              )}

              {(period.status === 'finalized' || period.status === 'closed') && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowConfirmReopen(period)}
                  isLoading={reopenMutation.isPending && showConfirmReopen?.id === period.id}
                >
                  Re-open
                </Button>
              )}

              {period.status === 'open' && (
                <Button size="sm" variant="danger" onClick={() => setShowConfirmDelete(period)}>
                  Delete
                </Button>
              )}

              <Button
                size="sm"
                variant="secondary"
                onClick={() => setViewRunsPeriodId(viewRunsPeriodId === period.id ? null : period.id)}
              >
                {viewRunsPeriodId === period.id ? 'Hide Runs' : 'View Runs'}
              </Button>
              {period.status !== 'open' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setViewRecordsPeriodId(viewRecordsPeriodId === period.id ? null : period.id)}
                >
                  {viewRecordsPeriodId === period.id ? 'Hide Records' : 'View Records'}
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {/* Daily Records */}
      {viewRecordsPeriodId && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-semibold text-neutral-900">Daily Attendance Records</h4>
          {dailyRecords.length === 0 ? (
            <p className="text-sm text-neutral-400">No processed records found. Run processing first.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-neutral-500">
                    <th className="pb-1 pr-2">Date</th>
                    <th className="pb-1 pr-2">Employee</th>
                    <th className="pb-1 pr-2">Status</th>
                    <th className="pb-1 pr-2 text-right">Hours</th>
                    <th className="pb-1 pr-2 text-right">Regular</th>
                    <th className="pb-1 pr-2 text-right">OT</th>
                    <th className="pb-1 pr-2 text-right">Late</th>
                    <th className="pb-1">Calendar</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRecords.map((r) => (
                    <tr key={r.id} className="border-b border-neutral-100">
                      <td className="py-1 pr-2 text-neutral-500">{r.date}</td>
                      <td className="py-1 pr-2 font-medium">{(r as unknown as { employee_name?: string }).employee_name ?? r.employee_id}</td>
                      <td className="py-1 pr-2">
                        <StatusBadge tone={
                          r.attendance_status === 'present' ? 'success'
                          : r.attendance_status === 'late' ? 'warning'
                          : r.attendance_status === 'absent' ? 'error'
                          : r.attendance_status === 'on_leave' ? 'info'
                          : r.attendance_status === 'holiday' ? 'info'
                          : r.attendance_status === 'weekly_off' ? 'neutral'
                          : 'neutral'
                        }>{r.attendance_status}</StatusBadge>
                      </td>
                      <td className="py-1 pr-2 text-right">{r.total_clocked_hours}</td>
                      <td className="py-1 pr-2 text-right">{r.regular_hours}</td>
                      <td className="py-1 pr-2 text-right">{r.ot_hours}</td>
                      <td className="py-1 pr-2 text-right">{r.minutes_late || '—'}</td>
                      <td className="py-1">{r.calendar_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Processing runs detail */}
      {viewRunsPeriodId && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-semibold text-neutral-900">Processing Runs</h4>
          {processingRuns.length === 0 ? (
            <p className="text-sm text-neutral-400">No processing runs yet for this period.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {processingRuns.map((run) => (
                <div key={run.id} className="flex items-center gap-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm">
                  <StatusBadge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : 'warning'}>
                    {run.status}
                  </StatusBadge>
                  <span className="text-neutral-600">
                    {run.total_employees} employees, {run.total_days} days
                  </span>
                  <span className="text-neutral-400 text-xs">{run.started_at}</span>
                  {run.error_message && (
                    <span className="text-error-600 text-xs truncate max-w-[300px]">{run.error_message}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Period Modal */}
      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Payroll Period"
        size="md"
        footer={
          <>
            <div className="flex-1" />
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button isLoading={createMutation.isPending} onClick={handleCreate}>Create</Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <Input
            label="Period Name"
            required
            value={periodName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPeriodName(e.target.value)}
            placeholder="e.g. July 2026 Payroll"
          />
          <div className="flex gap-4">
            <Input label="Start Date" required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input label="End Date" required type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </form>
      </Modal>

      {/* Confirm Status Transition */}
      {showConfirmTransition && (
        <ConfirmDialog
          isOpen
          title={`Advance to ${STATUS_LABEL[TRANSITIONS[showConfirmTransition.status]!]}`}
          message={`Advance "${showConfirmTransition.name}" from '${STATUS_LABEL[showConfirmTransition.status]}' to '${STATUS_LABEL[TRANSITIONS[showConfirmTransition.status]!]}'?`}
          confirmLabel={TRANSITION_LABELS[`${showConfirmTransition.status}_${TRANSITIONS[showConfirmTransition.status]!}`] || 'Advance'}
          tone="primary"
          onConfirm={() => {
            const next = TRANSITIONS[showConfirmTransition.status]
            if (next) {
              updateStatusMutation.mutate({ id: showConfirmTransition.id, data: { status: next } })
            }
            setShowConfirmTransition(null)
          }}
          onCancel={() => setShowConfirmTransition(null)}
        />
      )}

      {/* Confirm Re-open */}
      {showConfirmReopen && (
        <ConfirmDialog
          isOpen
          title="Re-open Payroll Period"
          message={`Re-opening "${showConfirmReopen.name}" will unfinalize all daily records and allow attendance edits. Payroll data for this period should be re-verified after re-opening. Continue?`}
          confirmLabel="Re-open"
          tone="primary"
          onConfirm={() => {
            reopenMutation.mutate(showConfirmReopen.id)
            setShowConfirmReopen(null)
          }}
          onCancel={() => setShowConfirmReopen(null)}
        />
      )}

      {/* Confirm Delete */}
      {showConfirmDelete && (
        <ConfirmDialog
          isOpen
          title="Delete Payroll Period"
          message={`Delete "${showConfirmDelete.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => { deleteMutation.mutate(showConfirmDelete.id); setShowConfirmDelete(null) }}
          onCancel={() => setShowConfirmDelete(null)}
        />
      )}
    </div>
  )
}
