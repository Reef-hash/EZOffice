import type { BadgeTone } from '@/shared/components/StatusBadge'
import { CALENDAR_EVENT_TYPE, type CalendarEventType, type CalendarDayType } from '@/shared/types/entities'

export { CALENDAR_EVENT_TYPE }

export const CALENDAR_EVENT_TYPE_LABEL: Record<CalendarEventType, string> = {
  [CALENDAR_EVENT_TYPE.PUBLIC_HOLIDAY]: 'Public Holiday',
  [CALENDAR_EVENT_TYPE.COMPANY_HOLIDAY]: 'Company Holiday',
  [CALENDAR_EVENT_TYPE.SPECIAL_WORKING_DAY]: 'Special Working Day',
  [CALENDAR_EVENT_TYPE.HALF_DAY]: 'Half Day',
  [CALENDAR_EVENT_TYPE.EMERGENCY_CLOSURE]: 'Emergency Closure',
  [CALENDAR_EVENT_TYPE.COMPANY_EVENT]: 'Company Event',
}

export const CALENDAR_EVENT_TYPE_TONE: Record<CalendarEventType, BadgeTone> = {
  [CALENDAR_EVENT_TYPE.PUBLIC_HOLIDAY]: 'info',
  [CALENDAR_EVENT_TYPE.COMPANY_HOLIDAY]: 'info',
  [CALENDAR_EVENT_TYPE.SPECIAL_WORKING_DAY]: 'success',
  [CALENDAR_EVENT_TYPE.HALF_DAY]: 'warning',
  [CALENDAR_EVENT_TYPE.EMERGENCY_CLOSURE]: 'error',
  [CALENDAR_EVENT_TYPE.COMPANY_EVENT]: 'neutral',
}

export const CALENDAR_DAY_TYPE_LABEL: Record<CalendarDayType, string> = {
  working_day: 'Working Day',
  weekly_off: 'Weekly Off',
  public_holiday: 'Public Holiday',
  company_holiday: 'Company Holiday',
  special_working_day: 'Special Working Day',
  half_day: 'Half Day',
  emergency_closure: 'Emergency Closure',
  company_event: 'Company Event',
}

export const CALENDAR_DAY_TYPE_TONE: Record<CalendarDayType, BadgeTone> = {
  working_day: 'success',
  weekly_off: 'neutral',
  public_holiday: 'info',
  company_holiday: 'info',
  special_working_day: 'success',
  half_day: 'warning',
  emergency_closure: 'error',
  company_event: 'neutral',
}
