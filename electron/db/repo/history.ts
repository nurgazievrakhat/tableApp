import { getDatabase } from '../connection.ts'

export interface PriceChange {
  at: number
  from: number | null
  to: number | null
  /** Насколько изменилась цена, %. null — если сравнивать не с чем. */
  pct: number | null
}

export interface ItemDetail {
  id: number
  supplierName: string
  name: string
  article: string | null
  price: number | null
  unit: string | null
  stock: string | null
  manufacturer: string | null
  expiry: number | null
  category: string | null
  isActive: boolean
  promoRaw: string | null
  rowNo: number | null
  fileName: string
  filePath: string
  sheet: string
  priceDate: number | null
  /** Все прочие колонки исходного прайса. */
  extra: Record<string, string>
  changes: PriceChange[]
}

/**
 * Собирает изменения цены из истории.
 *
 * В `price_history` лежит цена, которая была ДО изменения. Значит «стало» —
 * это старая цена следующей записи, а для самой последней — текущая цена
 * позиции. Без этого график показывал бы сдвиг на одно изменение.
 */
function toChanges(
  rows: { changed_at: number; price: number | null }[],
  currentPrice: number | null,
): PriceChange[] {
  return rows.map((r, i) => {
    const to = i + 1 < rows.length ? rows[i + 1].price : currentPrice
    const pct =
      r.price !== null && to !== null && r.price > 0
        ? Math.round(((to - r.price) / r.price) * 1000) / 10
        : null
    return { at: r.changed_at, from: r.price, to, pct }
  })
}

export function getItemDetail(itemId: number): ItemDetail {
  const db = getDatabase()

  const row = db
    .prepare(
      `SELECT i.id, s.name AS supplier_name, i.name, i.article, i.price, i.unit_norm, i.unit,
              i.stock, i.manufacturer, i.expiry, i.category, i.is_active, i.promo_raw,
              i.row_no, i.extra_json, f.path, f.sheet,
              (SELECT imp.price_date FROM imports imp WHERE imp.id = i.last_import_id) AS price_date
       FROM items i
       JOIN suppliers s ON s.id = i.supplier_id
       JOIN files f ON f.id = i.file_id
       WHERE i.id = ?`,
    )
    .get(itemId) as
    | {
        id: number
        supplier_name: string
        name: string
        article: string | null
        price: number | null
        unit_norm: string | null
        unit: string | null
        stock: string | null
        manufacturer: string | null
        expiry: number | null
        category: string | null
        is_active: number
        promo_raw: string | null
        row_no: number | null
        extra_json: string | null
        path: string
        sheet: string
        price_date: number | null
      }
    | undefined

  if (!row) throw new Error(`Позиция ${itemId} не найдена`)

  const history = db
    .prepare(
      'SELECT changed_at, price FROM price_history WHERE item_id = ? ORDER BY changed_at ASC',
    )
    .all(itemId) as { changed_at: number; price: number | null }[]

  return {
    id: row.id,
    supplierName: row.supplier_name,
    name: row.name,
    article: row.article,
    price: row.price,
    unit: row.unit_norm ?? row.unit,
    stock: row.stock,
    manufacturer: row.manufacturer,
    expiry: row.expiry,
    category: row.category,
    isActive: row.is_active === 1,
    promoRaw: row.promo_raw,
    rowNo: row.row_no,
    fileName: row.path.split(/[\\/]/).pop() ?? row.path,
    filePath: row.path,
    sheet: row.sheet,
    priceDate: row.price_date,
    extra: row.extra_json ? (JSON.parse(row.extra_json) as Record<string, string>) : {},
    changes: toChanges(history, row.price),
  }
}

export interface ChangeRow {
  itemId: number
  name: string
  supplierName: string
  at: number
  from: number | null
  to: number | null
  pct: number
  unit: string | null
}

export interface ChangesQuery {
  /** Секунды unixepoch; по умолчанию — за последние 30 дней. */
  since?: number
  direction?: 'up' | 'down' | 'all'
  supplierIds?: number[]
  limit?: number
}

export interface ChangesReport {
  rows: ChangeRow[]
  total: number
  up: number
  down: number
  since: number
  elapsedMs: number
}

/**
 * Что подорожало и подешевело за период.
 *
 * «Стало» вычисляется через LEAD: следующая запись истории хранит цену,
 * действовавшую после этого изменения, а если следующей нет — берётся текущая
 * цена позиции.
 */
export function priceChanges(q: ChangesQuery = {}): ChangesReport {
  const started = Date.now()
  const db = getDatabase()
  const since = q.since ?? Math.floor(Date.now() / 1000) - 30 * 86_400
  const direction = q.direction ?? 'all'

  const supplierFilter = q.supplierIds?.length
    ? `AND i.supplier_id IN (${q.supplierIds.map(() => '?').join(',')})`
    : ''

  const sql = `
    WITH steps AS (
      SELECT h.item_id, h.changed_at, h.price AS old_price,
             LEAD(h.price) OVER (PARTITION BY h.item_id ORDER BY h.changed_at) AS next_old
      FROM price_history h
    )
    SELECT st.item_id, st.changed_at, st.old_price,
           COALESCE(st.next_old, i.price) AS new_price,
           i.name, i.unit_norm, i.unit, s.name AS supplier_name
    FROM steps st
    JOIN items i ON i.id = st.item_id
    JOIN suppliers s ON s.id = i.supplier_id
    WHERE st.changed_at >= ?
      AND st.old_price IS NOT NULL AND st.old_price > 0
      AND COALESCE(st.next_old, i.price) IS NOT NULL
      ${supplierFilter}
    ORDER BY st.changed_at DESC`

  const raw = db.prepare(sql).all(since, ...(q.supplierIds ?? [])) as {
    item_id: number
    changed_at: number
    old_price: number
    new_price: number
    name: string
    unit_norm: string | null
    unit: string | null
    supplier_name: string
  }[]

  const all: ChangeRow[] = raw
    .map((r) => ({
      itemId: r.item_id,
      name: r.name,
      supplierName: r.supplier_name,
      at: r.changed_at,
      from: r.old_price,
      to: r.new_price,
      pct: Math.round(((r.new_price - r.old_price) / r.old_price) * 1000) / 10,
      unit: r.unit_norm ?? r.unit,
    }))
    .filter((r) => r.pct !== 0)

  const up = all.filter((r) => r.pct > 0).length
  const down = all.length - up

  const filtered =
    direction === 'all' ? all : all.filter((r) => (direction === 'up' ? r.pct > 0 : r.pct < 0))

  // Самые заметные изменения — наверх: мелкие копеечные правки не важны.
  filtered.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))

  return {
    rows: filtered.slice(0, Math.min(q.limit ?? 200, 1000)),
    total: filtered.length,
    up,
    down,
    since,
    elapsedMs: Date.now() - started,
  }
}
