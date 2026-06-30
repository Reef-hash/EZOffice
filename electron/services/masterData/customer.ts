// Customer service — CRUD operations via prepared statements.

import type Database from 'better-sqlite3'
import type { Customer } from '../../../src/shared/types/entities'
import type { CreateCustomerInput, UpdateCustomerInput } from '../../../src/shared/types/inputs'

export function listCustomers(db: Database.Database): Customer[] {
  return db
    .prepare('SELECT * FROM customers ORDER BY name ASC')
    .all() as Customer[]
}

export function getCustomerById(db: Database.Database, id: number): Customer | null {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer | undefined
  return row ?? null
}

export function createCustomer(db: Database.Database, input: CreateCustomerInput): Customer {
  const now = new Date().toISOString()
  const stmt = db.prepare(
    `INSERT INTO customers (name, contact_person, phone, email, address, created_at, updated_at)
     VALUES (@name, @contact_person, @phone, @email, @address, @created_at, @updated_at)`,
  )

  const result = stmt.run({
    name: input.name,
    contact_person: input.contact_person ?? null,
    phone: input.phone ?? null,
    email: input.email || null,
    address: input.address ?? null,
    created_at: now,
    updated_at: now,
  })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getCustomerById(db, result.lastInsertRowid as number)!
}

export function updateCustomer(
  db: Database.Database,
  id: number,
  input: UpdateCustomerInput,
): Customer {
  const existing = getCustomerById(db, id)
  if (!existing) {
    throw new Error(`Customer with id ${id} not found`)
  }

  const now = new Date().toISOString()
  const merged = {
    name: input.name ?? existing.name,
    contact_person: input.contact_person !== undefined ? input.contact_person : existing.contact_person,
    phone: input.phone !== undefined ? input.phone : existing.phone,
    email: input.email !== undefined ? (input.email || null) : existing.email,
    address: input.address !== undefined ? input.address : existing.address,
  }

  db.prepare(
    `UPDATE customers
     SET name = @name,
         contact_person = @contact_person,
         phone = @phone,
         email = @email,
         address = @address,
         updated_at = @updated_at
     WHERE id = @id`,
  ).run({ ...merged, updated_at: now, id })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getCustomerById(db, id)!
}

export function deleteCustomer(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Customer with id ${id} not found`)
  }
}
