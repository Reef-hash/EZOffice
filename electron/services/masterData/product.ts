// Product service — CRUD operations via prepared statements.

import type Database from 'better-sqlite3'
import type { Product } from '../../../src/shared/types/entities'
import type { CreateProductInput, UpdateProductInput } from '../../../src/shared/types/inputs'

export function listProducts(db: Database.Database): Product[] {
  return db
    .prepare('SELECT * FROM products ORDER BY name ASC')
    .all() as Product[]
}

export function getProductById(db: Database.Database, id: number): Product | null {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined
  return row ?? null
}

export function createProduct(db: Database.Database, input: CreateProductInput): Product {
  const now = new Date().toISOString()
  const stmt = db.prepare(
    `INSERT INTO products (sku, name, unit_of_measure, default_price, created_at, updated_at)
     VALUES (@sku, @name, @unit_of_measure, @default_price, @created_at, @updated_at)`,
  )

  const result = stmt.run({
    sku: input.sku,
    name: input.name,
    unit_of_measure: input.unit_of_measure,
    default_price: input.default_price,
    created_at: now,
    updated_at: now,
  })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getProductById(db, result.lastInsertRowid as number)!
}

export function updateProduct(
  db: Database.Database,
  id: number,
  input: UpdateProductInput,
): Product {
  const existing = getProductById(db, id)
  if (!existing) {
    throw new Error(`Product with id ${id} not found`)
  }

  const now = new Date().toISOString()
  const merged = {
    sku: input.sku ?? existing.sku,
    name: input.name ?? existing.name,
    unit_of_measure: input.unit_of_measure ?? existing.unit_of_measure,
    default_price: input.default_price ?? existing.default_price,
  }

  db.prepare(
    `UPDATE products
     SET sku = @sku,
         name = @name,
         unit_of_measure = @unit_of_measure,
         default_price = @default_price,
         updated_at = @updated_at
     WHERE id = @id`,
  ).run({ ...merged, updated_at: now, id })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getProductById(db, id)!
}

export function deleteProduct(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error(`Product with id ${id} not found`)
  }
}
