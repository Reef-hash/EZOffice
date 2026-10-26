// Statutory Rate services — CRUD + runtime bracket lookups.
// Each statutory table (EPF/SOCSO/EIS/PCB) has its own service file for single responsibility.
// Bracket lookups: find the bracket whose wage range contains the given wage
// ("exceeding wage_from, not exceeding wage_to" — see BRACKET_MATCH_SQL),
// effective at the given date (latest effective_from ≤ run date).

import type Database from 'better-sqlite3'
import { RATE_TABLE_SOURCE } from '../../../src/shared/types/entities'
import type { EpfRate, SocsoRate, EisRate, LindungRate, PcbBracket, RateTableSource } from '../../../src/shared/types/entities'
import type {
  CreateEpfRateInput, UpdateEpfRateInput, CreateSocsoRateInput, UpdateSocsoRateInput,
  CreateEisRateInput, UpdateEisRateInput, CreateLindungRateInput, UpdateLindungRateInput,
  CreatePcbBracketInput, UpdatePcbBracketInput,
} from '../../../src/shared/types/inputs'

/**
 * PERKESO (and KWSP) tables read "wages exceeding X but not exceeding Y", so a wage of
 * exactly RM1,700 belongs to the RM1,600.01–1,700 row: wage_from < wage <= wage_to.
 * A wage of 0 matches no row, so an employee with no pay that month owes nothing.
 */
const BRACKET_MATCH_SQL = 'wage_from < ? AND (wage_to IS NULL OR wage_to >= ?)'

// ── EPF Rates ────────────────────────────────────────────

export function listEpfRates(db: Database.Database): EpfRate[] {
  return db.prepare('SELECT * FROM epf_rates ORDER BY effective_from DESC, wage_from ASC').all() as EpfRate[]
}

export function createEpfRate(db: Database.Database, input: CreateEpfRateInput): EpfRate {
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO epf_rates (effective_from, employee_category, wage_from, wage_to,
      employee_contribution_pct, employer_contribution_pct, created_at, updated_at)
    VALUES (@effective_from, @employee_category, @wage_from, @wage_to,
      @employee_contribution_pct, @employer_contribution_pct, @created_at, @updated_at)
  `).run({ ...input, wage_to: input.wage_to ?? null, created_at: now, updated_at: now })
  return db.prepare('SELECT * FROM epf_rates WHERE id = ?').get(result.lastInsertRowid) as EpfRate
}

export function updateEpfRate(db: Database.Database, id: number, input: UpdateEpfRateInput): EpfRate {
  const existing = db.prepare('SELECT * FROM epf_rates WHERE id = ?').get(id) as EpfRate | undefined
  if (!existing) throw new Error(`EPF rate with id ${id} not found`)
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE epf_rates SET effective_from = ?, employee_category = ?, wage_from = ?, wage_to = ?,
      employee_contribution_pct = ?, employer_contribution_pct = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.effective_from ?? existing.effective_from,
    input.employee_category ?? existing.employee_category,
    input.wage_from ?? existing.wage_from,
    input.wage_to !== undefined ? input.wage_to : existing.wage_to,
    input.employee_contribution_pct ?? existing.employee_contribution_pct,
    input.employer_contribution_pct ?? existing.employer_contribution_pct,
    now, id,
  )
  return db.prepare('SELECT * FROM epf_rates WHERE id = ?').get(id) as EpfRate
}

export function deleteEpfRate(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM epf_rates WHERE id = ?').run(id)
  if (result.changes === 0) throw new Error(`EPF rate with id ${id} not found`)
}

/**
 * Look up the EPF bracket applicable to a given wage as of a given date.
 * Returns the matching bracket or null if none found (rate table may be empty).
 */
export function lookupEpfRate(
  db: Database.Database,
  wage: number,
  asOfDate: string,
): { employee_contribution_pct: number; employer_contribution_pct: number } | null {
  const row = db.prepare(`
    SELECT employee_contribution_pct, employer_contribution_pct
    FROM epf_rates
    WHERE effective_from <= ? AND ${BRACKET_MATCH_SQL}
    ORDER BY effective_from DESC, wage_from DESC
    LIMIT 1
  `).get(asOfDate, wage, wage) as { employee_contribution_pct: number; employer_contribution_pct: number } | undefined
  return row ?? null
}

// ── SOCSO / EIS / LINDUNG 24 Jam ─────────────────────────
// These three PERKESO tables share one shape (wage bracket -> fixed RM amounts) and
// one set of rules, so they share one implementation. Rows tagged source='builtin'
// ship with the app (migration 0029) and are read-only here: correcting a built-in
// rate means shipping a new migration, while an admin who needs a different figure
// adds a 'manual' row with a later effective_from, which the lookup prefers.

type FixedAmountRateTable = 'socso_rates' | 'eis_rates' | 'lindung_rates'

const FIXED_AMOUNT_TABLE_LABEL: Record<FixedAmountRateTable, string> = {
  socso_rates: 'SOCSO',
  eis_rates: 'EIS',
  lindung_rates: 'LINDUNG 24 Jam',
}

interface FixedAmountRateRow {
  id: number
  effective_from: string
  employee_category: string
  wage_from: number
  wage_to: number | null
  employee_contribution: number
  employer_contribution: number
  source: RateTableSource
  created_at: string
  updated_at: string
}

interface FixedAmountRateInput {
  effective_from: string
  employee_category: string
  wage_from: number
  wage_to?: number | null
  employee_contribution: number
  employer_contribution: number
}

function listFixedAmountRates(db: Database.Database, table: FixedAmountRateTable): FixedAmountRateRow[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY effective_from DESC, wage_from ASC`).all() as FixedAmountRateRow[]
}

function getFixedAmountRate(db: Database.Database, table: FixedAmountRateTable, id: number): FixedAmountRateRow {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as FixedAmountRateRow | undefined
  if (!row) throw new Error(`${FIXED_AMOUNT_TABLE_LABEL[table]} rate with id ${id} not found`)
  return row
}

function assertManualRow(table: FixedAmountRateTable, row: FixedAmountRateRow): void {
  if (row.source === RATE_TABLE_SOURCE.BUILTIN) {
    throw new Error(
      `${FIXED_AMOUNT_TABLE_LABEL[table]} rate ${row.wage_from}–${row.wage_to ?? '∞'} is a built-in PERKESO rate and cannot be changed. ` +
      'To use a different figure, add your own row with a later Effective From date — it takes priority.',
    )
  }
}

function createFixedAmountRate(db: Database.Database, table: FixedAmountRateTable, input: FixedAmountRateInput): FixedAmountRateRow {
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO ${table} (effective_from, employee_category, wage_from, wage_to,
      employee_contribution, employer_contribution, source, created_at, updated_at)
    VALUES (@effective_from, @employee_category, @wage_from, @wage_to,
      @employee_contribution, @employer_contribution, '${RATE_TABLE_SOURCE.MANUAL}', @created_at, @updated_at)
  `).run({ ...input, wage_to: input.wage_to ?? null, created_at: now, updated_at: now })
  return getFixedAmountRate(db, table, Number(result.lastInsertRowid))
}

function updateFixedAmountRate(
  db: Database.Database,
  table: FixedAmountRateTable,
  id: number,
  input: Partial<FixedAmountRateInput>,
): FixedAmountRateRow {
  const existing = getFixedAmountRate(db, table, id)
  assertManualRow(table, existing)
  db.prepare(`
    UPDATE ${table} SET effective_from = ?, employee_category = ?, wage_from = ?, wage_to = ?,
      employee_contribution = ?, employer_contribution = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.effective_from ?? existing.effective_from,
    input.employee_category ?? existing.employee_category,
    input.wage_from ?? existing.wage_from,
    input.wage_to !== undefined ? input.wage_to : existing.wage_to,
    input.employee_contribution ?? existing.employee_contribution,
    input.employer_contribution ?? existing.employer_contribution,
    new Date().toISOString(), id,
  )
  return getFixedAmountRate(db, table, id)
}

function deleteFixedAmountRate(db: Database.Database, table: FixedAmountRateTable, id: number): void {
  assertManualRow(table, getFixedAmountRate(db, table, id))
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
}

function lookupFixedAmountRate(
  db: Database.Database,
  table: FixedAmountRateTable,
  wage: number,
  asOfDate: string,
): { employee_contribution: number; employer_contribution: number } | null {
  const row = db.prepare(`
    SELECT employee_contribution, employer_contribution
    FROM ${table}
    WHERE effective_from <= ? AND ${BRACKET_MATCH_SQL}
    ORDER BY effective_from DESC, wage_from DESC
    LIMIT 1
  `).get(asOfDate, wage, wage) as { employee_contribution: number; employer_contribution: number } | undefined
  return row ?? null
}

export const listSocsoRates = (db: Database.Database): SocsoRate[] => listFixedAmountRates(db, 'socso_rates')
export const createSocsoRate = (db: Database.Database, input: CreateSocsoRateInput): SocsoRate =>
  createFixedAmountRate(db, 'socso_rates', input)
export const updateSocsoRate = (db: Database.Database, id: number, input: UpdateSocsoRateInput): SocsoRate =>
  updateFixedAmountRate(db, 'socso_rates', id, input)
export const deleteSocsoRate = (db: Database.Database, id: number): void => deleteFixedAmountRate(db, 'socso_rates', id)
export const lookupSocsoRate = (db: Database.Database, wage: number, asOfDate: string) =>
  lookupFixedAmountRate(db, 'socso_rates', wage, asOfDate)

export const listEisRates = (db: Database.Database): EisRate[] => listFixedAmountRates(db, 'eis_rates')
export const createEisRate = (db: Database.Database, input: CreateEisRateInput): EisRate =>
  createFixedAmountRate(db, 'eis_rates', input)
export const updateEisRate = (db: Database.Database, id: number, input: UpdateEisRateInput): EisRate =>
  updateFixedAmountRate(db, 'eis_rates', id, input)
export const deleteEisRate = (db: Database.Database, id: number): void => deleteFixedAmountRate(db, 'eis_rates', id)
export const lookupEisRate = (db: Database.Database, wage: number, asOfDate: string) =>
  lookupFixedAmountRate(db, 'eis_rates', wage, asOfDate)

export const listLindungRates = (db: Database.Database): LindungRate[] => listFixedAmountRates(db, 'lindung_rates')
export const createLindungRate = (db: Database.Database, input: CreateLindungRateInput): LindungRate =>
  createFixedAmountRate(db, 'lindung_rates', input)
export const updateLindungRate = (db: Database.Database, id: number, input: UpdateLindungRateInput): LindungRate =>
  updateFixedAmountRate(db, 'lindung_rates', id, input)
export const deleteLindungRate = (db: Database.Database, id: number): void => deleteFixedAmountRate(db, 'lindung_rates', id)
/** Returns null before the scheme's start date (2026-06-01) — the caller then deducts nothing. */
export const lookupLindungRate = (db: Database.Database, wage: number, asOfDate: string) =>
  lookupFixedAmountRate(db, 'lindung_rates', wage, asOfDate)

// ── PCB Brackets ─────────────────────────────────────────

export function listPcbBrackets(db: Database.Database): PcbBracket[] {
  return db.prepare('SELECT * FROM pcb_brackets ORDER BY effective_from DESC, chargeable_income_from ASC').all() as PcbBracket[]
}

export function createPcbBracket(db: Database.Database, input: CreatePcbBracketInput): PcbBracket {
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO pcb_brackets (effective_from, category, children_count,
      chargeable_income_from, chargeable_income_to, tax_amount, created_at, updated_at)
    VALUES (@effective_from, @category, @children_count,
      @chargeable_income_from, @chargeable_income_to, @tax_amount, @created_at, @updated_at)
  `).run({
    ...input, chargeable_income_to: input.chargeable_income_to ?? null,
    created_at: now, updated_at: now,
  })
  return db.prepare('SELECT * FROM pcb_brackets WHERE id = ?').get(result.lastInsertRowid) as PcbBracket
}

export function updatePcbBracket(db: Database.Database, id: number, input: UpdatePcbBracketInput): PcbBracket {
  const existing = db.prepare('SELECT * FROM pcb_brackets WHERE id = ?').get(id) as PcbBracket | undefined
  if (!existing) throw new Error(`PCB bracket with id ${id} not found`)
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE pcb_brackets SET effective_from = ?, category = ?, children_count = ?,
      chargeable_income_from = ?, chargeable_income_to = ?, tax_amount = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.effective_from ?? existing.effective_from,
    input.category ?? existing.category,
    input.children_count ?? existing.children_count,
    input.chargeable_income_from ?? existing.chargeable_income_from,
    input.chargeable_income_to !== undefined ? input.chargeable_income_to : existing.chargeable_income_to,
    input.tax_amount ?? existing.tax_amount,
    now, id,
  )
  return db.prepare('SELECT * FROM pcb_brackets WHERE id = ?').get(id) as PcbBracket
}

export function deletePcbBracket(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM pcb_brackets WHERE id = ?').run(id)
  if (result.changes === 0) throw new Error(`PCB bracket with id ${id} not found`)
}

/**
 * Look up the PCB bracket for a given chargeable income, category, and children count.
 * PCB is progressive — this returns the bracket whose income range contains the chargeable income.
 * The caller uses multiple brackets above income_from ≤ chargeable income for the progressive calculation.
 */
export function lookupPcbBracket(
  db: Database.Database,
  chargeableIncome: number,
  category: string,
  childrenCount: number,
  asOfDate: string,
): PcbBracket | null {
  const row = db.prepare(`
    SELECT *
    FROM pcb_brackets
    WHERE effective_from <= ?
      AND category = ?
      AND children_count = ?
      AND chargeable_income_from <= ?
      AND (chargeable_income_to IS NULL OR chargeable_income_to > ?)
    ORDER BY effective_from DESC, chargeable_income_from DESC
    LIMIT 1
  `).get(asOfDate, category, childrenCount, chargeableIncome, chargeableIncome) as PcbBracket | undefined
  return row ?? null
}

/**
 * Returns the names of statutory rate tables that are empty AND actually needed.
 * "Needed" means at least one salary structure has the corresponding opt-in flag set.
 * Companies that have turned off EPF/SOCSO/EIS for all employees (e.g. new companies
 * not yet registered with KWSP/PERKESO) can finalize without those tables populated.
 * PCB has no opt-out flag — it is flagged only if salary structures exist (i.e. there
 * are employees set up) but the pcb_brackets table is empty.
 */
export function checkRateTablesForRun(db: Database.Database): { missing: string[] } {
  const missing: string[] = []

  const tableCount = (table: string) =>
    (db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt

  const structuresNeedingFlag = (flag: string) =>
    (db.prepare(`SELECT COUNT(*) as cnt FROM salary_structures WHERE ${flag} = 1`).get() as { cnt: number }).cnt

  if (structuresNeedingFlag('subject_to_epf') > 0 && tableCount('epf_rates') === 0) missing.push('EPF')
  if (structuresNeedingFlag('subject_to_socso') > 0 && tableCount('socso_rates') === 0) missing.push('SOCSO')
  if (structuresNeedingFlag('subject_to_eis') > 0 && tableCount('eis_rates') === 0) missing.push('EIS')
  if (tableCount('salary_structures') > 0 && tableCount('pcb_brackets') === 0) missing.push('PCB')

  return { missing }
}
