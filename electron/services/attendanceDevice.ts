// Device info service — H3 + H4 + M5 implementation.
// Real Test Connection, device user listing for the mapping panel,
// clock-drift detection and correction.
//
// D2 (locked): device `state` field is permanently ignored.
// testDeviceConnection never throws — all device errors are surfaced as ok=false.

import type Database from 'better-sqlite3'
import type { DeviceTestResult, DeviceUser, DeviceSyncLog } from '../../src/shared/types/entities'

/**
 * Tests connection to the device, reads device info, and checks clock drift (H3/M5).
 * Never throws — device errors (unreachable, refused, timeout) return ok=false + error.
 */
export async function testDeviceConnection(
  deviceIp: string,
  devicePort: number,
): Promise<DeviceTestResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const Zkteco = require('zkteco-js') as any
    const device = new Zkteco(deviceIp, devicePort, 5200, 5000)

    await device.createSocket()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let info: any = {}
    try { info = await device.getInfo() } catch { /* some firmware versions don't support getInfo */ }

    // Clock drift check (M5): compare device time to PC time
    let clockDriftSeconds: number | null = null
    let clockDriftWarning: string | null = null
    try {
      const deviceTime: Date = await device.getTime()
      if (deviceTime instanceof Date && !isNaN(deviceTime.getTime())) {
        const driftMs = deviceTime.getTime() - Date.now()
        clockDriftSeconds = Math.round(driftMs / 1000)
        if (Math.abs(clockDriftSeconds) > 60) {
          const direction = clockDriftSeconds > 0 ? 'ahead' : 'behind'
          clockDriftWarning = `Device clock is ${Math.abs(clockDriftSeconds)} s ${direction} — sync it before relying on late/OT data`
        }
      }
    } catch { /* getTime not supported or fails — skip */ }

    await device.disconnect()

    return {
      ok: true,
      deviceName: String(info?.deviceName ?? info?.device_name ?? 'Unknown'),
      serial: String(info?.serialNumber ?? info?.serial_number ?? info?.sn ?? 'Unknown'),
      userCount: typeof info?.userCounts === 'number' ? info.userCounts : null,
      logCount: typeof info?.logCounts === 'number' ? info.logCounts : null,
      error: null,
      clockDriftSeconds,
      clockDriftWarning,
    }
  } catch (err) {
    return {
      ok: false,
      deviceName: null,
      serial: null,
      userCount: null,
      logCount: null,
      error: String(err),
      clockDriftSeconds: null,
      clockDriftWarning: null,
    }
  }
}

/**
 * Fetches the list of users enrolled on the device (H4 mapping panel).
 * Returns an array of { deviceUserId, name }.
 */
export async function getDeviceUsers(
  deviceIp: string,
  devicePort: number,
): Promise<DeviceUser[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const Zkteco = require('zkteco-js') as any
    const device = new Zkteco(deviceIp, devicePort, 5200, 5000)
    await device.createSocket()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await device.getUsers() as any
    await device.disconnect()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const users: any[] = Array.isArray(response) ? response : (response?.data ?? [])
    return users
      .filter((u) => u && (u.userId != null || u.user_id != null))
      .map((u) => ({
        deviceUserId: Number(u.userId ?? u.user_id),
        name: String(u.name ?? u.userName ?? `User ${u.userId ?? u.user_id}`),
      }))
  } catch (err) {
    throw new Error(`Failed to fetch device users: ${String(err)}`)
  }
}

/**
 * Sets the device clock to the current PC time (M5 — fixes drift).
 * Does not auto-correct silently — the IPC caller must confirm the admin
 * intends to do this. Punches already stored on the device were stamped
 * with the drifted clock; this only affects future punches.
 */
export async function setDeviceTime(
  deviceIp: string,
  devicePort: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const Zkteco = require('zkteco-js') as any
    const device = new Zkteco(deviceIp, devicePort, 5200, 5000)
    await device.createSocket()
    await device.setTime(new Date())
    await device.disconnect()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** Returns the most recent device_sync_log row, or null if no sync has run. */
export function getLastSyncLog(db: Database.Database): DeviceSyncLog | null {
  const row = db.prepare(
    'SELECT * FROM device_sync_log ORDER BY created_at DESC LIMIT 1',
  ).get() as DeviceSyncLog | undefined
  return row ?? null
}
