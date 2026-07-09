// Typed wrapper around node-machine-id — isolates its loose/callback-oriented
// API so the rest of the app only ever sees a plain async function.
// The returned ID is a stable hash derived from OS-level machine identifiers
// (Windows: MachineGuid from the registry) — used as the deviceId sent to
// EZPos-Web's /api/v1/licensing/activate for device-binding.

import { machineIdSync } from 'node-machine-id'

let cached: string | null = null

/**
 * Returns a stable per-machine identifier. Cached after first call since the
 * underlying value cannot change without reinstalling Windows.
 */
export function getMachineFingerprint(): string {
  if (cached) return cached
  cached = machineIdSync(true) // true = return the SHA-256 hashed form, not the raw GUID
  return cached
}
