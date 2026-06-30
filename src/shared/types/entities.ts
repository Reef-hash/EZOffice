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
  created_at: string
  updated_at: string
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
  created_at: string
  updated_at: string
}

export interface PayrollSettings {
  id: number
  ot_rule_type: OtRuleType
  ot_rule_value: number
  created_at: string
  updated_at: string
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
