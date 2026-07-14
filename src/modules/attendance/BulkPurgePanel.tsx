// BulkPurgePanel — admin escape hatch to permanently delete attendance_logs
// in a date range, scoped to manual/device/all source. For correcting bad
// device syncs or clearing test data. Respects the same closed-payroll-period
// lock as single-row edit/delete (guardClosedPeriodRange in the service layer)
// — this is not a way around that rule, just a bulk version of the same delete.

import { useState, useCallback } from 'react'
import { Button } from '@/shared/components/Button'
import { Select } from '@/shared/components/Input'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { useToast } from '@/shared/components/Toast'
import { useQueryClient } from '@tanstack/react-query'
import type { PurgeAttendanceLogsInput, AttendanceLogPurgeSource } from '@/shared/types/inputs'

const SOURCE_OPTIONS: Array<{ value: AttendanceLogPurgeSource; label: string }> = [
  { value: 'all', label: 'All sources (manual + device)' },
  { value: 'manual', label: 'Manual only' },
  { value: 'device', label: 'Device only' },
]

export function BulkPurgePanel() {
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [source, setSource] = useState<AttendanceLogPurgeSource>('all')
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const countMutation = useIpcMutation<{ count: number }, PurgeAttendanceLogsInput>(
    (data) => window.api.attendance.countLogsForPurge(data),
    [],
  )

  const purgeMutation = useIpcMutation<{ deleted: number }, PurgeAttendanceLogsInput>(
    (data) => window.api.attendance.purgeLogs(data),
    [['attendance', 'list']],
  )

  const resetPreview = useCallback(() => setPreviewCount(null), [])

  const handlePreview = useCallback(async () => {
    if (dateFrom > dateTo) {
      addToast('Start date must not be after end date', 'error')
      return
    }
    try {
      const result = await countMutation.mutateAsync({ dateFrom, dateTo, source })
      setPreviewCount(result.count)
    } catch {
      // Handled by useIpcMutation's global onError toast
    }
  }, [dateFrom, dateTo, source, countMutation, addToast])

  const handleConfirmPurge = useCallback(async () => {
    try {
      const result = await purgeMutation.mutateAsync({ dateFrom, dateTo, source })
      setShowConfirm(false)
      setPreviewCount(null)
      // Watermark may have been reset (source !== 'manual') — device settings
      // reads it via a separate query key, refresh it too.
      await queryClient.invalidateQueries({ queryKey: ['payroll', 'settings'] })
      addToast(`${result.deleted} log(s) permanently deleted`, 'success')
    } catch {
      setShowConfirm(false)
      // Handled by useIpcMutation's global onError toast
    }
  }, [dateFrom, dateTo, source, purgeMutation, queryClient, addToast])

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="text-sm font-medium text-neutral-500 hover:text-neutral-800"
      >
        {isOpen ? '▾' : '▸'} Advanced: Bulk delete / reset logs
      </button>

      {isOpen && (
        <div className="mt-3 rounded-md border border-error-200 bg-error-50 p-4">
          <h3 className="mb-1 text-sm font-semibold text-error-800">Bulk delete attendance logs</h3>
          <p className="mb-3 text-sm text-error-700">
            Permanently deletes logs in the selected range. This cannot be undone. Logs within a
            closed payroll period are protected — re-open the period first if you need to touch those.
            Deleting device logs resets the sync watermark so the next sync re-pulls the range.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); resetPreview() }}
                className="h-9 rounded-sm border border-neutral-300 px-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-700/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); resetPreview() }}
                className="h-9 rounded-sm border border-neutral-300 px-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-700/40"
              />
            </div>
            <div className="min-w-[220px]">
              <Select
                label="Source"
                value={source}
                onChange={(e) => { setSource(e.target.value as AttendanceLogPurgeSource); resetPreview() }}
                options={SOURCE_OPTIONS}
              />
            </div>

            <Button
              variant="secondary"
              size="sm"
              isLoading={countMutation.isPending}
              onClick={handlePreview}
            >
              Preview
            </Button>

            <Button
              variant="danger"
              size="sm"
              disabled={previewCount === null || previewCount === 0}
              onClick={() => setShowConfirm(true)}
            >
              Delete Permanently
            </Button>
          </div>

          {previewCount !== null && (
            <p className="mt-3 text-sm font-medium text-error-800">
              {previewCount === 0
                ? 'No logs match this range and source.'
                : `${previewCount} log(s) match — click "Delete Permanently" to remove them.`}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={showConfirm}
        title="Delete Attendance Logs"
        message={`Permanently delete ${previewCount ?? 0} log(s) from ${dateFrom} to ${dateTo} (${SOURCE_OPTIONS.find((o) => o.value === source)?.label})? This cannot be undone.`}
        confirmLabel="Delete Permanently"
        tone="danger"
        onConfirm={handleConfirmPurge}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}
