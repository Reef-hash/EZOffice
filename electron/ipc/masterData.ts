// Master Data IPC handlers — thin handlers: validate input → call service → return result.
// All validation uses Zod schemas. Every catch re-throws with context — no silent failures.

import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  createEmployeeWithShiftSchema,
  updateEmployeeWithShiftSchema,
  csvEmployeeRowSchema,
  createCustomerSchema,
  updateCustomerSchema,
  createSupplierSchema,
  updateSupplierSchema,
  createProductSchema,
  updateProductSchema,
  createDepartmentSchema,
} from '../../src/shared/types/inputs'
import * as employeeService from '../services/masterData/employee'
import * as customerService from '../services/masterData/customer'
import * as supplierService from '../services/masterData/supplier'
import * as productService from '../services/masterData/product'
import * as departmentService from '../services/masterData/department'

export function registerMasterDataHandlers(db: Database.Database): void {
  // ── Employees ──────────────────────────────────────────

  ipcMain.handle('employees:list', async () => {
    try {
      return employeeService.listEmployees(db)
    } catch (err) {
      throw new Error(`Failed to list employees: ${String(err)}`)
    }
  })

  ipcMain.handle('employees:get', async (_event, id: number) => {
    try {
      return employeeService.getEmployeeById(db, id)
    } catch (err) {
      throw new Error(`Failed to get employee ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('employees:create', async (_event, data: unknown) => {
    try {
      const input = createEmployeeWithShiftSchema.parse(data)
      return employeeService.createEmployee(db, input)
    } catch (err) {
      throw new Error(`Failed to create employee: ${String(err)}`)
    }
  })

  ipcMain.handle('employees:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateEmployeeWithShiftSchema.parse(data)
      return employeeService.updateEmployee(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update employee ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('employees:delete', async (_event, id: number) => {
    try {
      return employeeService.deleteEmployee(db, id)
    } catch (err) {
      throw new Error(`Failed to delete employee ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('employees:importCsv', async (_event, rows: unknown) => {
    try {
      const parsed = csvEmployeeRowSchema.array().parse(rows)
      return employeeService.importEmployeesCsv(db, parsed)
    } catch (err) {
      throw new Error(`Failed to import CSV: ${String(err)}`)
    }
  })

  // ── Customers ──────────────────────────────────────────

  ipcMain.handle('customers:list', async () => {
    try {
      return customerService.listCustomers(db)
    } catch (err) {
      throw new Error(`Failed to list customers: ${String(err)}`)
    }
  })

  ipcMain.handle('customers:get', async (_event, id: number) => {
    try {
      return customerService.getCustomerById(db, id)
    } catch (err) {
      throw new Error(`Failed to get customer ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('customers:create', async (_event, data: unknown) => {
    try {
      const input = createCustomerSchema.parse(data)
      return customerService.createCustomer(db, input)
    } catch (err) {
      throw new Error(`Failed to create customer: ${String(err)}`)
    }
  })

  ipcMain.handle('customers:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateCustomerSchema.parse(data)
      return customerService.updateCustomer(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update customer ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('customers:delete', async (_event, id: number) => {
    try {
      return customerService.deleteCustomer(db, id)
    } catch (err) {
      throw new Error(`Failed to delete customer ${id}: ${String(err)}`)
    }
  })

  // ── Suppliers ──────────────────────────────────────────

  ipcMain.handle('suppliers:list', async () => {
    try {
      return supplierService.listSuppliers(db)
    } catch (err) {
      throw new Error(`Failed to list suppliers: ${String(err)}`)
    }
  })

  ipcMain.handle('suppliers:get', async (_event, id: number) => {
    try {
      return supplierService.getSupplierById(db, id)
    } catch (err) {
      throw new Error(`Failed to get supplier ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('suppliers:create', async (_event, data: unknown) => {
    try {
      const input = createSupplierSchema.parse(data)
      return supplierService.createSupplier(db, input)
    } catch (err) {
      throw new Error(`Failed to create supplier: ${String(err)}`)
    }
  })

  ipcMain.handle('suppliers:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateSupplierSchema.parse(data)
      return supplierService.updateSupplier(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update supplier ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('suppliers:delete', async (_event, id: number) => {
    try {
      return supplierService.deleteSupplier(db, id)
    } catch (err) {
      throw new Error(`Failed to delete supplier ${id}: ${String(err)}`)
    }
  })

  // ── Products ───────────────────────────────────────────

  ipcMain.handle('products:list', async () => {
    try {
      return productService.listProducts(db)
    } catch (err) {
      throw new Error(`Failed to list products: ${String(err)}`)
    }
  })

  ipcMain.handle('products:get', async (_event, id: number) => {
    try {
      return productService.getProductById(db, id)
    } catch (err) {
      throw new Error(`Failed to get product ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('products:create', async (_event, data: unknown) => {
    try {
      const input = createProductSchema.parse(data)
      return productService.createProduct(db, input)
    } catch (err) {
      throw new Error(`Failed to create product: ${String(err)}`)
    }
  })

  ipcMain.handle('products:update', async (_event, id: number, data: unknown) => {
    try {
      const input = updateProductSchema.parse(data)
      return productService.updateProduct(db, id, input)
    } catch (err) {
      throw new Error(`Failed to update product ${id}: ${String(err)}`)
    }
  })

  ipcMain.handle('products:delete', async (_event, id: number) => {
    try {
      return productService.deleteProduct(db, id)
    } catch (err) {
      throw new Error(`Failed to delete product ${id}: ${String(err)}`)
    }
  })

  // ── Departments ────────────────────────────────────────

  ipcMain.handle('departments:list', async () => {
    try {
      return departmentService.listDepartments(db)
    } catch (err) {
      throw new Error(`Failed to list departments: ${String(err)}`)
    }
  })

  ipcMain.handle('departments:create', async (_event, data: unknown) => {
    try {
      const input = createDepartmentSchema.parse(data)
      return departmentService.createDepartment(db, input)
    } catch (err) {
      throw new Error(`Failed to create department: ${String(err)}`)
    }
  })
}
