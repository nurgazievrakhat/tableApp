import type { Field } from './columns.ts'
import { cellText, isBlank, parseNumber } from './values.ts'
import { parseExpiry } from './expiry.ts'

/**
 * Сверка разметки с данными под ней.
 *
 * Заголовок может врать. В прайсе «Медлайф» колонка подписана «ПРОИЗВОДИТЕЛЬ»,
 * а под ней даты; соседняя подписана «СРОК ГОДНОСТИ», а под ней названия
 * заводов. Поверив подписям, приложение молча теряет все сроки годности.
 *
 * Поэтому после разметки смотрим, похожи ли значения на то, чем колонка
 * назначена, и если нет — говорим об этом прямо, не пытаясь угадать.
 */

/** Сколько строк смотрим: этого достаточно, чтобы увидеть характер колонки. */
const SAMPLE = 200
/** Ниже этой доли совпадений считаем, что колонка назначена неверно. */
const THRESHOLD = 0.4

export interface ColumnCheck {
  field: Field
  col: number
  /** Доля значений, похожих на ожидаемый тип, от 0 до 1. */
  match: number
  filled: number
  ok: boolean
  /** Чего ждали в колонке: «даты», «числа», «текст». Фразу собирает интерфейс. */
  expected: string
  message?: string
  /** Колонка, которая подходит под эту роль лучше. */
  betterCol?: number
}

type Predicate = (v: unknown) => boolean

const isNumber: Predicate = (v) => parseNumber(v) !== null
const isDate: Predicate = (v) => parseExpiry(v) !== null
/**
 * Текст, который не является датой.
 *
 * Просто «не число» здесь мало: дата — тоже текст, и колонка, целиком забитая
 * датами, проходила проверку «производитель — это текст». Именно так у
 * «Медлайф» перепутанные подписи оставались наполовину незамеченными.
 */
const isText: Predicate = (v) => {
  const s = cellText(v)
  return s !== '' && parseNumber(v) === null && parseExpiry(v) === null
}

/** Проверяем только те роли, у которых есть внятный признак. */
const EXPECTED: Partial<Record<Field, { test: Predicate; what: string }>> = {
  price: { test: isNumber, what: 'числа' },
  expiry: { test: isDate, what: 'даты' },
  manufacturer: { test: isText, what: 'текст' },
  name: { test: isText, what: 'текст' },
}

function share(grid: unknown[][], from: number, col: number, test: Predicate): {
  match: number
  filled: number
} {
  let filled = 0
  let hits = 0
  for (let r = from; r < grid.length && filled < SAMPLE; r++) {
    const v = grid[r]?.[col]
    if (isBlank(v)) continue
    filled++
    if (test(v)) hits++
  }
  return { match: filled === 0 ? 0 : hits / filled, filled }
}

export function validateMapping(
  grid: unknown[][],
  dataStartRow: number,
  columns: Partial<Record<Field, number>>,
  totalCols: number,
): ColumnCheck[] {
  const entries = (Object.entries(EXPECTED) as [Field, { test: Predicate; what: string }][])
    .filter(([field]) => columns[field] !== undefined)

  // Сначала считаем, какие роли сходятся с данными, и только потом подбираем
  // замену. Колонку, чья роль в порядке, предлагать нельзя: у «Медлайф»
  // «производителю» иначе советовали колонку с названиями товаров — там текста
  // больше всего, но она занята и занята правильно.
  const verdict = new Map<Field, { match: number; filled: number }>()
  for (const [field, expected] of entries) {
    verdict.set(field, share(grid, dataStartRow, columns[field]!, expected.test))
  }

  const settled = new Set<number>()
  for (const [field] of entries) {
    const v = verdict.get(field)!
    if (v.filled > 0 && v.match >= THRESHOLD) settled.add(columns[field]!)
  }

  const checks: ColumnCheck[] = []
  for (const [field, expected] of entries) {
    const col = columns[field]!
    const { match, filled } = verdict.get(field)!

    if (filled === 0) {
      checks.push({
        field, col, match: 0, filled, ok: false,
        expected: expected.what,
        message: 'колонка пустая',
      })
      continue
    }
    if (match >= THRESHOLD) {
      checks.push({ field, col, match, filled, ok: true, expected: expected.what })
      continue
    }

    let betterCol: number | undefined
    let best = THRESHOLD
    for (let c = 0; c < totalCols; c++) {
      if (c === col || settled.has(c)) continue
      const s = share(grid, dataStartRow, c, expected.test)
      if (s.filled > 0 && s.match > best) { best = s.match; betterCol = c }
    }

    checks.push({
      field, col, match, filled, ok: false, betterCol,
      expected: expected.what,
      message: `здесь не ${expected.what}`,
    })
  }

  return checks
}
