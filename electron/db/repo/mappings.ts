import { getDatabase } from '../connection.ts'
import { matchesMask, filenameMask } from '../../parser/signature.ts'
import type { Field } from '../../parser/columns.ts'

export interface Mapping {
  id: number
  supplierId: number
  supplierName: string
  signature: string | null
  filenameMask: string | null
  headerRow: number
  dataStartRow: number | null
  columns: Partial<Record<Field, number>>
  currency: string
  priceMultiplier: number
}

export interface SaveMappingInput {
  id?: number
  supplierName: string
  signature: string | null
  /** Если не задана, main выведет её из fileName. */
  filenameMask?: string | null
  /** Имя файла, из которого выводится маска. */
  fileName?: string
  headerRow: number
  dataStartRow: number | null
  columns: Partial<Record<Field, number>>
  currency?: string
  priceMultiplier?: number
}

interface Row {
  id: number
  supplier_id: number
  supplier_name: string
  signature: string | null
  filename_mask: string | null
  header_row: number
  data_start_row: number | null
  columns_json: string
  currency: string
  price_multiplier: number
}

const SELECT = `
  SELECT m.id, m.supplier_id, s.name AS supplier_name, m.signature, m.filename_mask,
         m.header_row, m.data_start_row, m.columns_json, m.currency, m.price_multiplier
  FROM mappings m JOIN suppliers s ON s.id = m.supplier_id`

function toMapping(r: Row): Mapping {
  return {
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    signature: r.signature,
    filenameMask: r.filename_mask,
    headerRow: r.header_row,
    dataStartRow: r.data_start_row,
    columns: JSON.parse(r.columns_json) as Partial<Record<Field, number>>,
    currency: r.currency,
    priceMultiplier: r.price_multiplier,
  }
}

export function listMappings(): Mapping[] {
  return (getDatabase().prepare(`${SELECT} ORDER BY s.name`).all() as Row[]).map(toMapping)
}

export interface MappingLookup {
  mapping: Mapping | null
  /** Несколько профилей с одним отпечатком — угадывать нельзя, спрашиваем (§9). */
  ambiguous: Mapping[]
}

/**
 * Подбор профиля для файла. Отпечатка заголовков одного мало: выгрузки из 1С
 * у разных поставщиков дают одинаковую шапку, поэтому при совпадении нескольких
 * профилей отсекаем по маске имени файла, а если и она не разводит — не гадаем.
 */
export function findMapping(signature: string | null, filename: string): MappingLookup {
  if (!signature) return { mapping: null, ambiguous: [] }

  const found = (
    getDatabase().prepare(`${SELECT} WHERE m.signature = ?`).all(signature) as Row[]
  ).map(toMapping)

  if (found.length === 0) return { mapping: null, ambiguous: [] }
  if (found.length === 1) return { mapping: found[0], ambiguous: [] }

  const byMask = found.filter((m) => m.filenameMask && matchesMask(filename, m.filenameMask))
  if (byMask.length === 1) return { mapping: byMask[0], ambiguous: [] }

  return { mapping: null, ambiguous: found }
}

export function saveMapping(input: SaveMappingInput, supplierId: number): Mapping {
  const db = getDatabase()
  const columnsJson = JSON.stringify(input.columns)
  // Маска — второй ключ опознания рядом с отпечатком (§9).
  const mask =
    input.filenameMask ?? (input.fileName ? filenameMask(input.fileName) : null)
  const currency = input.currency ?? 'KGS'
  const multiplier = input.priceMultiplier ?? 1.0

  if (input.id !== undefined) {
    db.prepare(
      `UPDATE mappings SET supplier_id = ?, signature = ?, filename_mask = ?,
              header_row = ?, data_start_row = ?, columns_json = ?,
              currency = ?, price_multiplier = ?
       WHERE id = ?`,
    ).run(
      supplierId, input.signature, mask, input.headerRow,
      input.dataStartRow, columnsJson, currency, multiplier, input.id,
    )
    return get(input.id)
  }

  const info = db
    .prepare(
      `INSERT INTO mappings(supplier_id, signature, filename_mask, header_row,
                            data_start_row, columns_json, currency, price_multiplier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      supplierId, input.signature, mask, input.headerRow,
      input.dataStartRow, columnsJson, currency, multiplier,
    )
  return get(Number(info.lastInsertRowid))
}

export function get(id: number): Mapping {
  const row = getDatabase().prepare(`${SELECT} WHERE m.id = ?`).get(id) as Row | undefined
  if (!row) throw new Error(`Профиль ${id} не найден`)
  return toMapping(row)
}

/**
 * Удаление профиля разметки. Позиции и прайсы остаются: профиль описывает
 * только то, как читать файл. Пригождается, когда профиль завели по ошибке
 * или маска имени файла оказалась слишком широкой.
 */
export function removeMapping(id: number): void {
  const info = getDatabase().prepare('DELETE FROM mappings WHERE id = ?').run(id)
  if (info.changes === 0) throw new Error(`Профиль ${id} не найден`)
}
