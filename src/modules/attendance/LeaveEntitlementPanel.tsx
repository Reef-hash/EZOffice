// LeaveEntitlementPanel — configure how many annual/sick leave days the company
// gives (2026-07-15). Company-wide defaults live on payroll_settings (same
// singleton pattern as grace_period_minutes/device_ip); per-employee balances in
// employee_leave_entitlements remain individually overridable via upsertLeaveEntitlement.
// "Initialize" is the admin-triggered yearly rollover: it fills in a balance row for
// every active employee who doesn't already have one for the selected year, using the
// current defaults — it never overwrites an existing row (manual override or a prior
// initialize run), so re-running it is always safe.

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Card } from '@/shared/components/Card'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Table } from '@/shared/components/Table'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { useToast } from '@/shared/components/Toast'
import type { Column } from '@/shared/components/Table'
import type { PayrollSettings, LeaveEntitlementRow } from '@/shared/types/entities'
import type { UpsertLeaveEntitlementInput } from '@/shared/types/inputs'

export function LeaveEntitlementPanel() {
  const { addToast } = useToast()
  const currentYear = new Date().getFullYear()

  // ── Company-wide defaults ──────────────────────────────
  const { data: settings } = useIpcQuery<PayrollSettings>(
    ['payroll', 'settings'],
    () => window.api.payroll.settings.get(),
  )

  const [annualDefault, setAnnualDefault] = useState('14')
  const [sickDefault, setSickDefault] = useState('14')

  useEffect(() => {
    if (settings) {
      setAnnualDefault(String(settings.default_annual_leave_days))
      setSickDefault(String(settings.default_sick_leave_days))
    }
  }, [settings])

  const updateDefaultsMutation = useIpcMutation<PayrollSettings, Record<string, unknown>>(
    (data) => window.api.payroll.settings.update(data as never),
    [['payroll', 'settings']],
    { onSuccessMessage: 'Leave entitlement defaults saved' },
  )

  const handleSaveDefaults = useCallback(() => {
    updateDefaultsMutation.mutate({
      default_annual_leave_days: Number(annualDefault),
      default_sick_leave_days: Number(sickDefault),
    })
  }, [annualDefault, sickDefault, updateDefaultsMutation])

  // ── Per-employee balances for a selected year ──────────
  const [year, setYear] = useState(String(currentYear))
  const yearNum = Number(year)

  const { data: rows = [], isLoading } = useIpcQuery<LeaveEntitlementRow[]>(
    ['attendance', 'leaveEntitlements', year],
    () => window.api.attendance.listLeaveEntitlements(yearNum),
  )

  const initializeMutation = useIpcMutation<{ created: number; skipped: number }, number>(
    (y) => window.api.attendance.initializeYearlyLeaveEntitlements(y),
    [['attendance', 'leaveEntitlements']],
  )

  const handleInitialize = useCallback(async () => {
    try {
      const result = await initializeMutation.mutateAsync(yearNum)
      addToast(
        `${result.created} balance row(s) created, ${result.skipped} already existed`,
        'success',
      )
    } catch (err) {
      addToast(`Initialize failed: ${String(err)}`, 'error')
    }
  }, [yearNum, initializeMutation, addToast])

  // ── Inline per-employee override ───────────────────────
  const [editing, setEditing] = useState<{ employeeId: number; leaveType: 'annual' | 'sick'; value: string } | null>(null)

  const upsertMutation = useIpcMutation<unknown, UpsertLeaveEntitlementInput>(
    (data) => window.api.attendance.upsertLeaveEntitlement(data),
    [['attendance', 'leaveEntitlements']],
  )

  const handleStartEdit = useCallback(
    (employeeId: number, leaveType: 'annual' | 'sick', currentValue: number | null) => {
      setEditing({ employeeId, leaveType, value: currentValue !== null ? String(currentValue) : '0' })
    },
    [],
  )

  const handleSaveEdit = useCallback(async () => {
    if (!editing) return
    try {
      await upsertMutation.mutateAsync({
        employee_id: editing.employeeId,
        leave_type: editing.leaveType,
        year: yearNum,
        balance: Number(editing.value),
      })
      setEditing(null)
    } catch (err) {
      addToast(`Failed to save balance: ${String(err)}`, 'error')
    }
  }, [editing, yearNum, upsertMutation, addToast])

  const columns: Column<LeaveEntitlementRow>[] = useMemo(
    () => [
      { key: 'employee_name', header: 'Employee', accessor: (r) => r.employee_name, sortable: true, sortValue: (r) => r.employee_name },
      {
        key: 'annual_balance',
        header: 'Annual Leave (days)',
        align: 'center',
        width: '200px',
        accessor: (r) =>
          editing?.employeeId === r.employee_id && editing.leaveType === 'annual' ? (
            <div className="flex items-center justify-center gap-2">
              <input
                type="number"
                min="0"
                step="0.5"
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                className="h-8 w-20 rounded-sm border border-neutral-300 px-2 text-sm"
              />
              <Button size="sm" isLoading={upsertMutation.isPending} onClick={handleSaveEdit}>Save</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleStartEdit(r.employee_id, 'annual', r.annual_balance)}
              className="text-sm text-primary-700 hover:underline"
            >
              {r.annual_balance !== null ? r.annual_balance : '— (not set)'}
            </button>
          ),
      },
      {
        key: 'sick_balance',
        header: 'Sick Leave / MC (days)',
        align: 'center',
        width: '200px',
        accessor: (r) =>
          editing?.employeeId === r.employee_id && editing.leaveType === 'sick' ? (
            <div className="flex items-center justify-center gap-2">
              <input
                type="number"
                min="0"
                step="0.5"
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                className="h-8 w-20 rounded-sm border border-neutral-300 px-2 text-sm"
              />
              <Button size="sm" isLoading={upsertMutation.isPending} onClick={handleSaveEdit}>Save</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleStartEdit(r.employee_id, 'sick', r.sick_balance)}
              className="text-sm text-primary-700 hover:underline"
            >
              {r.sick_balance !== null ? r.sick_balance : '— (not set)'}
            </button>
          ),
      },
    ],
    [editing, upsertMutation.isPending, handleSaveEdit, handleStartEdit],
  )

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Leave Entitlement Defaults"
        subtitle="How many days of annual leave and sick leave (MC) the company gives each employee per year."
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-48">
            <Input
              label="Annual Leave (days/year)"
              type="number"
              min="0"
              step="0.5"
              value={annualDefault}
              onChange={(e) => setAnnualDefault(e.target.value)}
            />
          </div>
          <div className="w-48">
            <Input
              label="Sick Leave / MC (days/year)"
              type="number"
              min="0"
              step="0.5"
              value={sickDefault}
              onChange={(e) => setSickDefault(e.target.value)}
            />
          </div>
          <Button isLoading={updateDefaultsMutation.isPending} onClick={handleSaveDefaults}>
            Save Defaults
          </Button>
        </div>
      </Card>

      <Card
        title="Employee Leave Balances"
        subtitle="Balances are per calendar year. Click a value to override an individual employee."
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Input label="Year" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <Button
            variant="secondary"
            isLoading={initializeMutation.isPending}
            onClick={handleInitialize}
          >
            Initialize {year} Balances
          </Button>
          <span className="text-sm text-neutral-500">
            Applies the defaults above to every employee who doesn't already have a {year} balance.
          </span>
        </div>

        <Table
          columns={columns}
          data={rows}
          rowKey={(r) => String(r.employee_id)}
          isLoading={isLoading}
          emptyState={{
            title: 'No active employees',
            description: 'Add employees in Master Data first.',
          }}
        />
      </Card>
    </div>
  )
}
