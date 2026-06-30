// Supplier service — CRUD operations via prepared statements.

import type Database from 'better-sqlite3'
import type { Supplier } from '../../../src/shared/types/entities'
import type { CreateSupplierInput, UpdateSupplierInput } from '../../../src/shared/types/inputs'

export function listSuppliers(db: Database.Database): Supplier[] {
  return db
    .prepare('SELECT * FROM suppliers ORDER BY name ASC')
    .all() as Supplier[]
}

export function getSupplierById(db: Database.Database, id: number): Supplier | null {
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Supplier | undefined
  return row ?? null
}

export function createSupplier(db: Database.Database, input: CreateSupplierInput): Supplier {
  const now = new Date().toISOString()
  const stmt = db.prepare(
    `INSERT INTO suppliers (name, contact_person, phone, email, address, created_at, updated_at)
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
  return getSupplierById(db, result.lastInsertRowid as number)!
}

export function updateSupplier(
  db: Database.Database,
  id: number,
  input: UpdateSupplierInput,
): Supplier {
  const existing = getSupplierById(db, id)
  if (!existing) {
    throw new Error(`Supplier with id ${id} not found`)
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
    `UPDATE suppliers
     SET name = @name,
         contact_person = @contact_person,
         phone = @phone,
         email = @email,
         address = @address,
         updated_at = @updated_at
     WHERE id = @id`,
  ).run({ ...merged, updated_at: now, id })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getSupplierById(db, id)!
}

export function deleteSupplier(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Supplier with id ${id} not found`)
  }
}
