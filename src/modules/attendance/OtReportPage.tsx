// OtReportPage — per-employee, per-day overtime breakdown for one payroll period.
//
// Built 2026-08-27: the client could see a large OT total on a payroll run but had no
// way to ask "which day, and why". Each day shows CLOCKED hours next to the shift's
// STANDARD hours, because that pair is what distinguishes real overtime from a
// misconfigured shift, and the latter is what caused their inflated bill.

import { Fragment, useState, useCallback } from 'react'
import { Select } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Card } from '@/shared/components/Card'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useIpcQuery } from '@/shared/hooks/useIpcQuery'
import { useToast } from '@/shared/components/Toast'
import type { OtReport, OtReportDay, PayrollPeriod } from '@/shared/types/entities'

function formatHours(h: number): string {
  return h.toFixed(2).replace(/\.00$/, '')
}

function timeOnly(iso: string | null): string {
  return iso ? iso.slice(11, 16) : '—'
}

/**
 * Flags a day whose overtime came from the shift threshold rather than genuinely long
 * hours. If someone clocked no more than a normal working day yet still accrued OT,
 * the shift's Standard Hours is set below what the clock shows — the exact
 * misconfiguration behind the 2026-08-27 incident.
 */
function isSuspectDay(day: OtReportDay): boolean {
  if (day.standard_hours == null) return false
  if (day.calendar_type !== 'working_day' && day.calendar_type !== 'company_event') return false
  return day.ot_hours > 0 && day.total_clocked_hours <= day.standard_hours + 1
}

export function OtReportPage() {
  const { addToast } = useToast()
  const [periodId, setPeriodId] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)

  const { data: periods = [] } = useIpcQuery<PayrollPeriod[]>(
    ['payroll', 'periods'],
    () => window.api.payroll.periods.list(),
  )

  // Only processed periods have daily records to report on.
  const options = periods
    .filter((p) => p.status !== 'open')
    .map((p) => ({ value: String(p.id), label: `${p.name} (${p.start_date} – ${p.end_date})` }))

  const { data: report, isLoading } = useIpcQuery<OtReport | null>(
    ['attendance', 'otReport', periodId],
    () => (periodId ? window.api.attendance.getOtReport(Number(periodId)) : Promise.resolve(null)),
    { enabled: periodId !== '' },
  )

  const handleExport = useCallback(async () => {
    if (!periodId) return
    setExporting(true)
    try {
      await window.api.attendance.exportOtReport(Number(periodId))
      addToast('OT report exported and opened.', 'success')
    } catch (err) {
      addToast(`Failed to export OT report: ${String(err)}`, 'error')
    } finally {
      setExporting(false)
    }
  }, [periodId, addToast])

  const suspectCount = report
    ? report.rows.reduce((n, r) => n + r.days.filter(isSuspectDay).length, 0)
    : 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <div className="w-96">
          <Select
            label="Payroll Period"
            value={periodId}
            onChange={(e) => { setPeriodId(e.target.value); setExpanded(null) }}
            options={[{ value: '', label: 'Select a period…' }, ...options]}
          />
        </div>
        {report && report.rows.length > 0 && (
          <Button variant="secondary" onClick={handleExport} isLoading={exporting}>
            Export to Excel
          </Button>
        )}
      </div>

      {options.length === 0 && (
        <p className="text-sm text-neutral-500">
          No processed payroll periods yet. Process a period under Payroll → Payroll Periods first.
        </p>
      )}

      {periodId && isLoading && <p className="text-sm text-neutral-500">Loading OT report…</p>}

      {report && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase text-neutral-500">Total OT Hours</p>
              <p className="text-2xl font-bold text-neutral-800 dark:text-white">
                {formatHours(report.grand_total_ot_hours)}
              </p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase text-neutral-500">Total OT Pay</p>
              <p className="text-2xl font-bold text-neutral-800 dark:text-white">
                {report.grand_total_ot_pay == null
                  ? '—'
                  : `RM ${report.grand_total_ot_pay.toFixed(2)}`}
              </p>
              {report.grand_total_ot_pay == null && (
                <p className="mt-0.5 text-xs text-neutral-500">No payroll run calculated yet.</p>
              )}
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase text-neutral-500">Employees with OT</p>
              <p className="text-2xl font-bold text-neutral-800 dark:text-white">
                {report.rows.filter((r) => r.days_with_ot > 0).length}
              </p>
            </div>
          </div>

          {suspectCount > 0 && (
            <div className="rounded-md border border-warning-600 bg-warning-50 px-4 py-3 text-sm text-warning-700">
              <strong>{suspectCount} day(s) look like configuration overtime, not real overtime.</strong>{' '}
              On those days the employee clocked no more than a normal working day, yet still
              accrued OT — which happens when a shift&apos;s Standard Hours is set lower than the
              hours the clock actually records. Check Attendance → Shifts. Affected rows are
              highlighted below.
            </div>
          )}

          {report.rows.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No attendance records in this period. Process the period first.
            </p>
          ) : (
            <Card
              title="Overtime by Employee"
              subtitle="Click an employee to see the day-by-day breakdown."
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-neutral-500">
                    <th className="pb-2 pr-2">Employee</th>
                    <th className="pb-2 pr-2 text-right">Days w/ OT</th>
                    <th className="pb-2 pr-2 text-right">OT Hrs</th>
                    <th className="pb-2 pr-2 text-right">Rest Day OT</th>
                    <th className="pb-2 pr-2 text-right">Holiday OT</th>
                    <th className="pb-2 pr-2 text-right">OT Pay</th>
                    <th className="pb-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => {
                    const isOpen = expanded === row.employee_id
                    const rowSuspect = row.days.some(isSuspectDay)
                    return (
                      <Fragment key={row.employee_id}>
                        <tr
                          className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50"
                          onClick={() => setExpanded(isOpen ? null : row.employee_id)}
                        >
                          <td className="py-2 pr-2 font-medium">
                            {row.employee_name}
                            {rowSuspect && (
                              <span className="ml-2">
                                <StatusBadge tone="warning">check shift</StatusBadge>
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right">{row.days_with_ot || '—'}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">
                            {row.total_ot_hours > 0 ? formatHours(row.total_ot_hours) : '—'}
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums">
                            {row.total_rest_day_ot_hours > 0 ? formatHours(row.total_rest_day_ot_hours) : '—'}
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums">
                            {row.total_holiday_ot_hours > 0 ? formatHours(row.total_holiday_ot_hours) : '—'}
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums">
                            {row.ot_pay == null ? '—' : `RM ${row.ot_pay.toFixed(2)}`}
                          </td>
                          <td className="py-2 text-neutral-400">{isOpen ? '▾' : '▸'}</td>
                        </tr>

                        {isOpen && (
                          <tr>
                            <td colSpan={7} className="bg-neutral-50 px-4 py-3">
                              {row.days.length === 0 ? (
                                <p className="text-sm text-neutral-500">
                                  No overtime recorded for this employee in this period.
                                </p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-neutral-200 text-left text-neutral-500">
                                      <th className="pb-1 pr-2">Date</th>
                                      <th className="pb-1 pr-2">Day Type</th>
                                      <th className="pb-1 pr-2">In</th>
                                      <th className="pb-1 pr-2">Out</th>
                                      <th className="pb-1 pr-2 text-right">Clocked</th>
                                      <th className="pb-1 pr-2 text-right">Standard</th>
                                      <th className="pb-1 pr-2 text-right">OT</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.days.map((day) => {
                                      const suspect = isSuspectDay(day)
                                      const dayOt = day.ot_hours + day.rest_day_ot_hours + day.holiday_ot_hours
                                      return (
                                        <tr
                                          key={day.date}
                                          className={`border-b border-neutral-100 ${suspect ? 'bg-warning-50' : ''}`}
                                        >
                                          <td className="py-1 pr-2">{day.date}</td>
                                          <td className="py-1 pr-2 text-neutral-500">{day.calendar_type}</td>
                                          <td className="py-1 pr-2 tabular-nums">{timeOnly(day.first_in)}</td>
                                          <td className="py-1 pr-2 tabular-nums">{timeOnly(day.last_out)}</td>
                                          <td className="py-1 pr-2 text-right tabular-nums">
                                            {formatHours(day.total_clocked_hours)}
                                          </td>
                                          <td className="py-1 pr-2 text-right tabular-nums text-neutral-500">
                                            {day.standard_hours == null ? '—' : formatHours(day.standard_hours)}
                                          </td>
                                          <td className={`py-1 pr-2 text-right tabular-nums font-medium ${suspect ? 'text-warning-700' : ''}`}>
                                            {formatHours(dayOt)}
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
