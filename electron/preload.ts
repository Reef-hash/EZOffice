// EZOffice preload script — contextBridge-exposed API, fully typed, no `any`.
// The renderer accesses all Main process functionality exclusively through window.api.

import { contextBridge, ipcRenderer } from 'electron'
import type { EzOfficeApi } from '../src/shared/types/api'

const api: EzOfficeApi = {
  calendar: {
    getCompanyProfile: () => ipcRenderer.invoke('calendar:getCompanyProfile'),
    updateCompanyProfile: (data) => ipcRenderer.invoke('calendar:updateCompanyProfile', data),
    getEmployeeProfile: (employeeId) => ipcRenderer.invoke('calendar:getEmployeeProfile', employeeId),
    setEmployeeProfile: (data) => ipcRenderer.invoke('calendar:setEmployeeProfile', data),
    deleteEmployeeProfile: (employeeId) => ipcRenderer.invoke('calendar:deleteEmployeeProfile', employeeId),
    listEvents: (filters) => ipcRenderer.invoke('calendar:listEvents', filters),
    getEventById: (id) => ipcRenderer.invoke('calendar:getEventById', id),
    createEvent: (data) => ipcRenderer.invoke('calendar:createEvent', data),
    updateEvent: (id, data) => ipcRenderer.invoke('calendar:updateEvent', id, data),
    deleteEvent: (id) => ipcRenderer.invoke('calendar:deleteEvent', id),
    resolveDay: (employeeId, date) => ipcRenderer.invoke('calendar:resolveDay', employeeId, date),
    resolveMonth: (employeeId, year, month) => ipcRenderer.invoke('calendar:resolveMonth', employeeId, year, month),
    resolveAllEmployees: (year, month) => ipcRenderer.invoke('calendar:resolveAllEmployees', year, month),
  },
  admin: {
    init: (username, password) => ipcRenderer.invoke('admin:init', { username, password }),
    login: (username, password) => ipcRenderer.invoke('admin:login', { username, password }),
    logout: (adminId) => ipcRenderer.invoke('admin:logout', adminId),
    validatePassword: (password) => ipcRenderer.invoke('admin:validatePassword', password),
    hasAny: () => ipcRenderer.invoke('admin:hasAny'),
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
    syncFromDevice: (data) => ipcRenderer.invoke('attendance:syncFromDevice', data),
    countLogsForPurge: (data) => ipcRenderer.invoke('attendance:countLogsForPurge', data),
    purgeLogs: (data) => ipcRenderer.invoke('attendance:purgeLogs', data),
    // Device connection (H3 + H4)
    testDevice: () => ipcRenderer.invoke('attendance:testDevice'),
    getDeviceUsers: () => ipcRenderer.invoke('attendance:getDeviceUsers'),
    setDeviceTime: () => ipcRenderer.invoke('attendance:setDeviceTime'),
    getLastSyncLog: () => ipcRenderer.invoke('attendance:getLastSyncLog'),
    // Attendance exceptions (H2/D5)
    computeExceptions: (data) => ipcRenderer.invoke('attendance:computeExceptions', data),
    listExceptions: (data) => ipcRenderer.invoke('attendance:listExceptions', data),
    resolveException: (data) => ipcRenderer.invoke('attendance:resolveException', data),
    dismissException: (data) => ipcRenderer.invoke('attendance:dismissException', data),
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
    // Leave entitlements (2026-07-15) — company defaults + per-employee overrides
    listLeaveEntitlements: (year) => ipcRenderer.invoke('attendance:listLeaveEntitlements', { year }),
    upsertLeaveEntitlement: (data) => ipcRenderer.invoke('attendance:upsertLeaveEntitlement', data),
    initializeYearlyLeaveEntitlements: (year) => ipcRenderer.invoke('attendance:initializeYearlyLeaveEntitlements', { year }),
    // Phase C — late detection
    excuseLate: (logId) => ipcRenderer.invoke('attendance:excuseLate', { log_id: logId }),
    getLateReport: (year, month) => ipcRenderer.invoke('attendance:getLateReport', { year, month }),
    // Phase C — monthly calendar / export
    getMonthlyCalendar: (employeeId, year, month) => ipcRenderer.invoke('attendance:getMonthlyCalendar', { employee_id: employeeId, year, month }),
    exportMonthly: (year, month) => ipcRenderer.invoke('attendance:exportMonthly', { year, month }),
    // Phase 3 — Processing Engine
    triggerProcessing: (data) => ipcRenderer.invoke('attendance:triggerProcessing', data),
    listProcessingRuns: (payrollPeriodId) => ipcRenderer.invoke('attendance:listProcessingRuns', payrollPeriodId),
    getProcessingRun: (id) => ipcRenderer.invoke('attendance:getProcessingRun', id),
    getDailyRecords: (employeeId, dateFrom, dateTo) => ipcRenderer.invoke('attendance:getDailyRecords', employeeId, dateFrom, dateTo),
    getDailyRecordsByPeriod: (payrollPeriodId, employeeId) => ipcRenderer.invoke('attendance:getDailyRecordsByPeriod', payrollPeriodId, employeeId),
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
    periods: {
      list: () => ipcRenderer.invoke('payroll:periods:list'),
      getById: (id) => ipcRenderer.invoke('payroll:periods:get', id),
      create: (data) => ipcRenderer.invoke('payroll:periods:create', data),
      updateStatus: (id, data) => ipcRenderer.invoke('payroll:periods:updateStatus', id, data),
      delete: (id) => ipcRenderer.invoke('payroll:periods:delete', id),
      reopen: (id) => ipcRenderer.invoke('payroll:periods:reopen', id),
    },
  },
  settings: {
    getCompany: () => ipcRenderer.invoke('settings:getCompany'),
    updateCompany: (data) => ipcRenderer.invoke('settings:updateCompany', data),
  },
  export: {
    employees: () => ipcRenderer.invoke('export:employees'),
    payroll: (runId) => ipcRenderer.invoke('export:payroll', runId),
    attendance: (dateFrom, dateTo) => ipcRenderer.invoke('export:attendance', { dateFrom, dateTo }),
  },
  license: {
    getState: () => ipcRenderer.invoke('license:getState'),
    checkGrace: () => ipcRenderer.invoke('license:checkGrace'),
    sendOtp: (data) => ipcRenderer.invoke('license:sendOtp', data),
    verifyOtp: (data) => ipcRenderer.invoke('license:verifyOtp', data),
  },
}

contextBridge.exposeInMainWorld('api', api)
