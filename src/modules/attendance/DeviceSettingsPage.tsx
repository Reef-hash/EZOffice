// Device settings for fingerprint reader sync (ZKTeco V1000/K40 Pro integration).
// Stores device IP/port in payroll_settings table and provides sync trigger.
//
// H3/H4/M5 (docs/DEVICE_SYNC_AUDIT.md): Test Connection now actually contacts the
// device (deviceName/serial/user+log counts, clock drift warning + fix action);
// device user mapping panel below lets the admin match device users to employees;
// Last Sync reads the persisted device_sync_log row so it survives a tab switch.

import { useState, useCallback, useEffect } from 'react'
import type { ChangeEvent } from 'react'
import { Card } from '@/shared/components/Card'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useIpcMutation, useIpcQuery } from '@/shared/hooks/useIpcQuery'
import { useToast } from '@/shared/components/Toast'
import { DeviceUserMappingPanel } from './DeviceUserMappingPanel'
import type { PayrollSettings, DeviceTestResult, DeviceSyncLog } from '@/shared/types/entities'
import type { SyncFromDeviceInput } from '@/shared/types/inputs'

interface SyncResult {
  inserted: number
  skipped: number
  errors: string[]
}

function formatLocal(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function DeviceSettingsPage() {
  const { addToast } = useToast()
  const [deviceIp, setDeviceIp] = useState('')
  const [devicePort, setDevicePort] = useState('4370')
  const [isSaving, setIsSaving] = useState(false)
  const [syncErrors, setSyncErrors] = useState<string[] | null>(null)
  const [testResult, setTestResult] = useState<DeviceTestResult | null>(null)
  const [syncFromDate, setSyncFromDate] = useState('')

  // Fetch current settings on load
  const { data: settings } = useIpcQuery<PayrollSettings>(
    ['payroll', 'settings'],
    () => window.api.payroll.settings.get(),
  )

  // Persisted last-sync result (H4) — survives a tab switch/reload, unlike local state.
  const { data: lastSyncLog, refetch: refetchLastSyncLog } = useIpcQuery<DeviceSyncLog | null>(
    ['attendance', 'lastSyncLog'],
    () => window.api.attendance.getLastSyncLog(),
  )

  // Populate form when settings load
  useEffect(() => {
    if (settings) {
      setDeviceIp(settings.device_ip || '')
      setDevicePort(String(settings.device_port || 4370))
    }
  }, [settings])

  const syncMutation = useIpcMutation<SyncResult, SyncFromDeviceInput>(
    (data) => window.api.attendance.syncFromDevice(data),
    [],
  )

  const updateSettingsMutation = useIpcMutation<PayrollSettings, Record<string, unknown>>(
    (data) => window.api.payroll.settings.update(data as never),
    [['payroll', 'settings']],
  )

  const testConnectionMutation = useIpcMutation<DeviceTestResult, void>(
    () => window.api.attendance.testDevice(),
    [],
  )

  const setDeviceTimeMutation = useIpcMutation<{ ok: boolean; error?: string }, void>(
    () => window.api.attendance.setDeviceTime(),
    [],
  )

  const handleSync = useCallback(async () => {
    try {
      setSyncErrors(null)
      const result = await syncMutation.mutateAsync(
        syncFromDate ? { syncFrom: syncFromDate } : {},
      )
      await refetchLastSyncLog()
      if (result.errors.length > 0) {
        setSyncErrors(result.errors)
        addToast(
          `${result.inserted} inserted, ${result.skipped} skipped — ${result.errors.length} error(s)`,
          'warning',
        )
      } else {
        addToast(
          `Sync complete: ${result.inserted} inserted, ${result.skipped} skipped`,
          'success',
        )
      }
    } catch (err) {
      addToast(`Sync failed: ${String(err)}`, 'error')
    }
  }, [syncMutation, addToast, refetchLastSyncLog, syncFromDate])

  const handleSaveSettings = useCallback(async () => {
    if (!deviceIp) {
      addToast('Please enter a device IP address', 'error')
      return
    }
    try {
      setIsSaving(true)
      await updateSettingsMutation.mutateAsync({
        device_ip: deviceIp,
        device_port: parseInt(devicePort, 10),
      })
      addToast('Device settings saved successfully', 'success')
    } catch (err) {
      addToast(`Failed to save settings: ${String(err)}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [deviceIp, devicePort, updateSettingsMutation, addToast])

  const handleTestConnection = useCallback(async () => {
    if (!deviceIp) {
      addToast('Please enter and save a device IP address first.', 'error')
      return
    }
    try {
      const result = await testConnectionMutation.mutateAsync()
      setTestResult(result)
      addToast(result.ok ? 'Device connected successfully' : `Connection failed: ${result.error}`, result.ok ? 'success' : 'error')
    } catch (err) {
      addToast(`Test connection failed: ${String(err)}`, 'error')
    }
  }, [deviceIp, testConnectionMutation, addToast])

  const handleSetDeviceTime = useCallback(async () => {
    if (!confirm('This will set the device clock to match this PC\'s current time. Continue?')) return
    try {
      const result = await setDeviceTimeMutation.mutateAsync()
      if (result.ok) {
        addToast('Device clock updated', 'success')
        // Re-test so the drift warning clears once the clock is fixed.
        const refreshed = await testConnectionMutation.mutateAsync()
        setTestResult(refreshed)
      } else {
        addToast(`Failed to set device time: ${result.error}`, 'error')
      }
    } catch (err) {
      addToast(`Failed to set device time: ${String(err)}`, 'error')
    }
  }, [setDeviceTimeMutation, testConnectionMutation, addToast])

  return (
    <div className="max-w-2xl">
      <Card>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-neutral-900">Device Configuration</h3>
          <p className="mt-1 text-sm text-neutral-600">
            Configure your ZKTeco fingerprint reader connection settings.
          </p>
        </div>

        <div className="space-y-4 rounded-sm border border-neutral-200 bg-neutral-50 p-4">
          <div>
            <Input
              label="Device IP Address"
              type="text"
              value={deviceIp}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDeviceIp(e.target.value)}
              placeholder="e.g., 192.168.1.100"
              helperText="IP address or hostname of the fingerprint reader"
            />
          </div>

          <div>
            <Input
              label="Device Port"
              type="number"
              value={devicePort}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDevicePort(e.target.value)}
              placeholder="4370"
              helperText="Default ZKTeco port: 4370"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleTestConnection}
              disabled={testConnectionMutation.isPending}
              isLoading={testConnectionMutation.isPending}
            >
              Test Connection
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleSaveSettings}
              disabled={isSaving}
              isLoading={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>

          {testResult && (
            <div
              className={`rounded-sm border p-3 text-sm ${
                testResult.ok ? 'border-success-200 bg-success-50 text-success-700' : 'border-error-200 bg-error-50 text-error-700'
              }`}
            >
              {testResult.ok ? (
                <div className="space-y-1">
                  <p className="font-semibold">Connected</p>
                  <p>Device: {testResult.deviceName ?? 'Unknown'} (S/N {testResult.serial ?? 'Unknown'})</p>
                  <p>
                    {testResult.userCount ?? '?'} user(s) enrolled, {testResult.logCount ?? '?'} log(s) stored
                  </p>
                </div>
              ) : (
                <p>{testResult.error}</p>
              )}

              {testResult.clockDriftWarning && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-sm bg-warning-50 p-2 text-warning-700">
                  <span className="text-xs">{testResult.clockDriftWarning}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleSetDeviceTime}
                    isLoading={setDeviceTimeMutation.isPending}
                  >
                    Set Device Time
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <DeviceUserMappingPanel />
      </Card>

      <Card className="mt-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-neutral-900">Sync from Device</h3>
          <p className="mt-1 text-sm text-neutral-600">
            Fetch latest attendance records from the fingerprint reader and merge into the system.
          </p>
        </div>

        <div className="space-y-3">
          {lastSyncLog && (
            <p className="text-sm text-neutral-600">
              Last sync: <span className="font-medium">{formatLocal(lastSyncLog.started_at)}</span>
              {' — '}
              {lastSyncLog.inserted} inserted, {lastSyncLog.skipped} skipped
              {lastSyncLog.errors_json && (
                <StatusBadge tone="warning" className="ml-2">Had errors</StatusBadge>
              )}
            </p>
          )}

          <div className="max-w-xs">
            <Input
              label="Sync from (optional)"
              type="date"
              value={syncFromDate}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSyncFromDate(e.target.value)}
              helperText="Leave blank to continue from the last sync. Set a date to pull logs from that date forward for this run only."
            />
          </div>

          <Button
            variant="dark"
            disabled={!deviceIp || syncMutation.isPending}
            isLoading={syncMutation.isPending}
            onClick={handleSync}
          >
            {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
          </Button>

          {syncErrors && syncErrors.length > 0 && (
            <div className="mt-4 rounded-sm border border-error-200 bg-error-50 p-3">
              <p className="mb-2 text-sm font-semibold text-error-700">
                Sync Errors ({syncErrors.length})
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {syncErrors.map((err, i) => (
                  <li key={i} className="text-xs text-error-600">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
