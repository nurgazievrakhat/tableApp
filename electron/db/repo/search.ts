import { getDatabase } from '../connection.ts'
import { normalizeName, normalizeArticle } from '../../parser/normalize.ts'
import { effectivePrice } from '../../parser/promo.ts'
import { correctToken, tokenExists } from './spelling.ts'

/** Потолок выдачи: столько строк уже не читают, а IPC и отрисовка не бесплатны. */
const MAX_LIMIT = 1000

export interface SearchQuery {
  text: string
  supplierIds?: number[]
  minPrice?: number | null
  maxPrice?: number | null
  onlyActive?: boolean
  limit?: number
  offset?: number
}

export interface SearchHit {
  id: number
  productId: number | null
  supplierId: number
  supplierName: string
  name: string
  article: string | null
  price: number | null
  /** Цена с учётом действующей сегодня акции; null — акции нет или истекла. */
  promoPrice: number | null
  promoPct: number | null
  promoTo: number | null
  bulkPrice: number | null
  bulkPct: number | null
  bulkMinQty: number | null
  unit: string | null
  stock: string | null
  manufacturer: string | null
  expiry: number | null
  category: string | null
  isActive: boolean
  rowNo: number | null
  priceDate: number | null
  /** Предыдущая цена, если она менялась. */
  prevPrice: number | null
}

export interface Correction {
  from: string
  to: string
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  elapsedMs: number
  query: string
  /** Что было исправлено в запросе, если сам он ничего не нашёл. */
  corrections: Correction[]
}

/**
 * Запрос пользователя в выражение FTS5.
 *
 * Режем ровно так же, как токенизатор unicode61 режет индекс: по всему, что не
 * буква и не цифра. Символ № при этом исчезает — «№20» и в индексе, и в запросе
 * превращается в «20», так что стороны сходятся.
 *
 * Каждый токен ищется по префиксу: «ввг» должно находить «ВВГнг».
 */
export function queryTokens(text: string): string[] {
  return normalizeName(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== '')
}

// Кавычки экранируются удвоением — иначе токен с кавычкой ломает выражение.
const ftsExpr = (tokens: string[]): string =>
  tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' AND ')

/**
 * Артикул как отдельная ветка запроса.
 *
 * «D-001» режется на токены «d» и «001», а в индексе артикул лежит слитно —
 * «d001». Стороны не сходятся, и вместо нужной позиции выдача забивается всем,
 * где есть слово на «d» и число на «001». Поэтому для запроса, похожего на код
 * (без пробелов и с цифрой), добавляем альтернативу по слитной форме.
 */
function articleAlternative(text: string): string | null {
  const raw = text.trim()
  if (raw === '' || /\s/.test(raw) || !/\d/.test(raw)) return null
  const glued = normalizeArticle(raw).toLowerCase()
  return glued.length >= 3 ? glued : null
}

function expression(tokens: string[], text: string): string {
  const base = ftsExpr(tokens)
  const article = articleAlternative(text)
  if (article === null) return base
  // Ветка лишняя, только если запрос и так одно слово, равное склейке.
  if (tokens.length === 1 && tokens[0] === article) return base
  return `(${base}) OR "${article.replace(/"/g, '""')}"*`
}

/**
 * Правит те слова запроса, которых в прайсах вообще нет. Слово, найденное
 * префиксно, не трогаем: «церебр» — это сокращение, а не опечатка.
 */
function correctTokens(tokens: string[]): { tokens: string[]; corrections: Correction[] } {
  const corrections: Correction[] = []
  const fixed = tokens.map((t) => {
    if (tokenExists(t)) return t
    const better = correctToken(t)
    if (!better) return t
    corrections.push({ from: t, to: better })
    return better
  })
  return { tokens: fixed, corrections }
}

const ITEM_FIELDS = `i.id, i.supplier_id, s.name AS supplier_name, i.name, i.article,
       i.price, i.product_id`

const ITEM_EXTRAS = `i.promo_pct, i.promo_from, i.promo_to, i.bulk_pct, i.bulk_min_qty,
       i.unit, i.unit_norm, i.stock, i.manufacturer, i.expiry, i.category,
       i.is_active, i.row_no,
       (SELECT imp.price_date FROM imports imp WHERE imp.id = i.last_import_id) AS price_date,
       (SELECT h.price FROM price_history h
         WHERE h.item_id = i.id ORDER BY h.changed_at DESC LIMIT 1) AS prev_price`

interface Row {
  id: number
  product_id: number | null
  supplier_id: number
  supplier_name: string
  name: string
  article: string | null
  price: number | null
  promo_pct: number | null
  promo_from: number | null
  promo_to: number | null
  bulk_pct: number | null
  bulk_min_qty: number | null
  unit: string | null
  unit_norm: string | null
  stock: string | null
  manufacturer: string | null
  expiry: number | null
  category: string | null
  is_active: number
  row_no: number | null
  price_date: number | null
  prev_price: number | null
}

function toHit(r: Row, now: number): SearchHit {
  return {
    id: r.id,
    productId: r.product_id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    name: r.name,
    article: r.article,
    price: r.price,
    promoPrice: effectivePrice(r.price, { pct: r.promo_pct, from: r.promo_from, to: r.promo_to }, now),
    promoPct: r.promo_pct,
    promoTo: r.promo_to,
    bulkPrice: effectivePrice(r.price, { pct: r.bulk_pct, from: r.promo_from, to: r.promo_to }, now),
    bulkPct: r.bulk_pct,
    bulkMinQty: r.bulk_min_qty,
    unit: r.unit_norm ?? r.unit,
    stock: r.stock,
    manufacturer: r.manufacturer,
    expiry: r.expiry,
    category: r.category,
    isActive: r.is_active === 1,
    rowNo: r.row_no,
    priceDate: r.price_date,
    prevPrice: r.prev_price,
  }
}

export function search(q: SearchQuery): SearchResult {
  const started = Date.now()
  const db = getDatabase()

  const tokens = queryTokens(q.text)
  if (tokens.length === 0) {
    return { hits: [], total: 0, elapsedMs: Date.now() - started, query: '', corrections: [] }
  }

  let match = expression(tokens, q.text)
  let corrections: Correction[] = []

  const where: string[] = ['items_fts MATCH @match']
  const params: Record<string, unknown> = { match }

  if (q.onlyActive !== false) where.push('i.is_active = 1')
  if (q.supplierIds?.length) {
    where.push(`i.supplier_id IN (${q.supplierIds.map((_, n) => `@s${n}`).join(',')})`)
    q.supplierIds.forEach((id, n) => { params[`s${n}`] = id })
  }
  if (q.minPrice != null) { where.push('i.price >= @minPrice'); params.minPrice = q.minPrice }
  if (q.maxPrice != null) { where.push('i.price <= @maxPrice'); params.maxPrice = q.maxPrice }

  const filter = where.join(' AND ')
  const countStmt = db.prepare(
    `SELECT count(*) AS n FROM items_fts
     JOIN items i ON i.id = items_fts.rowid
     WHERE ${filter}`,
  )

  let total = (countStmt.get(params) as { n: number }).n

  // Ничего не нашлось — пробуем, не опечатка ли это. Исправляем только слова,
  // которых в прайсах нет вовсе, и только если после правки что-то находится.
  if (total === 0) {
    const fixed = correctTokens(tokens)
    if (fixed.corrections.length > 0) {
      const retry = ftsExpr(fixed.tokens)  // при опечатке ветка артикула не нужна
      const retryTotal = (countStmt.get({ ...params, match: retry }) as { n: number }).n
      if (retryTotal > 0) {
        match = retry
        params.match = retry
        corrections = fixed.corrections
        total = retryTotal
      }
    }
  }

  // Точное совпадение артикула — всегда наверх, дальше по релевантности bm25.
  // Позиции без цены уходят в конец: сравнивать по ним нечего.
  const rows = db
    .prepare(
      `SELECT ${ITEM_FIELDS},
              ${ITEM_EXTRAS}
       FROM items_fts
       JOIN items i ON i.id = items_fts.rowid
       JOIN suppliers s ON s.id = i.supplier_id
       WHERE ${filter}
       ORDER BY (i.article_norm IS NOT NULL AND i.article_norm = @exactArticle) DESC,
                (i.price IS NULL) ASC,
                bm25(items_fts) ASC,
                i.price ASC
       LIMIT @limit OFFSET @offset`,
    )
    .all({
      ...params,
      exactArticle: normalizeArticle(q.text) || ' ',
      limit: Math.min(q.limit ?? 200, MAX_LIMIT),
      offset: q.offset ?? 0,
    }) as Row[]

  const now = Math.floor(Date.now() / 1000)
  return {
    hits: rows.map((r) => toHit(r, now)),
    total,
    elapsedMs: Date.now() - started,
    query: match,
    corrections,
  }
}

export interface ProductGroup {
  productId: number
  title: string
  supplierCount: number
  minPrice: number | null
  maxPrice: number | null
  /** На сколько процентов дороже самого дешёвого предложения самое дорогое. */
  spreadPct: number | null
  /**
   * Единицы измерения у предложений разошлись — цены напрямую не сравнимы.
   * Реальный случай: «ПАРАЦЕТАМОЛ 200МГ №10» идёт у одного поставщика за
   * пластину, у другого за упаковку, и разница в 48% ничего не значит.
   */
  unitsDiffer: boolean
  offers: SearchHit[]
}

export interface GroupedResult {
  groups: ProductGroup[]
  /** Сколько товаров (не позиций) нашлось всего. */
  total: number
  elapsedMs: number
  query: string
  corrections: Correction[]
  onlyMulti: boolean
}

/**
 * Поиск в режиме сравнения: одна строка на товар, предложения всех поставщиков
 * внутри (ARCHITECTURE.md §7, §11).
 *
 * Предложения добираются по товару целиком, а не только по совпавшим позициям:
 * иначе у товара, найденного по названию одного поставщика, соседние
 * предложения оказались бы за бортом, и сравнивать было бы не с чем.
 */
export function searchGrouped(
  q: SearchQuery & { onlyMulti?: boolean },
): GroupedResult {
  const started = Date.now()
  const db = getDatabase()

  const flat = search({ ...q, limit: Math.min(Math.max(q.limit ?? 200, 400), MAX_LIMIT) })
  if (flat.hits.length === 0) {
    return {
      groups: [], total: 0, elapsedMs: Date.now() - started,
      query: flat.query, corrections: flat.corrections, onlyMulti: q.onlyMulti ?? false,
    }
  }

  // Порядок товаров — по первому появлению в ранжированной выдаче позиций.
  const order: number[] = []
  const seen = new Set<number>()
  for (const h of flat.hits) {
    if (h.productId === null || seen.has(h.productId)) continue
    seen.add(h.productId)
    order.push(h.productId)
  }
  if (order.length === 0) {
    return {
      groups: [], total: 0, elapsedMs: Date.now() - started,
      query: flat.query, corrections: flat.corrections, onlyMulti: q.onlyMulti ?? false,
    }
  }

  const placeholders = order.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT ${ITEM_FIELDS},
              ${ITEM_EXTRAS}
       FROM items i
       JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.product_id IN (${placeholders})
         AND i.is_active = 1
       ORDER BY (i.price IS NULL) ASC, i.price ASC`,
    )
    .all(...order) as Row[]

  const now = Math.floor(Date.now() / 1000)
  const titles = new Map(
    (
      db
        .prepare(`SELECT id, title FROM products WHERE id IN (${placeholders})`)
        .all(...order) as { id: number; title: string }[]
    ).map((p) => [p.id, p.title]),
  )

  const byProduct = new Map<number, SearchHit[]>()
  for (const r of rows) {
    if (r.product_id === null) continue
    const list = byProduct.get(r.product_id)
    if (list) list.push(toHit(r, now))
    else byProduct.set(r.product_id, [toHit(r, now)])
  }

  const groups: ProductGroup[] = []
  for (const productId of order) {
    const offers = byProduct.get(productId)
    if (!offers || offers.length === 0) continue

    const suppliers = new Set(offers.map((o) => o.supplierId))
    if (q.onlyMulti && suppliers.size < 2) continue

    const prices = offers.map((o) => o.price).filter((p): p is number => p !== null)
    const minPrice = prices.length ? Math.min(...prices) : null
    const maxPrice = prices.length ? Math.max(...prices) : null

    const units = new Set(offers.map((o) => o.unit).filter((u): u is string => !!u))

    groups.push({
      productId,
      title: titles.get(productId) ?? offers[0].name,
      supplierCount: suppliers.size,
      minPrice,
      maxPrice,
      spreadPct:
        minPrice !== null && maxPrice !== null && minPrice > 0
          ? Math.round(((maxPrice - minPrice) / minPrice) * 100)
          : null,
      unitsDiffer: units.size > 1,
      offers,
    })
  }

  const limit = Math.min(q.limit ?? 200, MAX_LIMIT)
  return {
    groups: groups.slice(0, limit),
    total: groups.length,
    elapsedMs: Date.now() - started,
    query: flat.query,
    corrections: flat.corrections,
    onlyMulti: q.onlyMulti ?? false,
  }
}
