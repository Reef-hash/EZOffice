// License activation service (docs/LICENSE_INTEGRATION_AUDIT.md).
// Bridges a Supabase magic-link/OTP identity to the customer's EZOffice
// entitlement on EZPos-Web, then caches the decision locally so the app can
// keep running fully offline for the product's configured grace window
// (75 days by default — see supabase-ezoffice-onboarding.sql).
//
// All functions take `db` as the first argument (testable, no hidden global),
// matching every other service in this codebase.

import type Database from 'better-sqlite3'
import { createClient } from '@supabase/supabase-js'
import { getLicensingConfig } from '../config/licensing'
import { getMachineFingerprint } from './machineFingerprint'
import type { LicenseState, LicenseGraceCheck } from '../../src/shared/types/entities'

const PRODUCT = 'ezoffice'

/** Shape returned by both /activate-by-account and /validate — a subset of
 * licensingV1.ts's ValidationResult that this client actually uses. The `any`
 * risk of an HTTP boundary is isolated to the two fetch call sites below. */
interface LicenseApiResponse {
  decision: 'allow' | 'deny' | 'allow_temporarily'
  status: string
  reason_code: string
  client_action: string
  product?: string
  expiresAt?: string
  expired?: boolean
  policy: { graceDays: number; revalidateAfterHours: number }
  error?: string
  licenseKey?: string
}

export interface ActivationResult {
  success: boolean
  decision: 'allow' | 'deny' | 'allow_temporarily'
  clientAction: string
  message?: string
}

function getSupabaseClient() {
  const config = getLicensingConfig()
  return createClient(config.supabaseUrl, config.supabaseAnonKey)
}

export function getLicenseState(db: Database.Database): LicenseState | null {
  const row = db.prepare('SELECT * FROM license_state WHERE id = 1').get() as LicenseState | undefined
  return row ?? null
}

function saveLicenseState(
  db: Database.Database,
  response: LicenseApiResponse,
  licenseKey: string,
  deviceFingerprint: string,
  customerEmail: string,
): void {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO license_state (
      id, license_key, decision, status, reason_code, client_action, product,
      customer_email, grace_days, revalidate_after_hours, device_fingerprint,
      checked_at, raw_response_json, created_at, updated_at
    ) VALUES (
      1, @license_key, @decision, @status, @reason_code, @client_action, @product,
      @customer_email, @grace_days, @revalidate_after_hours, @device_fingerprint,
      @checked_at, @raw_response_json, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      license_key = excluded.license_key,
      decision = excluded.decision,
      status = excluded.status,
      reason_code = excluded.reason_code,
      client_action = excluded.client_action,
      product = excluded.product,
      customer_email = excluded.customer_email,
      grace_days = excluded.grace_days,
      revalidate_after_hours = excluded.revalidate_after_hours,
      device_fingerprint = excluded.device_fingerprint,
      checked_at = excluded.checked_at,
      raw_response_json = excluded.raw_response_json,
      updated_at = excluded.updated_at
  `).run({
    license_key: licenseKey,
    decision: response.decision,
    status: response.status,
    reason_code: response.reason_code,
    client_action: response.client_action,
    product: response.product ?? PRODUCT,
    customer_email: customerEmail || null,
    grace_days: response.policy.graceDays,
    revalidate_after_hours: response.policy.revalidateAfterHours,
    device_fingerprint: deviceFingerprint,
    checked_at: now,
    raw_response_json: JSON.stringify(response),
    created_at: now,
    updated_at: now,
  })
}

/** Sends a one-time email code via Supabase Auth. Requires internet — this is
 * the one moment activation cannot happen offline (see target flow doc). */
export async function sendActivationOtp(email: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  })
  if (error) {
    throw new Error(`Failed to send activation code: ${error.message}`)
  }
}

/**
 * Verifies the emailed code, exchanges it for a Supabase session, then asks
 * EZPos-Web to resolve + activate this account's EZOffice entitlement for
 * this machine. On success, caches the decision + license key locally so
 * every subsequent launch can work fully offline within the grace window.
 */
export async function verifyOtpAndActivate(
  db: Database.Database,
  email: string,
  token: string,
): Promise<ActivationResult> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })

  if (error || !data.session?.access_token) {
    throw new Error(`Invalid or expired code: ${error?.message ?? 'no session returned'}`)
  }

  const deviceFingerprint = getMachineFingerprint()
  const config = getLicensingConfig()

  let body: LicenseApiResponse
  try {
    const res = await fetch(`${config.apiBaseUrl}/api/v1/licensing/activate-by-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({
        product: PRODUCT,
        deviceId: deviceFingerprint,
        installationId: deviceFingerprint,
      }),
    })
    body = (await res.json()) as LicenseApiResponse
  } catch (err) {
    throw new Error(`Could not reach the activation server: ${String(err)}`)
  }

  if (body.licenseKey) {
    saveLicenseState(db, body, body.licenseKey, deviceFingerprint, email)
  }

  return {
    success: body.decision === 'allow' || body.decision === 'allow_temporarily',
    decision: body.decision,
    clientAction: body.client_action,
    message: body.error,
  }
}

/**
 * Pure local check — no network. Reads the cached decision and computes
 * whether the app should proceed, based on the product's offline grace
 * window (75 days by default). This must never block on network access:
 * the whole point of the grace design is that the app keeps working while
 * genuinely offline.
 */
export function checkGraceWindow(db: Database.Database): LicenseGraceCheck {
  const state = getLicenseState(db)
  if (!state) {
    return { allowed: false, isActivated: false }
  }

  if (state.decision === 'deny') {
    return {
      allowed: false,
      isActivated: true,
      reasonCode: state.reason_code,
      clientAction: state.client_action,
      daysRemaining: 0,
      customerEmail: state.customer_email,
    }
  }

  const checkedAtMs = new Date(state.checked_at).getTime()
  const daysSinceCheck = (Date.now() - checkedAtMs) / (1000 * 60 * 60 * 24)
  const daysRemaining = Math.max(0, Math.ceil(state.grace_days - daysSinceCheck))

  if (daysSinceCheck >= state.grace_days) {
    return {
      allowed: false,
      isActivated: true,
      reasonCode: 'OFFLINE_GRACE_EXPIRED',
      clientAction: 'reconnect_to_revalidate',
      daysRemaining: 0,
      customerEmail: state.customer_email,
    }
  }

  return {
    allowed: true,
    isActivated: true,
    daysRemaining,
    customerEmail: state.customer_email,
  }
}

/**
 * Opportunistic background revalidation — called at app startup (fire and
 * forget, never awaited by the UI). Reuses the plain /validate endpoint with
 * the license key cached at activation, so the customer never has to repeat
 * the OTP step just because a revalidation interval elapsed. A network
 * failure here is expected and silent: the grace window in checkGraceWindow
 * is what protects the user, not this call succeeding.
 */
export async function revalidateIfDue(db: Database.Database): Promise<void> {
  const state = getLicenseState(db)
  if (!state) return

  const checkedAtMs = new Date(state.checked_at).getTime()
  const hoursSinceCheck = (Date.now() - checkedAtMs) / (1000 * 60 * 60)
  if (hoursSinceCheck < state.revalidate_after_hours) return

  const row = db.prepare('SELECT license_key FROM license_state WHERE id = 1').get() as
    | { license_key: string }
    | undefined
  if (!row) return

  try {
    const config = getLicensingConfig()
    const deviceFingerprint = getMachineFingerprint()
    const res = await fetch(`${config.apiBaseUrl}/api/v1/licensing/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: row.license_key, product: PRODUCT, deviceId: deviceFingerprint }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await res.json()) as LicenseApiResponse
    saveLicenseState(db, body, row.license_key, deviceFingerprint, state.customer_email ?? '')
  } catch {
    // Offline or server unreachable — keep the last cached decision as-is.
  }
}
