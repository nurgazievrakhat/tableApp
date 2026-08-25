import { cellText } from './values.ts'

/**
 * Дата самого прайса. Берётся из файла, а не из mtime: скачанный позже старый
 * прайс не должен выглядеть свежее актуального и портить историю цен (§9).
 *
 * Оба поставщика её проставляют — Неман-Фарм в A1, Фармамир в F1, — но
 * Неман пишет «21,08.2026», с запятой вместо первой точки, поэтому разбор
 * терпим к разделителям.
 */
const DATE_RE = /(\d{1,2})[.,\-/](\d{1,2})[.,\-/](\d{2,4})/

function toEpoch(d: string, m: string, y: string): number | null {
  const day = Number(d)
  const month = Number(m)
  const year = y.length === 2 ? 2000 + Number(y) : Number(y)
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  const ts = Date.UTC(year, month - 1, day)
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : null
}

function fromText(text: string): number | null {
  const m = DATE_RE.exec(text)
  return m ? toEpoch(m[1], m[2], m[3]) : null
}

export interface PriceDateResult {
  date: number | null
  source: 'cell' | 'filename' | 'mtime' | 'none'
}

export function detectPriceDate(
  grid: unknown[][],
  headerRow: number,
  filename: string,
  mtimeSec?: number,
): PriceDateResult {
  // Ищем в преамбуле — там, где поставщик подписывает прайс датой.
  for (let r = 0; r < Math.min(headerRow, grid.length); r++) {
    for (const cell of grid[r] ?? []) {
      if (cell instanceof Date) return { date: Math.floor(cell.getTime() / 1000), source: 'cell' }
      const text = cellText(cell)
      if (text.length > 40) continue // длинный текст — это условия, а не дата
      const found = fromText(text)
      if (found !== null) return { date: found, source: 'cell' }
    }
  }

  const byName = fromText(filename)
  if (byName !== null) return { date: byName, source: 'filename' }

  if (mtimeSec !== undefined) return { date: mtimeSec, source: 'mtime' }
  return { date: null, source: 'none' }
}
