// EZOffice entity types — shared between Electron main process and React renderer.
// These represent the database rows as returned by services.

export const EMPLOYEE_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const

export type EmployeeStatus = (typeof EMPLOYEE_STATUS)[keyof typeof EMPLOYEE_STATUS]

export interface Department {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export interface Employee {
  id: number
  employee_code: string
  name: string
  ic_number: string
  phone: string | null
  email: string | null
  department_id: number | null
  department_name: string | null // populated via JOIN in list queries
  position: string | null
  status: EmployeeStatus
  date_joined: string
  device_user_id: number | null // ZKTeco device user ID mapping
  shift_id: number | null // Phase C: assigned default shift
  shift_name: string | null // populated via JOIN in list queries
  created_at: string
  updated_at: string
}

export interface Customer {
  id: number
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: number
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  created_at: string
  updated_at: string
}

export interface Product {
  id: number
  sku: string
  name: string
  unit_of_measure: string
  default_price: number
  created_at: string
  updated_at: string
}

// --- Attendance ---

export const ATTENDANCE_TYPE = {
  IN: 'in',
  OUT: 'out',
} as const

export type AttendanceType = (typeof ATTENDANCE_TYPE)[keyof typeof ATTENDANCE_TYPE]

export const ATTENDANCE_SOURCE = {
  MANUAL: 'manual',
  DEVICE: 'device',
} as const

export type AttendanceSource = (typeof ATTENDANCE_SOURCE)[keyof typeof ATTENDANCE_SOURCE]

export interface AttendanceLog {
  id: number
  employee_id: number
  employee_name: string | null // populated via JOIN in list queries
  type: AttendanceType
  timestamp: string
  source: AttendanceSource
  device_id: string | null
  note: string | null
  shift_id: number | null // snapshot of assigned shift at punch time (Phase C)
  shift_name: string | null // populated via JOIN in list queries
  status: AttendanceStatus // on-time / late / absent / excused-late (Phase C)
  created_at: string
  updated_at: string
}

// --- Phase C: Shifts ---

export interface Shift {
  id: number
  name: string
  start_time: string // "HH:MM" 24h, naive local time
  end_time: string // "HH:MM" 24h, naive local time
  standard_hours: number
  created_at: string
  updated_at: string
}

// --- Phase C: Leave ---

export const LEAVE_TYPE = {
  ANNUAL: 'annual',
  SICK: 'sick',
  UNPAID: 'unpaid',
} as const

export type LeaveType = (typeof LEAVE_TYPE)[keyof typeof LEAVE_TYPE]

export const LEAVE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const

export type LeaveStatus = (typeof LEAVE_STATUS)[keyof typeof LEAVE_STATUS]

export interface LeaveEntitlement {
  id: number
  employee_id: number
  leave_type: LeaveType
  balance: number
  year: number
  created_at: string
  updated_at: string
}

/** Balance summary per leave type for a single employee × year. */
export interface LeaveBalance {
  annual: number
  sick: number
  unpaid: number // informational — unpaid leave has no cap
}

export interface LeaveRecord {
  id: number
  employee_id: number
  employee_name: string | null // populated via JOIN in list queries
  leave_type: LeaveType
  date_from: string // YYYY-MM-DD inclusive
  date_to: string // YYYY-MM-DD inclusive
  reason: string | null
  status: LeaveStatus
  created_at: string
  updated_at: string
}

// --- Phase C: Late detection ---

export const ATTENDANCE_STATUS = {
  ON_TIME: 'on-time',
  LATE: 'late',
  ABSENT: 'absent',
  EXCUSED_LATE: 'excused-late',
} as const

export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS]

/** Result of validating a clock-in against the employee's assigned shift. */
export interface ClockValidationResult {
  onTime: boolean
  minutesLate: number // 0 when on-time
  alertMessage: string | null
}

/** One row of the late report. */
export interface LateReportRow {
  employee_id: number
  employee_name: string
  count_late: number
  count_excused: number
  total_minutes_late: number
  avg_minutes_late: number
}

/** One day's entry in the monthly attendance summary calendar. */
export interface AttendanceSummaryDay {
  date: string // YYYY-MM-DD
  first_in: string | null // ISO timestamp of first IN punch
  last_out: string | null // ISO timestamp of last OUT punch
  hours_worked: number
  status: AttendanceStatus | 'leave'
  leave_type: LeaveType | null
}

/** Aggregated monthly attendance for a single employee. */
export interface AttendanceMonthlyCalendar {
  employee_id: number
  employee_name: string | null
  year: number
  month: number
  days: AttendanceSummaryDay[]
  total_hours: number
  days_worked: number
  days_late: number
  days_leave: number
}

// --- Payroll ---

export const SALARY_RATE_TYPE = {
  DAILY: 'daily',
  HOURLY: 'hourly',
} as const

export type SalaryRateType = (typeof SALARY_RATE_TYPE)[keyof typeof SALARY_RATE_TYPE]

export const OT_RULE_TYPE = {
  FLAT_ADDITION: 'flat_addition',
  MULTIPLIER: 'multiplier',
} as const

export type OtRuleType = (typeof OT_RULE_TYPE)[keyof typeof OT_RULE_TYPE]

export const PAYROLL_RUN_STATUS = {
  DRAFT: 'draft',
  FINALIZED: 'finalized',
} as const

export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUS)[keyof typeof PAYROLL_RUN_STATUS]

export const ADVANCE_STATUS = {
  ACTIVE: 'active',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
} as const

export type AdvanceStatus = (typeof ADVANCE_STATUS)[keyof typeof ADVANCE_STATUS]

export const DEDUCTION_MODE = {
  FULL_BALANCE: 'full_balance',
  FIXED_INSTALLMENT: 'fixed_installment',
} as const

export type DeductionMode = (typeof DEDUCTION_MODE)[keyof typeof DEDUCTION_MODE]

export const PCB_CATEGORY = {
  SINGLE: 'single',
  MARRIED_NO_SPOUSE_INCOME: 'married_no_spouse_income',
  MARRIED_WITH_SPOUSE_INCOME: 'married_with_spouse_income',
} as const

export type PcbCategory = (typeof PCB_CATEGORY)[keyof typeof PCB_CATEGORY]

export interface SalaryStructure {
  id: number
  employee_id: number
  employee_name?: string // populated via JOIN
  effective_from: string
  rate_type: SalaryRateType
  rate_amount: number
  standard_hours_per_day: number
  subject_to_epf: number // 0 or 1 (SQLite)
  subject_to_socso: number
  subject_to_eis: number
  pcb_category: 'single' | 'married_no_spouse_income' | 'married_with_spouse_income'
  pcb_children_count: number
  created_at: string
  updated_at: string
}

export interface PayrollSettings {
  id: number
  ot_rule_type: OtRuleType
  ot_rule_value: number
  device_ip: string | null
  device_port: number
  grace_period_minutes: number // Phase C: late tolerance in minutes
  // Sync overhaul (DEVICE_SYNC_AUDIT.md 2026-07-08):
  punch_debounce_minutes: number // D3: collapse same-employee punches < N min apart
  max_session_hours: number      // D4: pairs > N hours excluded from pay + flagged
  device_last_synced_at: string | null // H1: watermark ISO timestamp; null = never synced
  default_annual_leave_days: number // company-wide default, applied via initializeYearlyLeaveEntitlements()
  default_sick_leave_days: number
  created_at: string
  updated_at: string
}

/** A single employee's leave entitlement row, joined with employee name for display. */
export interface LeaveEntitlementRow {
  employee_id: number
  employee_name: string
  year: number
  annual_balance: number | null // null = no entitlement row exists yet for this employee/year
  sick_balance: number | null
}

export interface EpfRate {
  id: number
  effective_from: string
  employee_category: string
  wage_from: number
  wage_to: number | null
  employee_contribution_pct: number
  employer_contribution_pct: number
  created_at: string
  updated_at: string
}

export interface SocsoRate {
  id: number
  effective_from: string
  employee_category: string
  wage_from: number
  wage_to: number | null
  employee_contribution: number
  employer_contribution: number
  created_at: string
  updated_at: string
}

export interface EisRate {
  id: number
  effective_from: string
  employee_category: string
  wage_from: number
  wage_to: number | null
  employee_contribution: number
  employer_contribution: number
  created_at: string
  updated_at: string
}

export interface PcbBracket {
  id: number
  effective_from: string
  category: PcbCategory
  children_count: number
  chargeable_income_from: number
  chargeable_income_to: number | null
  tax_amount: number
  created_at: string
  updated_at: string
}

export interface SalaryAdvance {
  id: number
  employee_id: number
  employee_name?: string // populated via JOIN
  amount: number
  date_issued: string
  limit_max: number
  balance_outstanding: number
  status: AdvanceStatus
  deduction_mode: DeductionMode
  installment_amount: number | null
  created_at: string
  updated_at: string
}

export interface PayrollRun {
  id: number
  year: number
  month: number
  status: PayrollRunStatus
  run_date: string
  created_at: string
  updated_at: string
}

export interface PayrollRunItem {
  id: number
  payroll_run_id: number
  employee_id: number
  employee_name?: string // populated via JOIN
  salary_structure_id: number | null
  snapshot_rate_type: string
  snapshot_rate_amount: number
  snapshot_standard_hours_per_day: number
  snapshot_subject_to_epf: number
  snapshot_subject_to_socso: number
  snapshot_subject_to_eis: number
  total_regular_hours: number
  total_ot_hours: number
  gross_regular_pay: number
  gross_ot_pay: number
  gross_pay: number
  epf_employee: number
  epf_employer: number
  socso_employee: number
  socso_employer: number
  eis_employee: number
  eis_employer: number
  pcb: number
  advance_deduction: number
  net_pay: number
  created_at: string
  updated_at: string
}

// --- Payroll Calculation Types (not DB rows — used in the calculation engine) ---

export interface StatutoryBreakdown {
  epf_employee: number
  epf_employer: number
  socso_employee: number
  socso_employer: number
  eis_employee: number
  eis_employer: number
  pcb: number
}

export interface PayCheckResult {
  employee_id: number
  salary_structure_id: number

  // Hours
  total_regular_hours: number
  total_ot_hours: number

  // Gross
  gross_regular_pay: number
  gross_ot_pay: number
  gross_pay: number

  // Statutory
  statutory: StatutoryBreakdown

  // Deductions
  advance_deduction: number

  // Net
  net_pay: number
}

// Summary returned by getMonthlyAttendanceSummary for a single employee × month
export interface EmployeeMonthlySummary {
  employee_id: number
  total_regular_hours: number
  total_ot_hours: number
  days_worked: number
}

// Phase D1: Company Settings (singleton)
export interface CompanySettings {
  id: 1
  company_name: string | null
  sst_number: string | null
  brn_number: string | null
  bank_account_name: string | null
  bank_account_number: string | null
  email: string | null
  phone: string | null
  address: string | null
  logo_base64: string | null  // base64-encoded PNG/JPG for payslips
  created_at: string
  updated_at: string
}

// ── Sync overhaul types (DEVICE_SYNC_AUDIT.md 2026-07-08) ────────────────────

/** One row from device_sync_log table — persists sync results for admin review. */
export interface DeviceSyncLog {
  id: number
  device_ip: string
  started_at: string
  inserted: number
  skipped: number
  errors_json: string | null // JSON array of error strings
  created_at: string
}

/** Extended sync result returned from IPC — includes the log row id. */
export interface DeviceSyncResult {
  inserted: number
  skipped: number
  errors: string[]
  syncLogId: number | null
  completedAt: string
}

/** Result of a Test Connection call (H3). */
export interface DeviceTestResult {
  ok: boolean
  deviceName: string | null
  serial: string | null
  userCount: number | null
  logCount: number | null
  error: string | null
  // Clock drift (M5): null if device time could not be read
  clockDriftSeconds: number | null
  clockDriftWarning: string | null // human-readable warning if drift > 60s
}

/** One user enrolled on the ZKTeco device (H4 mapping panel). */
export interface DeviceUser {
  deviceUserId: number
  name: string
}

// Attendance exceptions (H2/D5)

export const EXCEPTION_TYPE = {
  MISSING_PUNCH: 'missing_punch',
  OVER_LONG_SESSION: 'over_long_session',
  PUNCH_ON_LEAVE: 'punch_on_leave',
} as const

export type ExceptionType = (typeof EXCEPTION_TYPE)[keyof typeof EXCEPTION_TYPE]

export const EXCEPTION_STATUS = {
  OPEN: 'open',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
} as const

export type ExceptionStatus = (typeof EXCEPTION_STATUS)[keyof typeof EXCEPTION_STATUS]

export interface AttendanceException {
  id: number
  employee_id: number
  employee_name: string | null // populated via JOIN
  year: number
  month: number
  date: string // YYYY-MM-DD
  exception_type: ExceptionType
  description: string
  status: ExceptionStatus
  note: string | null
  related_log_ids: string | null // JSON array
  created_at: string
  updated_at: string
}

// ── License activation (docs/LICENSE_INTEGRATION_AUDIT.md) ──────────────────

export type LicenseDecision = 'allow' | 'deny' | 'allow_temporarily'

export interface LicenseState {
  decision: LicenseDecision
  status: string
  reason_code: string
  client_action: string
  product: string
  customer_email: string | null
  grace_days: number
  revalidate_after_hours: number
  device_fingerprint: string
  checked_at: string
  created_at: string
  updated_at: string
}

export interface LicenseGraceCheck {
  /** Whether the app should proceed to normal use right now. */
  allowed: boolean
  /** True only when no activation has ever happened on this machine. */
  isActivated: boolean
  /** Present when allowed=false — the reason to show the user. */
  reasonCode?: string
  clientAction?: string
  /** Whole days remaining in the offline grace window (0 if none left). */
  daysRemaining?: number
  customerEmail?: string | null
}

// ── Phase 1: Company Calendar ─────────────────────────────────

export const CALENDAR_EVENT_TYPE = {
  PUBLIC_HOLIDAY: 'public_holiday',
  COMPANY_HOLIDAY: 'company_holiday',
  SPECIAL_WORKING_DAY: 'special_working_day',
  HALF_DAY: 'half_day',
  EMERGENCY_CLOSURE: 'emergency_closure',
  COMPANY_EVENT: 'company_event',
} as const

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPE)[keyof typeof CALENDAR_EVENT_TYPE]

/** Company-wide default working week (singleton, row id=1). */
export interface CompanyCalendarProfile {
  id: number
  name: string
  monday_is_working: boolean
  tuesday_is_working: boolean
  wednesday_is_working: boolean
  thursday_is_working: boolean
  friday_is_working: boolean
  saturday_is_working: boolean
  sunday_is_working: boolean
  created_at: string
  updated_at: string
}

/** Per-employee working week override. Nullable — null means inherit company default. */
export interface EmployeeCalendarProfile {
  id: number
  employee_id: number
  monday_is_working: boolean
  tuesday_is_working: boolean
  wednesday_is_working: boolean
  thursday_is_working: boolean
  friday_is_working: boolean
  saturday_is_working: boolean
  sunday_is_working: boolean
  effective_from: string
  effective_to: string | null
  created_at: string
  updated_at: string
}

/** A date-specific calendar exception (public holiday, emergency closure, etc.). */
export interface CalendarEvent {
  id: number
  event_type: CalendarEventType
  name: string
  event_date: string  // YYYY-MM-DD
  description: string | null
  is_recurring: boolean
  created_at: string
  updated_at: string
}

/** Resolved classification for a single employee × date. */
export type CalendarDayType =
  | 'working_day'
  | 'weekly_off'
  | 'public_holiday'
  | 'company_holiday'
  | 'special_working_day'
  | 'half_day'
  | 'emergency_closure'
  | 'company_event'

export interface ResolvedCalendarDay {
  date: string  // YYYY-MM-DD
  employee_id: number
  day_type: CalendarDayType
  is_half_day: boolean
  event_name: string | null  // name of the calendar event that triggered this type
  event_id: number | null     // FK to calendar_events if applicable
  description: string | null
}

// ── Phase 2: Payroll Periods ─────────────────────────────────

export const PAYROLL_PERIOD_STATUS = {
  OPEN: 'open',
  PROCESSING: 'processing',
  FINALIZED: 'finalized',
  CLOSED: 'closed',
} as const

export type PayrollPeriodStatus = (typeof PAYROLL_PERIOD_STATUS)[keyof typeof PAYROLL_PERIOD_STATUS]

export interface PayrollPeriod {
  id: number
  name: string
  start_date: string
  end_date: string
  status: PayrollPeriodStatus
  processed_at: string | null
  finalized_at: string | null
  finalized_by: number | null
  created_at: string
  updated_at: string
}

// ── Phase 3: Processing Engine ───────────────────────────────

export const PROCESSING_RUN_STATUS = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type ProcessingRunStatus = (typeof PROCESSING_RUN_STATUS)[keyof typeof PROCESSING_RUN_STATUS]

export interface ProcessingRun {
  id: number
  payroll_period_id: number
  status: ProcessingRunStatus
  started_at: string
  completed_at: string | null
  total_employees: number
  total_days: number
  error_message: string | null
  created_at: string
}

export type AttendanceDayStatus =
  | 'present' | 'late' | 'excused_late' | 'early_out'
  | 'absent' | 'on_leave' | 'holiday' | 'weekly_off'
  | 'emergency_closure' | 'no_show'

export interface DailyAttendanceRecord {
  id: number
  employee_id: number
  date: string
  payroll_period_id: number | null
  processing_run_id: number | null
  calendar_type: CalendarDayType
  leave_type: string | null
  leave_record_id: number | null
  shift_id: number | null
  attendance_status: AttendanceDayStatus
  first_in: string | null
  last_out: string | null
  session_count: number
  total_clocked_hours: number
  break_hours: number
  regular_hours: number
  ot_hours: number
  minutes_late: number
  minutes_early_out: number
  is_finalized: boolean
  created_at: string
  updated_at: string
}

