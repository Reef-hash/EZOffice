// IPC API interface — the contract between preload (Main process) and renderer.
// The preload implements this via contextBridge; the renderer consumes it via window.api.

import type {
  Employee,
  Customer,
  Supplier,
  Product,
  Department,
  AttendanceLog,
  SalaryStructure,
  PayrollSettings,
  EpfRate,
  SocsoRate,
  EisRate,
  PcbBracket,
  SalaryAdvance,
  PayrollRun,
  PayrollRunItem,
  EmployeeMonthlySummary,
  Shift,
  LeaveRecord,
  LeaveBalance,
  LeaveStatus,
  LateReportRow,
  ClockValidationResult,
  AttendanceMonthlyCalendar,
  CompanySettings,
} from './entities'
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
  CsvEmployeeRow,
  CsvImportResult,
  CreateCustomerInput,
  UpdateCustomerInput,
  CreateSupplierInput,
  UpdateSupplierInput,
  CreateProductInput,
  UpdateProductInput,
  CreateDepartmentInput,
  CreateAttendanceLogInput,
  UpdateAttendanceLogInput,
  CreateSalaryStructureInput,
  UpdateSalaryStructureInput,
  UpdatePayrollSettingsInput,
  CreateEpfRateInput,
  UpdateEpfRateInput,
  CreateSocsoRateInput,
  UpdateSocsoRateInput,
  CreateEisRateInput,
  UpdateEisRateInput,
  CreatePcbBracketInput,
  UpdatePcbBracketInput,
  CreateSalaryAdvanceInput,
  UpdateSalaryAdvanceInput,
  CreatePayrollRunInput,
  CreateShiftInput,
  UpdateShiftInput,
  CreateLeaveRequestInput,
  UpdateCompanySettingsInput,
} from './inputs'

export interface EmployeeApi {
  list: () => Promise<Employee[]>
  getById: (id: number) => Promise<Employee | null>
  create: (data: CreateEmployeeInput) => Promise<Employee>
  update: (id: number, data: UpdateEmployeeInput) => Promise<Employee>
  delete: (id: number) => Promise<void>
  importCsv: (rows: CsvEmployeeRow[]) => Promise<CsvImportResult>
}

export interface CustomerApi {
  list: () => Promise<Customer[]>
  getById: (id: number) => Promise<Customer | null>
  create: (data: CreateCustomerInput) => Promise<Customer>
  update: (id: number, data: UpdateCustomerInput) => Promise<Customer>
  delete: (id: number) => Promise<void>
}

export interface SupplierApi {
  list: () => Promise<Supplier[]>
  getById: (id: number) => Promise<Supplier | null>
  create: (data: CreateSupplierInput) => Promise<Supplier>
  update: (id: number, data: UpdateSupplierInput) => Promise<Supplier>
  delete: (id: number) => Promise<void>
}

export interface ProductApi {
  list: () => Promise<Product[]>
  getById: (id: number) => Promise<Product | null>
  create: (data: CreateProductInput) => Promise<Product>
  update: (id: number, data: UpdateProductInput) => Promise<Product>
  delete: (id: number) => Promise<void>
}

export interface DepartmentApi {
  list: () => Promise<Department[]>
  create: (data: CreateDepartmentInput) => Promise<Department>
}

export interface AdminApi {
  init: (username: string, password: string) => Promise<{ success: boolean; admin?: { id: number; username: string } }>
  login: (username: string, password: string) => Promise<{ success: boolean; adminId?: number }>
  logout: (adminId: number) => Promise<{ success: boolean }>
  validatePassword: (password: string) => Promise<{ valid: boolean; errors: string[] }>
  /** Check if any admin user exists in the database — used to decide login vs signup screen on startup. */
  hasAny: () => Promise<{ hasAdmin: boolean }>
}

export interface AuditEntry {
  id: number
  admin_id: number
  action: 'create' | 'update' | 'delete' | 'login' | 'logout'
  table_name: string | null
  record_id: number | null
  timestamp: string
  details: string | null
}

export interface AuditApi {
  list: (filters?: { adminId?: number; tableName?: string; action?: string; limitDays?: number }) => Promise<AuditEntry[]>
}

export interface DeviceSyncResult {
  inserted: number
  skipped: number
  errors: string[]
}

export interface AttendanceApi {
  list: (filters?: { employeeId?: number; dateFrom?: string; dateTo?: string }) => Promise<AttendanceLog[]>
  getById: (id: number) => Promise<AttendanceLog | null>
  getLastForEmployee: (employeeId: number) => Promise<AttendanceLog | null>
  getMonthlySummary: (filters: { employeeIds?: number[]; year: number; month: number }) => Promise<EmployeeMonthlySummary[]>
  clockIn: (employeeId: number, timestamp?: string) => Promise<AttendanceLog>
  clockOut: (employeeId: number, timestamp?: string) => Promise<AttendanceLog>
  create: (data: CreateAttendanceLogInput) => Promise<AttendanceLog>
  update: (id: number, data: UpdateAttendanceLogInput) => Promise<AttendanceLog>
  delete: (id: number) => Promise<void>
  syncFromDevice: () => Promise<DeviceSyncResult>

  // Phase C — shifts
  listShifts: () => Promise<Shift[]>
  getShiftById: (id: number) => Promise<Shift | null>
  createShift: (data: CreateShiftInput) => Promise<Shift>
  updateShift: (id: number, data: UpdateShiftInput) => Promise<Shift>
  deleteShift: (id: number) => Promise<void>
  assignShift: (employeeId: number, shiftId: number | null) => Promise<Employee>
  validateClock: (employeeId: number, timestamp: string) => Promise<ClockValidationResult>

  // Phase C — leave
  getLeaveBalance: (employeeId: number, year: number) => Promise<LeaveBalance>
  createLeaveRequest: (data: CreateLeaveRequestInput) => Promise<LeaveRecord>
  approveLeave: (id: number) => Promise<LeaveRecord>
  rejectLeave: (id: number) => Promise<LeaveRecord>
  listLeave: (filters?: { employeeId?: number; status?: LeaveStatus; dateFrom?: string; dateTo?: string }) => Promise<LeaveRecord[]>

  // Phase C — late detection
  excuseLate: (logId: number) => Promise<AttendanceLog>
  getLateReport: (year: number, month: number) => Promise<LateReportRow[]>

  // Phase C — monthly calendar / export
  getMonthlyCalendar: (employeeId: number, year: number, month: number) => Promise<AttendanceMonthlyCalendar>
  exportMonthly: (year: number, month: number) => Promise<{ filePath: string; filename: string }>
}

// --- Payroll ---

export interface SalaryStructureApi {
  list: (employeeId?: number) => Promise<SalaryStructure[]>
  getById: (id: number) => Promise<SalaryStructure | null>
  getCurrent: (employeeId: number, asOfDate?: string) => Promise<SalaryStructure | null>
  create: (data: CreateSalaryStructureInput) => Promise<SalaryStructure>
  update: (id: number, data: UpdateSalaryStructureInput) => Promise<SalaryStructure>
  delete: (id: number) => Promise<void>
}

export interface PayrollSettingsApi {
  get: () => Promise<PayrollSettings>
  update: (data: UpdatePayrollSettingsInput) => Promise<PayrollSettings>
}

export interface EpfRateApi {
  list: () => Promise<EpfRate[]>
  create: (data: CreateEpfRateInput) => Promise<EpfRate>
  update: (id: number, data: UpdateEpfRateInput) => Promise<EpfRate>
  delete: (id: number) => Promise<void>
}

export interface SocsoRateApi {
  list: () => Promise<SocsoRate[]>
  create: (data: CreateSocsoRateInput) => Promise<SocsoRate>
  update: (id: number, data: UpdateSocsoRateInput) => Promise<SocsoRate>
  delete: (id: number) => Promise<void>
}

export interface EisRateApi {
  list: () => Promise<EisRate[]>
  create: (data: CreateEisRateInput) => Promise<EisRate>
  update: (id: number, data: UpdateEisRateInput) => Promise<EisRate>
  delete: (id: number) => Promise<void>
}

export interface PcbBracketApi {
  list: () => Promise<PcbBracket[]>
  create: (data: CreatePcbBracketInput) => Promise<PcbBracket>
  update: (id: number, data: UpdatePcbBracketInput) => Promise<PcbBracket>
  delete: (id: number) => Promise<void>
}

export interface SalaryAdvanceApi {
  list: (employeeId?: number) => Promise<SalaryAdvance[]>
  getById: (id: number) => Promise<SalaryAdvance | null>
  create: (data: CreateSalaryAdvanceInput) => Promise<SalaryAdvance>
  update: (id: number, data: UpdateSalaryAdvanceInput) => Promise<SalaryAdvance>
  delete: (id: number) => Promise<void>
}

export interface PayrollRunApi {
  list: () => Promise<PayrollRun[]>
  getById: (id: number) => Promise<PayrollRun | null>
  create: (data: CreatePayrollRunInput) => Promise<PayrollRun>
  calculate: (id: number) => Promise<PayrollRun>
  getItems: (runId: number) => Promise<PayrollRunItem[]>
  checkRateTables: () => Promise<{ missing: string[] }>
  finalize: (id: number) => Promise<PayrollRun>
  printPayslip: (runId: number, employeeId: number) => Promise<{ filePath: string; filename: string }>
}

export interface PayrollApi {
  salaryStructures: SalaryStructureApi
  settings: PayrollSettingsApi
  epfRates: EpfRateApi
  socsoRates: SocsoRateApi
  eisRates: EisRateApi
  pcbBrackets: PcbBracketApi
  salaryAdvances: SalaryAdvanceApi
  runs: PayrollRunApi
}

// Phase D1: Company Settings
export interface SettingsApi {
  getCompany: () => Promise<CompanySettings>
  updateCompany: (data: UpdateCompanySettingsInput) => Promise<CompanySettings>
}

// Phase D3: Data Export
export interface ExportApi {
  employees: () => Promise<{ filePath: string; filename: string }>
  payroll: (runId: number) => Promise<{ filePath: string; filename: string }>
  attendance: (dateFrom: string, dateTo: string) => Promise<{ filePath: string; filename: string }>
}

export interface EzOfficeApi {
  admin: AdminApi
  audit: AuditApi
  employees: EmployeeApi
  customers: CustomerApi
  suppliers: SupplierApi
  products: ProductApi
  departments: DepartmentApi
  attendance: AttendanceApi
  payroll: PayrollApi
  settings: SettingsApi
  export: ExportApi
}
