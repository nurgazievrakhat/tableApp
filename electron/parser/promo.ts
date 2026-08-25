/**
 * Разбор колонки «Акция». См. ARCHITECTURE.md §10.
 *
 * Проверено на всех 23 вариантах, встречающихся в прайсе Неман-Фарм:
 *   Скидка: - 20% (10.08.2026-30.09.2026)
 *   Доп Скидка: - 29% При покупке от 3 уп  (01.07.2026-31.08.2026)
 */
export interface Promo {
  /** Безусловная скидка, %. */
  pct: number | null
  from: number | null
  to: number | null
  /** Скидка при покупке от количества. */
  bulkPct: number | null
  bulkMinQty: number | null
}

export const EMPTY_PROMO: Promo = {
  pct: null, from: null, to: null, bulkPct: null, bulkMinQty: null,
}

const RE =
  /(?<extra>доп\s+)?скидка:?\s*[-–—]?\s*(?<pct>\d+(?:[.,]\d+)?)\s*%(?:\s*при\s+покупке\s+от\s+(?<qty>\d+)\s*\S*)?\s*\(\s*(?<from>[\d.]+)\s*[-–—]\s*(?<to>[\d.]+)\s*\)/i

/** «01.07.2026» -> unixepoch (UTC, начало суток). */
function parseDmy(s: string): number | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s.trim())
  if (!m) return null
  const [, d, mo, y] = m
  const year = y.length === 2 ? 2000 + Number(y) : Number(y)
  const date = Date.UTC(year, Number(mo) - 1, Number(d))
  return Number.isFinite(date) ? Math.floor(date / 1000) : null
}

export function parsePromo(raw: unknown): Promo {
  const text = String(raw ?? '').trim()
  if (text === '') return EMPTY_PROMO

  const m = RE.exec(text)
  if (!m?.groups) return EMPTY_PROMO

  const pct = Number(m.groups.pct.replace(',', '.'))
  const from = parseDmy(m.groups.from)
  const to = parseDmy(m.groups.to)
  const isBulk = Boolean(m.groups.extra) || Boolean(m.groups.qty)

  return isBulk
    ? { pct: null, from, to, bulkPct: pct, bulkMinQty: m.groups.qty ? Number(m.groups.qty) : 1 }
    : { pct, from, to, bulkPct: null, bulkMinQty: null }
}

/**
 * Цена с учётом действующих на дату условий. Не хранится в базе, а считается
 * при запросе: скидка привязана к периоду и назавтра истекает сама (§10).
 */
export function effectivePrice(
  price: number | null,
  promo: Pick<Promo, 'pct' | 'from' | 'to'>,
  at: number,
): number | null {
  if (price === null || promo.pct === null) return null
  if (promo.from !== null && at < promo.from) return null
  if (promo.to !== null && at > promo.to + 86_399) return null
  return Math.round(price * (1 - promo.pct / 100) * 100) / 100
}
