import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getDatabase } from '../connection.ts'

/**
 * Состояние файла на диске относительно того, что лежит в базе.
 *
 * `touched` — файл пересохранён, но содержимое прежнее: так бывает, когда
 * прайс просто открыли в Excel. Переимпорт в этом случае ничего не изменит,
 * и подсвечивать его как «изменился» было бы ложной тревогой.
 *
 * `superseded` — прайс того же поставщика загружен более свежим файлом, и все
 * позиции перешли к нему. Запись остаётся как след загрузки, но показывать её
 * просто как «0 позиций» значило бы пугать пользователя: за месяц таких строк
 * накопится по одной на каждую неделю.
 */
export type SourceStatus = 'ok' | 'changed' | 'touched' | 'missing' | 'superseded'

export interface Source {
  fileId: number
  supplierId: number
  supplierName: string
  path: string
  fileName: string
  sheet: string
  mappingId: number | null
  lastImportAt: number | null
  priceDate: number | null
  itemsTotal: number
  itemsActive: number
  status: SourceStatus
  /** Размер файла на диске; null, если файла нет. */
  sizeBytes: number | null
}

interface Row {
  file_id: number
  supplier_id: number
  supplier_name: string
  path: string
  sheet: string
  file_hash: string | null
  mtime: number | null
  mapping_id: number | null
  last_import_at: number | null
  price_date: number | null
  items_total: number
  items_active: number
  supplier_active: number
}

const SELECT = `
  SELECT f.id AS file_id, f.supplier_id, s.name AS supplier_name,
         f.path, f.sheet, f.file_hash, f.mtime, f.mapping_id,
         (SELECT max(imp.imported_at) FROM imports imp WHERE imp.file_id = f.id) AS last_import_at,
         (SELECT imp.price_date FROM imports imp WHERE imp.file_id = f.id
           ORDER BY imp.imported_at DESC LIMIT 1) AS price_date,
         (SELECT count(*) FROM items it WHERE it.file_id = f.id) AS items_total,
         (SELECT count(*) FROM items it WHERE it.file_id = f.id AND it.is_active = 1) AS items_active,
         (SELECT count(*) FROM items it
           WHERE it.supplier_id = f.supplier_id AND it.is_active = 1) AS supplier_active
  FROM files f
  JOIN suppliers s ON s.id = f.supplier_id`

/**
 * Сравнение с диском. Сначала смотрим mtime — это бесплатно; хешируем только
 * когда время правки разошлось, чтобы отличить настоящую правку от пересохранения.
 */
function inspect(row: Row): { status: SourceStatus; sizeBytes: number | null } {
  let st: fs.Stats
  try {
    st = fs.statSync(row.path)
  } catch {
    return { status: 'missing', sizeBytes: null }
  }

  const mtime = Math.floor(st.mtimeMs / 1000)
  if (row.mtime !== null && mtime === row.mtime) {
    return { status: 'ok', sizeBytes: st.size }
  }

  const hash = createHash('sha1').update(fs.readFileSync(row.path)).digest('hex')
  return {
    status: hash === row.file_hash ? 'touched' : 'changed',
    sizeBytes: st.size,
  }
}

function toSource(row: Row): Source {
  const disk = inspect(row)

  // Позиции ушли к более свежему прайсу того же поставщика. Смотрим именно на
  // активные: за старым файлом обычно остаётся хвост погашенных строк — тех,
  // что пропали из нового прайса, — и по общему счётчику он выглядел бы живым.
  const superseded =
    row.items_active === 0 && row.supplier_active > 0 && disk.status !== 'missing'

  return {
    fileId: row.file_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    path: row.path,
    fileName: path.basename(row.path),
    sheet: row.sheet,
    mappingId: row.mapping_id,
    lastImportAt: row.last_import_at,
    priceDate: row.price_date,
    itemsTotal: row.items_total,
    itemsActive: row.items_active,
    status: superseded ? 'superseded' : disk.status,
    sizeBytes: disk.sizeBytes,
  }
}

export function listSources(): Source[] {
  const rows = getDatabase()
    .prepare(`${SELECT} ORDER BY s.name, f.path`)
    .all() as Row[]
  return rows.map(toSource)
}

export function getSource(fileId: number): Source {
  const row = getDatabase().prepare(`${SELECT} WHERE f.id = ?`).get(fileId) as Row | undefined
  if (!row) throw new Error(`Источник ${fileId} не найден`)
  return toSource(row)
}

/**
 * Удаляет источник вместе с его позициями и историей — за это отвечает
 * ON DELETE CASCADE. Профиль поставщика остаётся: он привязан к формату файла,
 * а не к конкретной загрузке, и пригодится при следующем импорте.
 */
export function removeSource(fileId: number): void {
  getDatabase().prepare('DELETE FROM files WHERE id = ?').run(fileId)
}
