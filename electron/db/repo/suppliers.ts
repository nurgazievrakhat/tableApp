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

export interface SupplierProfile {
  id: number
  filenameMask: string | null
  headerRow: number
}

export interface SupplierDetails extends Supplier {
  activeItems: number
  totalItems: number
  files: number
  profiles: SupplierProfile[]
}

/** Поставщики с тем, что за ними числится: это нужно перед удалением. */
export function listSupplierDetails(): SupplierDetails[] {
  const db = getDatabase()

  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.note, s.price_includes_vat,
              (SELECT count(*) FROM items i
                WHERE i.supplier_id = s.id AND i.is_active = 1) AS active_items,
              (SELECT count(*) FROM items i WHERE i.supplier_id = s.id) AS total_items,
              (SELECT count(*) FROM files f WHERE f.supplier_id = s.id) AS files
       FROM suppliers s ORDER BY s.name`,
    )
    .all() as (Row & { active_items: number; total_items: number; files: number })[]

  const profiles = db
    .prepare('SELECT id, supplier_id, filename_mask, header_row FROM mappings ORDER BY id')
    .all() as { id: number; supplier_id: number; filename_mask: string | null; header_row: number }[]

  return rows.map((r) => ({
    ...toSupplier(r),
    activeItems: r.active_items,
    totalItems: r.total_items,
    files: r.files,
    profiles: profiles
      .filter((p) => p.supplier_id === r.id)
      .map((p) => ({ id: p.id, filenameMask: p.filename_mask, headerRow: p.header_row })),
  }))
}

/**
 * Переименование поставщика.
 *
 * Имя поставщика задаётся вручную при разметке, и опечатка в нём — самая
 * дешёвая ошибка, которую до сих пор нельзя было исправить иначе как удалив
 * прайс и загрузив заново. Позиции и профили привязаны к id, поэтому
 * переименование их не трогает.
 */
export function renameSupplier(id: number, name: string): Supplier {
  const db = getDatabase()
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('Название поставщика не может быть пустым')

  const clash = db
    .prepare('SELECT id FROM suppliers WHERE name = ? AND id != ?')
    .get(trimmed, id) as { id: number } | undefined
  if (clash) {
    throw new Error(
      `Поставщик «${trimmed}» уже есть. Объединять поставщиков приложение не умеет — ` +
        'выберите другое имя.',
    )
  }

  const info = db.prepare('UPDATE suppliers SET name = ? WHERE id = ?').run(trimmed, id)
  if (info.changes === 0) throw new Error(`Поставщик ${id} не найден`)

  // Возвращаем строку из базы, а не собранную здесь: у поставщика есть ещё
  // заметка и признак НДС, и подставлять вместо них null было бы неправдой.
  const row = db
    .prepare('SELECT id, name, note, price_includes_vat FROM suppliers WHERE id = ?')
    .get(id) as Row
  return toSupplier(row)
}

/**
 * Удаление поставщика вместе со всем, что за ним числится: прайсами,
 * позициями, историей цен и профилями разметки. Всё это уходит каскадом.
 */
export function removeSupplier(id: number): void {
  const info = getDatabase().prepare('DELETE FROM suppliers WHERE id = ?').run(id)
  if (info.changes === 0) throw new Error(`Поставщик ${id} не найден`)
}
