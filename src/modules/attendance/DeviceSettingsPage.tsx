// Device settings for fingerprint reader sync (ZKTeco V1000 integration).
// Stores device IP/port in payroll_settings table and provides sync trigger.

import { useState, useCallback, useEffect } from 'react'
import type { ChangeEvent } from 'react'
import { Card } from '@/shared/components/Card'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { useIpcMutation, useIpcQuery } from '@/shared/hooks/useIpcQuery'
import { useToast } from '@/shared/components/Toast'
import type { PayrollSettings } from '@/shared/types/entities'

interface SyncResult {
  inserted: number
  skipped: number
  errors: string[]
}

export function DeviceSettingsPage() {
  const { addToast } = useToast()
  const [deviceIp, setDeviceIp] = useState('')
  const [devicePort, setDevicePort] = useState('4370')
  const [isSaving, setIsSaving] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)

  // Fetch current settings on load
  const { data: settings } = useIpcQuery<PayrollSettings>(
    ['payroll', 'settings'],
    () => window.api.payroll.settings.get(),
  )

  // Populate form when settings load
  useEffect(() => {
    if (settings) {
      setDeviceIp(settings.device_ip || '')
      setDevicePort(String(settings.device_port || 4370))
    }
  }, [settings])

  const syncMutation = useIpcMutation<SyncResult, void>(
    () => window.api.attendance.syncFromDevice(),
    [],
  )

  const updateSettingsMutation = useIpcMutation<PayrollSettings, Record<string, unknown>>(
    (data) => window.api.payroll.settings.update(data as never),
    [['payroll', 'settings']],
  )

  const handleSync = useCallback(async () => {
    try {
      const result = await syncMutation.mutateAsync()
      setLastSyncTime(new Date().toLocaleString())
      const errorNote = result.errors.length > 0 ? `, ${result.errors.length} skipped (errors)` : ''
      addToast(
        `Sync complete: ${result.inserted} inserted, ${result.skipped} skipped${errorNote}`,
        'success',
      )
    } catch (err) {
      addToast(`Sync failed: ${String(err)}`, 'error')
    }
  }, [syncMutation, addToast])

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

  const handleTestConnection = useCallback(() => {
    if (!deviceIp) {
      addToast('Please enter a device IP address first.', 'error')
      return
    }
    addToast(
      `Device configured at ${deviceIp}:${devicePort}. Click "Sync Now" to test the connection.`,
      'info',
    )
  }, [deviceIp, devicePort, addToast])

  return (
    <div className="max-w-2xl">
      <Card>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-neutral-900">Device Configuration</h3>
          <p className="mt-1 text-sm text-neutral-600">
            Configure your ZKTeco V1000 fingerprint reader connection settings.
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
            <Button size="sm" variant="secondary" onClick={handleTestConnection}>
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
        </div>
      </Card>

      <Card className="mt-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-neutral-900">Sync from Device</h3>
          <p className="mt-1 text-sm text-neutral-600">
            Fetch latest attendance records from the fingerprint reader and merge into the system.
          </p>
        </div>

        <div className="space-y-3">
          {lastSyncTime && (
            <p className="text-sm text-neutral-600">
              Last sync: <span className="font-medium">{lastSyncTime}</span>
            </p>
          )}

          <Button
            variant="dark"
            disabled={!deviceIp || syncMutation.isPending}
            isLoading={syncMutation.isPending}
            onClick={handleSync}
          >
            {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
          </Button>
        </div>
      </Card>

    </div>
  )
}
