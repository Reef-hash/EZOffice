// Settings service — company profile management (Phase D1).
// Singleton pattern: only one settings row (id=1) exists.

import type Database from 'better-sqlite3'
import type { CompanySettings } from '../../src/shared/types/entities'
import type { UpdateCompanySettingsInput } from '../../src/shared/types/inputs'

export function getCompanySettings(db: Database.Database): CompanySettings {
  const row = db.prepare('SELECT * FROM company_settings WHERE id = 1').get() as CompanySettings | undefined

  if (!row) {
    throw new Error('Company settings not found (table may not be initialized)')
  }

  return row
}

export function updateCompanySettings(
  db: Database.Database,
  input: UpdateCompanySettingsInput,
): CompanySettings {
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE company_settings
    SET
      company_name = COALESCE(@company_name, company_name),
      sst_number = COALESCE(@sst_number, sst_number),
      brn_number = COALESCE(@brn_number, brn_number),
      bank_account_name = COALESCE(@bank_account_name, bank_account_name),
      bank_account_number = COALESCE(@bank_account_number, bank_account_number),
      email = COALESCE(@email, email),
      phone = COALESCE(@phone, phone),
      address = COALESCE(@address, address),
      logo_base64 = COALESCE(@logo_base64, logo_base64),
      updated_at = @updated_at
    WHERE id = 1
  `).run({
    company_name: input.company_name ?? null,
    sst_number: input.sst_number ?? null,
    brn_number: input.brn_number ?? null,
    bank_account_name: input.bank_account_name ?? null,
    bank_account_number: input.bank_account_number ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    logo_base64: input.logo_base64 ?? null,
    updated_at: now,
  })

  return getCompanySettings(db)
}
