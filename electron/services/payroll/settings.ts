// Payroll Settings service — singleton config (OT rule).
// The payroll_settings table has exactly one row (id = 1, seeded by migration).

import type Database from 'better-sqlite3'
import type { PayrollSettings } from '../../../src/shared/types/entities'
import type { UpdatePayrollSettingsInput } from '../../../src/shared/types/inputs'

export function getPayrollSettings(db: Database.Database): PayrollSettings {
  const row = db.prepare('SELECT * FROM payroll_settings WHERE id = 1').get() as PayrollSettings
  if (!row) {
    throw new Error('Payroll settings row not found — migration should have seeded id=1')
  }
  return row
}

export function updatePayrollSettings(
  db: Database.Database,
  input: UpdatePayrollSettingsInput,
): PayrollSettings {
  const existing = getPayrollSettings(db)
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE payroll_settings
    SET ot_rule_type = @ot_rule_type,
        ot_rule_value = @ot_rule_value,
        grace_period_minutes = @grace_period_minutes,
        device_ip = @device_ip,
        device_port = @device_port,
        punch_debounce_minutes = @punch_debounce_minutes,
        max_session_hours = @max_session_hours,
        updated_at = @updated_at
    WHERE id = 1
  `).run({
    ot_rule_type: input.ot_rule_type ?? existing.ot_rule_type,
    ot_rule_value: input.ot_rule_value ?? existing.ot_rule_value,
    grace_period_minutes: input.grace_period_minutes ?? existing.grace_period_minutes,
    device_ip: input.device_ip !== undefined ? input.device_ip : existing.device_ip,
    device_port: input.device_port ?? existing.device_port,
    punch_debounce_minutes: input.punch_debounce_minutes ?? existing.punch_debounce_minutes,
    max_session_hours: input.max_session_hours ?? existing.max_session_hours,
    updated_at: now,
  })

  return getPayrollSettings(db)
}
