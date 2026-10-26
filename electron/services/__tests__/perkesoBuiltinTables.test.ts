// Built-in PERKESO tables + LINDUNG 24 Jam (migration 0029).
//
// The seeded rows are checked three ways: against PERKESO's own published LINDUNG
// figures (Jadual Kadar Faedah LINDUNG 24 Jam, Fasa 1), against the statutory rate
// formulas for every RM100 band, and through the lookup's "exceeding X, not exceeding
// Y" boundary rule — the rule a wage of exactly RM1,700 used to fall on the wrong side of.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../../db/migrate'
import {
  lookupSocsoRate, lookupEisRate, lookupLindungRate,
  listSocsoRates, listEisRates, listLindungRates,
  createSocsoRate, deleteSocsoRate, updateEisRate, deleteLindungRate,
} from '../payroll/statutoryRates'
import { calculatePay } from '../payroll/calculationEngine'
import { createPayrollRun, calculatePayrollRun, finalizePayrollRun, getPayrollRunItems } from '../payroll/payrollRun'
import { makeSummary } from './helpers/summary'

const AS_OF = '2026-08-25'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, path.resolve(process.cwd(), 'electron/db/migrations'))
  return db
}

// "Kadar Caruman (0.75%)" row of PERKESO's Jadual Kadar Faedah LINDUNG 24 Jam (Fasa 1),
// for wages RM1,700, RM1,800, ... RM6,000.
const OFFICIAL_LINDUNG_FASA_1 = [
  12.35, 13.15, 13.85, 14.65, 15.35, 16.15, 16.85, 17.65, 18.35, 19.15, 19.85,
  20.65, 21.35, 22.15, 22.85, 23.65, 24.35, 25.15, 25.85, 26.65, 27.35, 28.15,
  28.85, 29.65, 30.35, 31.15, 31.85, 32.65, 33.35, 34.15, 34.85, 35.65, 36.35,
  37.15, 37.85, 38.65, 39.35, 40.15, 40.85, 41.65, 42.35, 43.15, 43.85, 44.65,
]

const roundTo10Sen = (n: number) => Math.round(n * 10 + 1e-9) / 10

describe('built-in PERKESO tables (migration 0029)', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb() })

  it('seeds a complete, gap-free table for SOCSO, EIS and LINDUNG', () => {
    for (const rows of [listSocsoRates(db), listEisRates(db), listLindungRates(db)]) {
      expect(rows).toHaveLength(65)
      expect(rows.every((r) => r.source === 'builtin')).toBe(true)
      const sorted = [...rows].sort((a, b) => a.wage_from - b.wage_from)
      expect(sorted[0].wage_from).toBe(0)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].wage_from).toBe(sorted[i - 1].wage_to)
      }
      expect(sorted[sorted.length - 1]).toMatchObject({ wage_from: 6000, wage_to: null })
    }
  })

  it('puts a wage of exactly RM1,700 in the RM1,600.01–1,700 bracket', () => {
    expect(lookupSocsoRate(db, 1700, AS_OF)).toEqual({ employee_contribution: 8.25, employer_contribution: 28.85 })
    expect(lookupEisRate(db, 1700, AS_OF)).toEqual({ employee_contribution: 3.3, employer_contribution: 3.3 })
    expect(lookupLindungRate(db, 1700, AS_OF)?.employee_contribution).toBe(12.35)

    expect(lookupSocsoRate(db, 1700.01, AS_OF)).toEqual({ employee_contribution: 8.75, employer_contribution: 30.65 })
    expect(lookupEisRate(db, 1700.01, AS_OF)).toEqual({ employee_contribution: 3.5, employer_contribution: 3.5 })
    expect(lookupLindungRate(db, 1700.01, AS_OF)?.employee_contribution).toBe(13.15)
  })

  it('matches every LINDUNG figure PERKESO published for RM1,700–RM6,000', () => {
    OFFICIAL_LINDUNG_FASA_1.forEach((expected, i) => {
      const wage = 1700 + i * 100
      expect(lookupLindungRate(db, wage, AS_OF)?.employee_contribution, `wage RM${wage}`).toBe(expected)
    })
  })

  it('matches the statutory rate formulas for every RM100 band from RM200', () => {
    for (let upper = 300; upper <= 6000; upper += 100) {
      const midpoint = upper - 50
      const socso = lookupSocsoRate(db, upper, AS_OF)!
      const eis = lookupEisRate(db, upper, AS_OF)!
      // SOCSO employee 0.5%; first-category total 2.25% rounded to 10 sen; EIS 0.2% each side.
      expect(socso.employee_contribution, `SOCSO ee RM${upper}`).toBeCloseTo(midpoint * 0.005, 9)
      expect(socso.employee_contribution + socso.employer_contribution, `SOCSO total RM${upper}`)
        .toBeCloseTo(roundTo10Sen(midpoint * 0.0225), 9)
      expect(eis.employee_contribution, `EIS RM${upper}`).toBeCloseTo(midpoint * 0.002, 9)
      expect(eis.employer_contribution, `EIS RM${upper}`).toBeCloseTo(midpoint * 0.002, 9)
    }
  })

  it('caps contributions at the RM6,000 ceiling', () => {
    expect(lookupSocsoRate(db, 9500, AS_OF)).toEqual({ employee_contribution: 29.75, employer_contribution: 104.15 })
    expect(lookupEisRate(db, 9500, AS_OF)).toEqual({ employee_contribution: 11.9, employer_contribution: 11.9 })
    expect(lookupLindungRate(db, 9500, AS_OF)?.employee_contribution).toBe(44.65)
  })

  it('charges nothing on a zero wage', () => {
    expect(lookupSocsoRate(db, 0, AS_OF)).toBeNull()
    expect(lookupEisRate(db, 0, AS_OF)).toBeNull()
    expect(lookupLindungRate(db, 0, AS_OF)).toBeNull()
  })

  it('has no LINDUNG rate before the scheme started on 2026-06-01', () => {
    expect(lookupLindungRate(db, 1700, '2026-05-31')).toBeNull()
    expect(lookupLindungRate(db, 1700, '2026-06-01')?.employee_contribution).toBe(12.35)
  })

  it('refuses to change or delete a built-in row', () => {
    const builtinSocso = listSocsoRates(db)[0]
    expect(() => deleteSocsoRate(db, builtinSocso.id)).toThrow(/built-in PERKESO rate/)
    expect(() => updateEisRate(db, listEisRates(db)[0].id, { employee_contribution: 1 })).toThrow(/built-in PERKESO rate/)
    expect(() => deleteLindungRate(db, listLindungRates(db)[0].id)).toThrow(/built-in PERKESO rate/)
    expect(listSocsoRates(db)).toHaveLength(65)
  })

  it('lets a manual row with a later effective date override the built-in one, and be deleted', () => {
    const manual = createSocsoRate(db, {
      effective_from: '2026-01-01', employee_category: 'all',
      wage_from: 1600, wage_to: 1700, employee_contribution: 9, employer_contribution: 30,
    })
    expect(manual.source).toBe('manual')
    expect(lookupSocsoRate(db, 1650, AS_OF)).toEqual({ employee_contribution: 9, employer_contribution: 30 })
    // Wages outside the override still use the built-in table.
    expect(lookupSocsoRate(db, 1750, AS_OF)?.employee_contribution).toBe(8.75)

    deleteSocsoRate(db, manual.id)
    expect(lookupSocsoRate(db, 1650, AS_OF)?.employee_contribution).toBe(8.25)
  })
})

describe('LINDUNG 24 Jam in the calculation engine', () => {
  const base = {
    summary: makeSummary({ employee_id: 1 }),
    otRule: { ot_rule_type: 'multiplier' as const, ot_rule_value: 1.5 },
    epfRate: null,
    socsoRate: { employee_contribution: 8.25, employer_contribution: 28.85 },
    eisRate: { employee_contribution: 3.3, employer_contribution: 3.3 },
    lindungRate: { employee_contribution: 12.35 },
    pcbBracket: null,
    advanceDeduction: 0,
  }
  const structure = {
    rate_type: 'monthly' as const, rate_amount: 1700, standard_hours_per_day: 8,
    subject_to_epf: 0, subject_to_socso: 1, subject_to_eis: 1, subject_to_lindung: 1,
  }

  it('deducts LINDUNG from net pay, employee-only', () => {
    const r = calculatePay({ ...base, structure })
    expect(r.statutory.lindung_employee).toBe(12.35)
    expect(r.net_pay).toBeCloseTo(1700 - 8.25 - 3.3 - 12.35, 9)
  })

  it('skips LINDUNG for an employee who opted out', () => {
    const r = calculatePay({ ...base, structure: { ...structure, subject_to_lindung: 0 } })
    expect(r.statutory.lindung_employee).toBe(0)
  })

  it('skips LINDUNG when the employee is not under SOCSO at all', () => {
    const r = calculatePay({ ...base, structure: { ...structure, subject_to_socso: 0 } })
    expect(r.statutory.lindung_employee).toBe(0)
    expect(r.statutory.socso_employee).toBe(0)
  })
})

describe('LINDUNG 24 Jam through a real payroll run', () => {
  function seedRun(db: Database.Database, periodEnd: string, subjectToLindung: number): number {
    db.prepare(`INSERT INTO departments (id, name) VALUES (1, 'Ops')`).run()
    db.prepare(`
      INSERT INTO employees (id, employee_code, name, ic_number, department_id, status, date_joined)
      VALUES (1, 'EMP001', 'Aminah', '900101-01-0001', 1, 'active', '2020-01-01')
    `).run()
    db.prepare(`
      INSERT INTO salary_structures (employee_id, effective_from, rate_type, rate_amount, standard_hours_per_day,
        subject_to_epf, subject_to_socso, subject_to_eis, subject_to_lindung)
      VALUES (1, '2020-01-01', 'monthly', 1700, 8, 0, 1, 1, ?)
    `).run(subjectToLindung)
    db.prepare(`
      INSERT INTO payroll_periods (id, name, start_date, end_date, status)
      VALUES (1, 'Period', date(?, '-30 days'), ?, 'finalized')
    `).run(periodEnd, periodEnd)
    const run = createPayrollRun(db, { payroll_period_id: 1, pay_group: 'attendance', pay_date: periodEnd })
    calculatePayrollRun(db, run.id)
    return run.id
  }

  it('deducts the built-in SOCSO, EIS and LINDUNG amounts and keeps them through finalize', () => {
    const db = makeDb()
    const runId = seedRun(db, '2026-08-25', 1)
    finalizePayrollRun(db, runId)
    const [item] = getPayrollRunItems(db, runId)
    expect(item).toMatchObject({
      socso_employee: 8.25, socso_employer: 28.85,
      eis_employee: 3.3, eis_employer: 3.3,
      lindung_employee: 12.35, snapshot_subject_to_lindung: 1,
    })
    expect(item.net_pay).toBeCloseTo(1700 - 8.25 - 3.3 - 12.35 - item.pcb, 9)
  })

  it('deducts no LINDUNG for a period before the scheme started', () => {
    const db = makeDb()
    const [item] = getPayrollRunItems(db, seedRun(db, '2026-05-25', 1))
    expect(item.lindung_employee).toBe(0)
    expect(item.socso_employee).toBe(8.25)
  })

  it('deducts no LINDUNG for an employee who opted out', () => {
    const db = makeDb()
    const [item] = getPayrollRunItems(db, seedRun(db, '2026-08-25', 0))
    expect(item.lindung_employee).toBe(0)
    expect(item.snapshot_subject_to_lindung).toBe(0)
  })
})
