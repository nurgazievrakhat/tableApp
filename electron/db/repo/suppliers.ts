import { getDatabase } from '../connection.ts'

export interface Supplier {
  id: number
  name: string
  note: string | null
  priceIncludesVat: number | null
}

interface Row {
  id: number
  name: string
  note: string | null
  price_includes_vat: number | null
}

const toSupplier = (r: Row): Supplier => ({
  id: r.id,
  name: r.name,
  note: r.note,
  priceIncludesVat: r.price_includes_vat,
})

export function listSuppliers(): Supplier[] {
  return (
    getDatabase()
      .prepare('SELECT id, name, note, price_includes_vat FROM suppliers ORDER BY name')
      .all() as Row[]
  ).map(toSupplier)
}

/** Поставщик по имени; создаётся, если его ещё нет. */
export function findOrCreateSupplier(name: string): Supplier {
  const db = getDatabase()
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('Название поставщика не может быть пустым')

  const existing = db
    .prepare('SELECT id, name, note, price_includes_vat FROM suppliers WHERE name = ?')
    .get(trimmed) as Row | undefined
  if (existing) return toSupplier(existing)

  const info = db.prepare('INSERT INTO suppliers(name) VALUES (?)').run(trimmed)
  return { id: Number(info.lastInsertRowid), name: trimmed, note: null, priceIncludesVat: null }
}
