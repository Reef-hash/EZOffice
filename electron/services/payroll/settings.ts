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
        updated_at = @updated_at
    WHERE id = 1
  `).run({
    ot_rule_type: input.ot_rule_type ?? existing.ot_rule_type,
    ot_rule_value: input.ot_rule_value ?? existing.ot_rule_value,
    grace_period_minutes: input.grace_period_minutes ?? existing.grace_period_minutes,
    updated_at: now,
  })

  return getPayrollSettings(db)
}
