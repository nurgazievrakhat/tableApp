/** Разбор «грязных» значений из ячеек прайса. Чистые функции, без зависимостей. */

const SPACES = /[\s   ]/g
const CURRENCY = /[₽$€]|\b(?:руб|р|сом|kgs|usd|eur)\.?\b/gi

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

export function isBlank(v: unknown): boolean {
  return cellText(v) === ''
}

/**
 * Строгий разбор числа. Возвращает null для всего, что не является числом
 * целиком: «от 1200», «договорная», «-» и т.п. Такие значения по проекту
 * уходят в extra_json, а цена остаётся пустой.
 *
 * Понимает: 1417,92 · 1 200,50 ₽ · 2 700 (неразрывный пробел) · 1.417,92
 */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v === null || v === undefined) return null
  if (v instanceof Date) return null

  let s = String(v).trim()
  if (s === '') return null

  s = s.replace(CURRENCY, '').replace(SPACES, '')

  const hasDot = s.includes('.')
  const hasComma = s.includes(',')

  if (hasDot && hasComma) {
    // Десятичный разделитель — тот, что стоит правее; второй разделяет тысячи.
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const thousands = decimal === '.' ? ',' : '.'
    s = s.split(thousands).join('')
    if (decimal === ',') s = s.replace(',', '.')
  } else if (hasComma) {
    // «1,234» — почти наверняка тысячи; «1417,92» и «1,5» — дробная часть.
    const tail = s.length - s.lastIndexOf(',') - 1
    s = tail === 3 && /\d,\d{3}$/.test(s) ? s.replace(',', '') : s.replace(',', '.')
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
