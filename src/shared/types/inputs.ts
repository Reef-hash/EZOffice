// Zod validation schemas for IPC handler input validation.
// Every IPC handler that accepts data must validate through these before calling a service.

import { z } from 'zod'
import { EMPLOYEE_STATUS, ATTENDANCE_TYPE } from './entities'

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
})

export const updateSalaryStructureSchema = createSalaryStructureSchema.partial()

export type CreateSalaryStructureInput = z.infer<typeof createSalaryStructureSchema>
export type UpdateSalaryStructureInput = z.infer<typeof updateSalaryStructureSchema>

// --- Payroll: Settings ---

export const updatePayrollSettingsSchema = z.object({
  ot_rule_type: z.enum(['flat_addition', 'multiplier']).optional(),
  ot_rule_value: z.number().min(0, 'OT value must be non-negative').optional(),
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
