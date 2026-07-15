// Zod validation schemas for IPC handler input validation.
// Every IPC handler that accepts data must validate through these before calling a service.

import { z } from 'zod'
import { EMPLOYEE_STATUS, ATTENDANCE_TYPE, LEAVE_TYPE, LEAVE_STATUS } from './entities'

// --- Employees ---

export const createEmployeeSchema = z.object({
  employee_code: z.string().min(1, 'Employee code is required'),
  name: z.string().min(1, 'Name is required'),
  ic_number: z.string().min(1, 'IC number is required'),
  phone: z.string().nullable().optional(),
  email: z.string().email('Invalid email').nullable().optional().or(z.literal('')),
  department_id: z.number().int().positive().nullable().optional(),
  position: z.string().nullable().optional(),
  status: z.enum([EMPLOYEE_STATUS.ACTIVE, EMPLOYEE_STATUS.INACTIVE]).default(EMPLOYEE_STATUS.ACTIVE),
  date_joined: z.string().min(1, 'Date joined is required'),
})

export const updateEmployeeSchema = createEmployeeSchema.partial()

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>

// Phase C: optional shift assignment on employee create/update
// Phase 3b: optional device_user_id for ZKTeco sync mapping
export const createEmployeeWithShiftSchema = createEmployeeSchema.extend({
  shift_id: z.number().int().positive().nullable().optional(),
  device_user_id: z.number().int().positive().nullable().optional(),
})
export const updateEmployeeWithShiftSchema = createEmployeeWithShiftSchema.partial()
export type CreateEmployeeWithShiftInput = z.infer<typeof createEmployeeWithShiftSchema>
export type UpdateEmployeeWithShiftInput = z.infer<typeof updateEmployeeWithShiftSchema>

// --- CSV import row for Employee ---

export const csvEmployeeRowSchema = z.object({
  employee_code: z.string().min(1),
  name: z.string().min(1),
  ic_number: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  department_name: z.string().optional(),
  position: z.string().optional(),
  date_joined: z.string().min(1),
})

export type CsvEmployeeRow = z.infer<typeof csvEmployeeRowSchema>

export interface CsvImportResult {
  imported: number
  errors: Array<{ row: number; message: string }>
}

// --- Customers ---

export const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  contact_person: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email('Invalid email').nullable().optional().or(z.literal('')),
  address: z.string().nullable().optional(),
})

export const updateCustomerSchema = createCustomerSchema.partial()

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>

// --- Suppliers ---

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  contact_person: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email('Invalid email').nullable().optional().or(z.literal('')),
  address: z.string().nullable().optional(),
})

export const updateSupplierSchema = createSupplierSchema.partial()

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>

// --- Products ---

export const createProductSchema = z.object({
  sku: z.string().min(1, 'SKU is required'),
  name: z.string().min(1, 'Name is required'),
  unit_of_measure: z.string().min(1, 'Unit of measure is required'),
  default_price: z.number().min(0, 'Price must be non-negative'),
})

export const updateProductSchema = createProductSchema.partial()

export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>

// --- Departments ---

export const createDepartmentSchema = z.object({
  name: z.string().min(1, 'Department name is required'),
})

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>

// --- Attendance ---

// Clock In / Clock Out from the Quick Clock panel — only employee_id is required,
// timestamp defaults to now on the service side if omitted.
export const clockActionSchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  timestamp: z.string().optional(),
})

export type ClockActionInput = z.infer<typeof clockActionSchema>

// Manual log creation (admin adds/backfills an entry)
export const createAttendanceLogSchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  type: z.enum([ATTENDANCE_TYPE.IN, ATTENDANCE_TYPE.OUT]),
  timestamp: z.string().min(1, 'Timestamp is required'),
  note: z.string().nullable().optional(),
})

export const updateAttendanceLogSchema = createAttendanceLogSchema.partial()

export type CreateAttendanceLogInput = z.infer<typeof createAttendanceLogSchema>
export type UpdateAttendanceLogInput = z.infer<typeof updateAttendanceLogSchema>

// --- Payroll: Salary Structures ---

export const createSalaryStructureSchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  effective_from: z.string().min(1, 'Effective date is required'),
  rate_type: z.enum(['daily', 'hourly']),
  rate_amount: z.number().positive('Rate must be positive'),
  standard_hours_per_day: z.number().positive('Hours must be positive').default(8),
  subject_to_epf: z.number().int().min(0).max(1).default(1),
  subject_to_socso: z.number().int().min(0).max(1).default(1),
  subject_to_eis: z.number().int().min(0).max(1).default(1),
  pcb_category: z.enum(['single', 'married_no_spouse_income', 'married_with_spouse_income']).default('single'),
  pcb_children_count: z.number().int().min(0).default(0),
})

export const updateSalaryStructureSchema = createSalaryStructureSchema.partial()

export type CreateSalaryStructureInput = z.infer<typeof createSalaryStructureSchema>
export type UpdateSalaryStructureInput = z.infer<typeof updateSalaryStructureSchema>

// --- Payroll: Settings ---

export const updatePayrollSettingsSchema = z.object({
  ot_rule_type: z.enum(['flat_addition', 'multiplier']).optional(),
  ot_rule_value: z.number().min(0, 'OT value must be non-negative').optional(),
  grace_period_minutes: z.number().int().min(0, 'Grace period must be non-negative').optional(),
  // Phase 3: Device integration (ZKTeco V1000 / K40 Pro)
  device_ip: z.string().min(1, 'Device IP is required').optional(),
  device_port: z.number().int().min(1, 'Port must be between 1 and 65535').max(65535).optional(),
  // Sync overhaul (DEVICE_SYNC_AUDIT.md 2026-07-08)
  punch_debounce_minutes: z.number().int().min(0).optional(),
  max_session_hours: z.number().min(1).optional(),
})

export type UpdatePayrollSettingsInput = z.infer<typeof updatePayrollSettingsSchema>

// --- Payroll: Rate Tables ---

const rateBracketSchema = z.object({
  effective_from: z.string().min(1, 'Effective date is required'),
  employee_category: z.string().min(1, 'Category is required'),
  wage_from: z.number().min(0, 'Wage from must be non-negative'),
  wage_to: z.number().positive('Wage to must be positive').nullable().optional(),
})

export const createEpfRateSchema = rateBracketSchema.extend({
  employee_contribution_pct: z.number().min(0),
  employer_contribution_pct: z.number().min(0),
})

export const updateEpfRateSchema = createEpfRateSchema.partial()

export const createSocsoRateSchema = rateBracketSchema.extend({
  employee_contribution: z.number().min(0),
  employer_contribution: z.number().min(0),
})

export const updateSocsoRateSchema = createSocsoRateSchema.partial()

export const createEisRateSchema = rateBracketSchema.extend({
  employee_contribution: z.number().min(0),
  employer_contribution: z.number().min(0),
})

export const updateEisRateSchema = createEisRateSchema.partial()

export const createPcbBracketSchema = z.object({
  effective_from: z.string().min(1, 'Effective date is required'),
  category: z.enum(['single', 'married_no_spouse_income', 'married_with_spouse_income']),
  children_count: z.number().int().min(0).default(0),
  chargeable_income_from: z.number().min(0),
  chargeable_income_to: z.number().positive('Income to must be positive').nullable().optional(),
  tax_amount: z.number().min(0),
})

export const updatePcbBracketSchema = createPcbBracketSchema.partial()

export type CreateEpfRateInput = z.infer<typeof createEpfRateSchema>
export type UpdateEpfRateInput = z.infer<typeof updateEpfRateSchema>
export type CreateSocsoRateInput = z.infer<typeof createSocsoRateSchema>
export type UpdateSocsoRateInput = z.infer<typeof updateSocsoRateSchema>
export type CreateEisRateInput = z.infer<typeof createEisRateSchema>
export type UpdateEisRateInput = z.infer<typeof updateEisRateSchema>
export type CreatePcbBracketInput = z.infer<typeof createPcbBracketSchema>
export type UpdatePcbBracketInput = z.infer<typeof updatePcbBracketSchema>

// --- Payroll: Salary Advances ---

// Base shape kept separate from the refinement below — Zod does not allow .partial()
// on a schema that already carries a .refine() (cross-field check), so the update
// schema partials the base directly. The installment_amount/deduction_mode invariant is
// still enforced for partial updates in the service layer (electron/services/payroll/
// salaryAdvances.ts updateSalaryAdvance), checked against the merged result.
const salaryAdvanceBaseSchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  amount: z.number().positive('Amount must be positive'),
  date_issued: z.string().min(1, 'Date issued is required'),
  limit_max: z.number().min(0, 'Limit must be non-negative'),
  deduction_mode: z.enum(['full_balance', 'fixed_installment']),
  installment_amount: z.number().positive('Installment must be positive').nullable().optional(),
})

export const createSalaryAdvanceSchema = salaryAdvanceBaseSchema.refine(
  (data) => data.deduction_mode !== 'fixed_installment' || data.installment_amount != null,
  { message: 'Installment amount is required when deduction mode is fixed_installment', path: ['installment_amount'] }
)

export const updateSalaryAdvanceSchema = salaryAdvanceBaseSchema.partial()

export type CreateSalaryAdvanceInput = z.infer<typeof createSalaryAdvanceSchema>
export type UpdateSalaryAdvanceInput = z.infer<typeof updateSalaryAdvanceSchema>

// --- Payroll: Run ---

export const createPayrollRunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})

export type CreatePayrollRunInput = z.infer<typeof createPayrollRunSchema>

// --- Phase C: Shifts ---

export const createShiftSchema = z.object({
  name: z.string().min(1, 'Shift name is required'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Start time must be HH:MM'),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, 'End time must be HH:MM'),
  standard_hours: z.number().positive('Standard hours must be positive'),
})

export const updateShiftSchema = createShiftSchema.partial()

export type CreateShiftInput = z.infer<typeof createShiftSchema>
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>

export const assignShiftSchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  shift_id: z.number().int().positive().nullable(),
})

export type AssignShiftInput = z.infer<typeof assignShiftSchema>

export const validateClockSchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  timestamp: z.string().min(1, 'Timestamp is required'),
})

export type ValidateClockInput = z.infer<typeof validateClockSchema>

// --- Phase C: Leave ---

export const createLeaveRequestSchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  leave_type: z.enum([LEAVE_TYPE.ANNUAL, LEAVE_TYPE.SICK, LEAVE_TYPE.UNPAID]),
  date_from: z.string().min(1, 'Date from is required'), // YYYY-MM-DD
  date_to: z.string().min(1, 'Date to is required'), // YYYY-MM-DD
  reason: z.string().nullable().optional(),
})

export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>

export const leaveBalanceSchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  year: z.number().int().min(2000).max(2100),
})

export type LeaveBalanceInput = z.infer<typeof leaveBalanceSchema>

export const leaveListSchema = z.object({
  employee_id: z.number().int().positive().optional(),
  status: z.enum([LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED, LEAVE_STATUS.REJECTED]).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
})

export type LeaveListInput = z.infer<typeof leaveListSchema>

// --- Phase C: Late detection ---

export const excuseLateSchema = z.object({
  log_id: z.number().int().positive('Log id is required'),
})

export type ExcuseLateInput = z.infer<typeof excuseLateSchema>

export const lateReportSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})

export type LateReportInput = z.infer<typeof lateReportSchema>

// --- Phase C: Monthly summary / export ---

export const monthlySummarySchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})

export type MonthlySummaryInput = z.infer<typeof monthlySummarySchema>

// --- Phase D1: Company Settings ---

export const updateCompanySettingsSchema = z.object({
  company_name: z.string().optional(),
  sst_number: z.string().optional(),
  brn_number: z.string().optional(),
  bank_account_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  logo_base64: z.string().optional(),  // base64 PNG/JPG
})

export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>

// --- Sync overhaul: attendance exceptions (H2/D5) ---

export const exceptionListSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  employeeId: z.number().int().positive().optional(),
  status: z.enum(['open', 'resolved', 'dismissed']).optional(),
})

export type ExceptionListInput = z.infer<typeof exceptionListSchema>

export const resolveExceptionSchema = z.object({
  id: z.number().int().positive('Exception id is required'),
  note: z.string().optional(),
})

export type ResolveExceptionInput = z.infer<typeof resolveExceptionSchema>

export const dismissExceptionSchema = z.object({
  id: z.number().int().positive('Exception id is required'),
  note: z.string().min(1, 'A note is required when dismissing an exception'),
})

export type DismissExceptionInput = z.infer<typeof dismissExceptionSchema>

export const purgeAttendanceLogsSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  source: z.enum(['all', 'manual', 'device']),
  resyncMode: z.enum(['skip-range', 'full']).default('skip-range'),
})

export type PurgeAttendanceLogsInput = z.infer<typeof purgeAttendanceLogsSchema>
export type AttendanceLogPurgeSource = PurgeAttendanceLogsInput['source']

export const syncFromDeviceSchema = z.object({
  syncFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
})

export type SyncFromDeviceInput = z.infer<typeof syncFromDeviceSchema>

export const computeExceptionsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})

export type ComputeExceptionsInput = z.infer<typeof computeExceptionsSchema>

// --- License activation (docs/LICENSE_INTEGRATION_AUDIT.md) ---

export const sendActivationOtpSchema = z.object({
  email: z.string().email('A valid email is required'),
})

export type SendActivationOtpInput = z.infer<typeof sendActivationOtpSchema>

export const verifyActivationOtpSchema = z.object({
  email: z.string().email('A valid email is required'),
  token: z.string().min(1, 'The code from your email is required'),
})

export type VerifyActivationOtpInput = z.infer<typeof verifyActivationOtpSchema>

// ── Phase 1: Company Calendar ─────────────────────────────────

import { CALENDAR_EVENT_TYPE } from './entities'

export const updateCompanyCalendarProfileSchema = z.object({
  name: z.string().min(1).optional(),
  monday_is_working: z.boolean().optional(),
  tuesday_is_working: z.boolean().optional(),
  wednesday_is_working: z.boolean().optional(),
  thursday_is_working: z.boolean().optional(),
  friday_is_working: z.boolean().optional(),
  saturday_is_working: z.boolean().optional(),
  sunday_is_working: z.boolean().optional(),
})

export type UpdateCompanyCalendarProfileInput = z.infer<typeof updateCompanyCalendarProfileSchema>

export const createCalendarEventSchema = z.object({
  event_type: z.enum([
    CALENDAR_EVENT_TYPE.PUBLIC_HOLIDAY,
    CALENDAR_EVENT_TYPE.COMPANY_HOLIDAY,
    CALENDAR_EVENT_TYPE.SPECIAL_WORKING_DAY,
    CALENDAR_EVENT_TYPE.HALF_DAY,
    CALENDAR_EVENT_TYPE.EMERGENCY_CLOSURE,
    CALENDAR_EVENT_TYPE.COMPANY_EVENT,
  ]),
  name: z.string().min(1, 'Event name is required'),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  description: z.string().nullable().optional(),
  is_recurring: z.boolean().optional(),
})

export const updateCalendarEventSchema = createCalendarEventSchema.partial()

export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>

export const createEmployeeCalendarProfileSchema = z.object({
  employee_id: z.number().int().positive('Employee is required'),
  monday_is_working: z.boolean(),
  tuesday_is_working: z.boolean(),
  wednesday_is_working: z.boolean(),
  thursday_is_working: z.boolean(),
  friday_is_working: z.boolean(),
  saturday_is_working: z.boolean(),
  sunday_is_working: z.boolean(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullable().optional(),
})

export const updateEmployeeCalendarProfileSchema = createEmployeeCalendarProfileSchema.partial()

export type CreateEmployeeCalendarProfileInput = z.infer<typeof createEmployeeCalendarProfileSchema>
export type UpdateEmployeeCalendarProfileInput = z.infer<typeof updateEmployeeCalendarProfileSchema>

// ── Phase 3: Processing Engine ───────────────────────────────

export const triggerProcessingSchema = z.object({
  payroll_period_id: z.number().int().positive('Payroll period is required'),
  employee_ids: z.array(z.number().int().positive()).optional(),
})

export type TriggerProcessingInput = z.infer<typeof triggerProcessingSchema>

// ── Phase 2: Payroll Periods ─────────────────────────────────

export const createPayrollPeriodSchema = z.object({
  name: z.string().min(1, 'Period name is required'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD'),
})

export const updatePayrollPeriodStatusSchema = z.object({
  status: z.enum(['open', 'processing', 'finalized', 'closed']),
  finalized_by: z.number().int().positive().nullable().optional(),
})

export type CreatePayrollPeriodInput = z.infer<typeof createPayrollPeriodSchema>
export type UpdatePayrollPeriodStatusInput = z.infer<typeof updatePayrollPeriodStatusSchema>
