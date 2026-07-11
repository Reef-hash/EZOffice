// Calendar service — Company Calendar profile + events + day resolution.
// All functions take `db` as the first argument (testable, no hidden global).

import type Database from 'better-sqlite3'
import type {
  CompanyCalendarProfile,
  EmployeeCalendarProfile,
  CalendarEvent,
  CalendarDayType,
  ResolvedCalendarDay,
} from '../../src/shared/types/entities'
import type {
  UpdateCompanyCalendarProfileInput,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  CreateEmployeeCalendarProfileInput,
} from '../../src/shared/types/inputs'

// ── Helpers: SQLite stores booleans as INTEGER 0/1 — convert ──

function rowToCompanyProfile(raw: Record<string, unknown>): CompanyCalendarProfile {
  return {
    id: Number(raw.id),
    name: String(raw.name),
    monday_is_working: Boolean(raw.monday_is_working),
    tuesday_is_working: Boolean(raw.tuesday_is_working),
    wednesday_is_working: Boolean(raw.wednesday_is_working),
    thursday_is_working: Boolean(raw.thursday_is_working),
    friday_is_working: Boolean(raw.friday_is_working),
    saturday_is_working: Boolean(raw.saturday_is_working),
    sunday_is_working: Boolean(raw.sunday_is_working),
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  }
}

function rowToEmployeeProfile(raw: Record<string, unknown>): EmployeeCalendarProfile {
  return {
    id: Number(raw.id),
    employee_id: Number(raw.employee_id),
    monday_is_working: Boolean(raw.monday_is_working),
    tuesday_is_working: Boolean(raw.tuesday_is_working),
    wednesday_is_working: Boolean(raw.wednesday_is_working),
    thursday_is_working: Boolean(raw.thursday_is_working),
    friday_is_working: Boolean(raw.friday_is_working),
    saturday_is_working: Boolean(raw.saturday_is_working),
    sunday_is_working: Boolean(raw.sunday_is_working),
    effective_from: String(raw.effective_from),
    effective_to: raw.effective_to ? String(raw.effective_to) : null,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  }
}

// ── Company Profile ───────────────────────────────────────────

export function getCompanyCalendarProfile(db: Database.Database): CompanyCalendarProfile {
  const row = db.prepare('SELECT * FROM company_calendar_profiles WHERE id = 1').get() as
    Record<string, unknown> | undefined
  if (!row) {
    db.prepare("INSERT INTO company_calendar_profiles (name) VALUES ('Standard Malaysian')").run()
    const created = db.prepare('SELECT * FROM company_calendar_profiles WHERE id = 1').get() as Record<string, unknown>
    return rowToCompanyProfile(created)
  }
  return rowToCompanyProfile(row)
}

export function updateCompanyCalendarProfile(
  db: Database.Database,
  input: UpdateCompanyCalendarProfileInput,
): CompanyCalendarProfile {
  const existing = getCompanyCalendarProfile(db)
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE company_calendar_profiles
    SET name = @name,
        monday_is_working = @mon,
        tuesday_is_working = @tue,
        wednesday_is_working = @wed,
        thursday_is_working = @thu,
        friday_is_working = @fri,
        saturday_is_working = @sat,
        sunday_is_working = @sun,
        updated_at = @now
    WHERE id = 1
  `).run({
    name: input.name ?? existing.name,
    mon: (input.monday_is_working ?? existing.monday_is_working) ? 1 : 0,
    tue: (input.tuesday_is_working ?? existing.tuesday_is_working) ? 1 : 0,
    wed: (input.wednesday_is_working ?? existing.wednesday_is_working) ? 1 : 0,
    thu: (input.thursday_is_working ?? existing.thursday_is_working) ? 1 : 0,
    fri: (input.friday_is_working ?? existing.friday_is_working) ? 1 : 0,
    sat: (input.saturday_is_working ?? existing.saturday_is_working) ? 1 : 0,
    sun: (input.sunday_is_working ?? existing.sunday_is_working) ? 1 : 0,
    now,
  })
  return getCompanyCalendarProfile(db)
}

// ── Employee Profile ──────────────────────────────────────────

export function getEmployeeCalendarProfile(
  db: Database.Database,
  employeeId: number,
): EmployeeCalendarProfile | null {
  const row = db.prepare(`
    SELECT * FROM employee_calendar_profiles
    WHERE employee_id = ?
    ORDER BY effective_from DESC
    LIMIT 1
  `).get(employeeId) as Record<string, unknown> | undefined
  return row ? rowToEmployeeProfile(row) : null
}

export function setEmployeeCalendarProfile(
  db: Database.Database,
  input: CreateEmployeeCalendarProfileInput,
): EmployeeCalendarProfile {
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO employee_calendar_profiles
      (employee_id, monday_is_working, tuesday_is_working,
       wednesday_is_working, thursday_is_working, friday_is_working,
       saturday_is_working, sunday_is_working,
       effective_from, effective_to, created_at, updated_at)
    VALUES
      (@employee_id, @mon, @tue, @wed, @thu, @fri, @sat, @sun,
       @effective_from, @effective_to, @now, @now)
  `).run({
    employee_id: input.employee_id,
    mon: input.monday_is_working ? 1 : 0,
    tue: input.tuesday_is_working ? 1 : 0,
    wed: input.wednesday_is_working ? 1 : 0,
    thu: input.thursday_is_working ? 1 : 0,
    fri: input.friday_is_working ? 1 : 0,
    sat: input.saturday_is_working ? 1 : 0,
    sun: input.sunday_is_working ? 1 : 0,
    effective_from: input.effective_from,
    effective_to: input.effective_to ?? null,
    now,
  })
  return db.prepare('SELECT * FROM employee_calendar_profiles WHERE id = ?')
    .get(result.lastInsertRowid) as EmployeeCalendarProfile
}

export function deleteEmployeeCalendarProfile(
  db: Database.Database,
  employeeId: number,
): void {
  db.prepare('DELETE FROM employee_calendar_profiles WHERE employee_id = ?').run(employeeId)
}

// ── Calendar Events ───────────────────────────────────────────

export function listCalendarEvents(
  db: Database.Database,
  filters?: { year?: number; month?: number },
): CalendarEvent[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filters?.year) {
    conditions.push("strftime('%Y', event_date) = @year")
    params.year = String(filters.year)
  }
  if (filters?.month) {
    conditions.push("strftime('%m', event_date) = @month")
    params.month = String(filters.month).padStart(2, '0')
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return db.prepare(`
    SELECT * FROM calendar_events ${where} ORDER BY event_date ASC, event_type ASC
  `).all(params) as CalendarEvent[]
}

export function getCalendarEventById(db: Database.Database, id: number): CalendarEvent | null {
  const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as CalendarEvent | undefined
  return row ?? null
}

export function createCalendarEvent(
  db: Database.Database,
  input: CreateCalendarEventInput,
): CalendarEvent {
  const now = new Date().toISOString()
  try {
    const result = db.prepare(`
      INSERT INTO calendar_events (event_type, name, event_date, description, is_recurring, created_at, updated_at)
      VALUES (@event_type, @name, @event_date, @description, @is_recurring, @now, @now)
    `).run({
      event_type: input.event_type,
      name: input.name,
      event_date: input.event_date,
      description: input.description ?? null,
      is_recurring: input.is_recurring ? 1 : 0,
      now,
    })
    return db.prepare('SELECT * FROM calendar_events WHERE id = ?')
      .get(result.lastInsertRowid) as CalendarEvent
  } catch (err) {
    throw new Error(`Failed to create calendar event: ${String(err)}`)
  }
}

export function updateCalendarEvent(
  db: Database.Database,
  id: number,
  input: UpdateCalendarEventInput,
): CalendarEvent {
  const existing = getCalendarEventById(db, id)
  if (!existing) throw new Error(`Calendar event with id ${id} not found`)

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE calendar_events
    SET event_type = @event_type,
        name = @name,
        event_date = @event_date,
        description = @description,
        is_recurring = @is_recurring,
        updated_at = @now
    WHERE id = @id
  `).run({
    event_type: input.event_type ?? existing.event_type,
    name: input.name ?? existing.name,
    event_date: input.event_date ?? existing.event_date,
    description: input.description !== undefined ? input.description : existing.description,
    is_recurring: input.is_recurring !== undefined ? (input.is_recurring ? 1 : 0) : existing.is_recurring,
    now,
    id,
  })
  return getCalendarEventById(db, id)!
}

export function deleteCalendarEvent(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Calendar event with id ${id} not found`)
  }
}

// ── Day Resolution ─────────────────────────────────────────────

/**
 * Resolves what kind of day a given date is for a given employee.
 *
 * Priority chain (see docs/hrms-architecture-proposal.md §8):
 *   1. Emergency Closure      (overrides everything)
 *   2. Special Working Day    (intentional override — treat as working day)
 *   3. Public Holiday         (unless overridden by special_working_day)
 *   4. Company Holiday        (unless overridden by special_working_day)
 *   5. Weekly Off             (from calendar profile)
 *   6. Working Day            (default)
 *   7. Half Day               (floating modifier alongside the resolved type)
 *   8. Company Event          (informational — does not affect status)
 *
 * Leave resolution happens in the Processing Engine (Phase 3), not here.
 */
export function resolveCalendarDay(
  db: Database.Database,
  employeeId: number,
  date: string,
): ResolvedCalendarDay {
  const dayOfWeek = new Date(date + 'T00:00:00').getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayName = dayNames[dayOfWeek]

  // Check for emergency closure (highest priority)
  const emergencyClosure = db.prepare(`
    SELECT * FROM calendar_events WHERE event_type = 'emergency_closure' AND event_date = ?
  `).get(date) as CalendarEvent | undefined
  if (emergencyClosure) {
    return {
      date, employee_id: employeeId,
      day_type: 'emergency_closure',
      is_half_day: false,
      event_name: emergencyClosure.name,
      event_id: emergencyClosure.id,
      description: emergencyClosure.description,
    }
  }

  // Check for special working day (overrides holidays/weekly off)
  const specialWorkingDay = db.prepare(`
    SELECT * FROM calendar_events WHERE event_type = 'special_working_day' AND event_date = ?
  `).get(date) as CalendarEvent | undefined
  const isSpecialWorkingDay = !!specialWorkingDay

  // Check for public holiday (unless overridden by special working day)
  if (!isSpecialWorkingDay) {
    const publicHoliday = db.prepare(`
      SELECT * FROM calendar_events WHERE event_type = 'public_holiday' AND event_date = ?
    `).get(date) as CalendarEvent | undefined
    if (publicHoliday) {
      return {
        date, employee_id: employeeId,
        day_type: 'public_holiday',
        is_half_day: false,
        event_name: publicHoliday.name,
        event_id: publicHoliday.id,
        description: publicHoliday.description,
      }
    }

    // Check for company holiday
    const companyHoliday = db.prepare(`
      SELECT * FROM calendar_events WHERE event_type = 'company_holiday' AND event_date = ?
    `).get(date) as CalendarEvent | undefined
    if (companyHoliday) {
      return {
        date, employee_id: employeeId,
        day_type: 'company_holiday',
        is_half_day: false,
        event_name: companyHoliday.name,
        event_id: companyHoliday.id,
        description: companyHoliday.description,
      }
    }
  }

  // Determine working day vs. weekly off from employee's calendar profile (or company default)
  const profile = getEmployeeCalendarProfile(db, employeeId) ?? getCompanyCalendarProfile(db)

  // Map day name to boolean property name
  const workingDayKey = `${dayName}_is_working` as keyof typeof profile
  const isWorkingDay = Boolean(profile[workingDayKey])

  if (isSpecialWorkingDay) {
    return {
      date, employee_id: employeeId,
      day_type: 'special_working_day',
      is_half_day: false,
      event_name: specialWorkingDay.name,
      event_id: specialWorkingDay.id,
      description: specialWorkingDay.description,
    }
  }

  if (!isWorkingDay) {
    return {
      date, employee_id: employeeId,
      day_type: 'weekly_off',
      is_half_day: false,
      event_name: null,
      event_id: null,
      description: null,
    }
  }

  // Check for half day (floating modifier)
  const halfDay = db.prepare(`
    SELECT * FROM calendar_events WHERE event_type = 'half_day' AND event_date = ?
  `).get(date) as CalendarEvent | undefined

  // Check for company event (informational)
  const companyEvent = db.prepare(`
    SELECT * FROM calendar_events WHERE event_type = 'company_event' AND event_date = ?
  `).get(date) as CalendarEvent | undefined

  const dayType: CalendarDayType = companyEvent ? 'company_event' : 'working_day'
  const event = companyEvent ?? halfDay

  return {
    date, employee_id: employeeId,
    day_type: dayType,
    is_half_day: !!halfDay,
    event_name: event?.name ?? null,
    event_id: event?.id ?? null,
    description: event?.description ?? null,
  }
}

/**
 * Resolves all calendar days in a month for a single employee.
 */
export function resolveCalendarMonth(
  db: Database.Database,
  employeeId: number,
  year: number,
  month: number,
): ResolvedCalendarDay[] {
  const lastDay = new Date(year, month, 0).getDate()
  const results: ResolvedCalendarDay[] = []
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    results.push(resolveCalendarDay(db, employeeId, dateStr))
  }
  return results
}

/**
 * Resolves all calendar days in a month for ALL employees.
 * Used by the processing engine (Phase 3) and the calendar month view.
 */
export function resolveCalendarForAllEmployees(
  db: Database.Database,
  year: number,
  month: number,
): ResolvedCalendarDay[] {
  const employees = db.prepare("SELECT id FROM employees WHERE status = 'active'").all() as Array<{ id: number }>
  const results: ResolvedCalendarDay[] = []
  for (const emp of employees) {
    results.push(...resolveCalendarMonth(db, emp.id, year, month))
  }
  return results
}
