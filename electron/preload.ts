// EZOffice preload script — contextBridge-exposed API, fully typed, no `any`.
// The renderer accesses all Main process functionality exclusively through window.api.

import { contextBridge, ipcRenderer } from 'electron'
import type { EzOfficeApi } from '../src/shared/types/api'

const api: EzOfficeApi = {
  admin: {
    init: (username, password) => ipcRenderer.invoke('admin:init', { username, password }),
    login: (username, password) => ipcRenderer.invoke('admin:login', { username, password }),
    logout: (adminId) => ipcRenderer.invoke('admin:logout', adminId),
    validatePassword: (password) => ipcRenderer.invoke('admin:validatePassword', password),
  },
  audit: {
    list: (filters) => ipcRenderer.invoke('audit:list', filters),
  },
  employees: {
    list: () => ipcRenderer.invoke('employees:list'),
    getById: (id) => ipcRenderer.invoke('employees:get', id),
    create: (data) => ipcRenderer.invoke('employees:create', data),
    update: (id, data) => ipcRenderer.invoke('employees:update', id, data),
    delete: (id) => ipcRenderer.invoke('employees:delete', id),
    importCsv: (rows) => ipcRenderer.invoke('employees:importCsv', rows),
  },
  customers: {
    list: () => ipcRenderer.invoke('customers:list'),
    getById: (id) => ipcRenderer.invoke('customers:get', id),
    create: (data) => ipcRenderer.invoke('customers:create', data),
    update: (id, data) => ipcRenderer.invoke('customers:update', id, data),
    delete: (id) => ipcRenderer.invoke('customers:delete', id),
  },
  suppliers: {
    list: () => ipcRenderer.invoke('suppliers:list'),
    getById: (id) => ipcRenderer.invoke('suppliers:get', id),
    create: (data) => ipcRenderer.invoke('suppliers:create', data),
    update: (id, data) => ipcRenderer.invoke('suppliers:update', id, data),
    delete: (id) => ipcRenderer.invoke('suppliers:delete', id),
  },
  products: {
    list: () => ipcRenderer.invoke('products:list'),
    getById: (id) => ipcRenderer.invoke('products:get', id),
    create: (data) => ipcRenderer.invoke('products:create', data),
    update: (id, data) => ipcRenderer.invoke('products:update', id, data),
    delete: (id) => ipcRenderer.invoke('products:delete', id),
  },
  departments: {
    list: () => ipcRenderer.invoke('departments:list'),
    create: (data) => ipcRenderer.invoke('departments:create', data),
  },
  attendance: {
    list: (filters) => ipcRenderer.invoke('attendance:list', filters),
    getById: (id) => ipcRenderer.invoke('attendance:get', id),
    getLastForEmployee: (employeeId) => ipcRenderer.invoke('attendance:getLastForEmployee', employeeId),
    getMonthlySummary: (filters) => ipcRenderer.invoke('attendance:getMonthlySummary', filters),
    clockIn: (employeeId, timestamp) => ipcRenderer.invoke('attendance:clockIn', { employee_id: employeeId, timestamp }),
    clockOut: (employeeId, timestamp) => ipcRenderer.invoke('attendance:clockOut', { employee_id: employeeId, timestamp }),
    create: (data) => ipcRenderer.invoke('attendance:create', data),
    update: (id, data) => ipcRenderer.invoke('attendance:update', id, data),
    delete: (id) => ipcRenderer.invoke('attendance:delete', id),
    syncFromDevice: () => ipcRenderer.invoke('attendance:syncFromDevice'),
    // Phase C — shifts
    listShifts: () => ipcRenderer.invoke('attendance:listShifts'),
    getShiftById: (id) => ipcRenderer.invoke('attendance:getShiftById', id),
    createShift: (data) => ipcRenderer.invoke('attendance:createShift', data),
    updateShift: (id, data) => ipcRenderer.invoke('attendance:updateShift', id, data),
    deleteShift: (id) => ipcRenderer.invoke('attendance:deleteShift', id),
    assignShift: (employeeId, shiftId) => ipcRenderer.invoke('attendance:assignShift', { employee_id: employeeId, shift_id: shiftId }),
    validateClock: (employeeId, timestamp) => ipcRenderer.invoke('attendance:validateClock', { employee_id: employeeId, timestamp }),
    // Phase C — leave
    getLeaveBalance: (employeeId, year) => ipcRenderer.invoke('attendance:getLeaveBalance', { employee_id: employeeId, year }),
    createLeaveRequest: (data) => ipcRenderer.invoke('attendance:createLeaveRequest', data),
    approveLeave: (id) => ipcRenderer.invoke('attendance:approveLeave', id),
    rejectLeave: (id) => ipcRenderer.invoke('attendance:rejectLeave', id),
    listLeave: (filters) => ipcRenderer.invoke('attendance:listLeave', filters),
    // Phase C — late detection
    excuseLate: (logId) => ipcRenderer.invoke('attendance:excuseLate', { log_id: logId }),
    getLateReport: (year, month) => ipcRenderer.invoke('attendance:getLateReport', { year, month }),
    // Phase C — monthly calendar / export
    getMonthlyCalendar: (employeeId, year, month) => ipcRenderer.invoke('attendance:getMonthlyCalendar', { employee_id: employeeId, year, month }),
    exportMonthly: (year, month) => ipcRenderer.invoke('attendance:exportMonthly', { year, month }),
  },
  payroll: {
    salaryStructures: {
      list: (employeeId) => ipcRenderer.invoke('payroll:salaryStructures:list', employeeId),
      getById: (id) => ipcRenderer.invoke('payroll:salaryStructures:get', id),
      getCurrent: (employeeId, asOfDate) => ipcRenderer.invoke('payroll:salaryStructures:getCurrent', employeeId, asOfDate),
      create: (data) => ipcRenderer.invoke('payroll:salaryStructures:create', data),
      update: (id, data) => ipcRenderer.invoke('payroll:salaryStructures:update', id, data),
      delete: (id) => ipcRenderer.invoke('payroll:salaryStructures:delete', id),
    },
    settings: {
      get: () => ipcRenderer.invoke('payroll:settings:get'),
      update: (data) => ipcRenderer.invoke('payroll:settings:update', data),
    },
    epfRates: {
      list: () => ipcRenderer.invoke('payroll:epfRates:list'),
      create: (data) => ipcRenderer.invoke('payroll:epfRates:create', data),
      update: (id, data) => ipcRenderer.invoke('payroll:epfRates:update', id, data),
      delete: (id) => ipcRenderer.invoke('payroll:epfRates:delete', id),
    },
    socsoRates: {
      list: () => ipcRenderer.invoke('payroll:socsoRates:list'),
      create: (data) => ipcRenderer.invoke('payroll:socsoRates:create', data),
      update: (id, data) => ipcRenderer.invoke('payroll:socsoRates:update', id, data),
      delete: (id) => ipcRenderer.invoke('payroll:socsoRates:delete', id),
    },
    eisRates: {
      list: () => ipcRenderer.invoke('payroll:eisRates:list'),
      create: (data) => ipcRenderer.invoke('payroll:eisRates:create', data),
      update: (id, data) => ipcRenderer.invoke('payroll:eisRates:update', id, data),
      delete: (id) => ipcRenderer.invoke('payroll:eisRates:delete', id),
    },
    pcbBrackets: {
      list: () => ipcRenderer.invoke('payroll:pcbBrackets:list'),
      create: (data) => ipcRenderer.invoke('payroll:pcbBrackets:create', data),
      update: (id, data) => ipcRenderer.invoke('payroll:pcbBrackets:update', id, data),
      delete: (id) => ipcRenderer.invoke('payroll:pcbBrackets:delete', id),
    },
    salaryAdvances: {
      list: (employeeId) => ipcRenderer.invoke('payroll:salaryAdvances:list', employeeId),
      getById: (id) => ipcRenderer.invoke('payroll:salaryAdvances:get', id),
      create: (data) => ipcRenderer.invoke('payroll:salaryAdvances:create', data),
      update: (id, data) => ipcRenderer.invoke('payroll:salaryAdvances:update', id, data),
      delete: (id) => ipcRenderer.invoke('payroll:salaryAdvances:delete', id),
    },
    runs: {
      list: () => ipcRenderer.invoke('payroll:runs:list'),
      getById: (id) => ipcRenderer.invoke('payroll:runs:get', id),
      create: (data) => ipcRenderer.invoke('payroll:runs:create', data),
      calculate: (id) => ipcRenderer.invoke('payroll:runs:calculate', id),
      getItems: (runId) => ipcRenderer.invoke('payroll:runs:items', runId),
      checkRateTables: () => ipcRenderer.invoke('payroll:runs:checkRateTables'),
      finalize: (id) => ipcRenderer.invoke('payroll:runs:finalize', id),
      printPayslip: (runId, employeeId) => ipcRenderer.invoke('payroll:runs:printPayslip', runId, employeeId),
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
