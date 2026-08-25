import { createHash } from 'node:crypto'
import { headerScore, type Field } from './columns.ts'
import { cellText, isBlank, parseNumber } from './values.ts'
import { normalizeName, normalizeArticle, normalizeUnit } from './normalize.ts'
import { parsePromo, type Promo } from './promo.ts'
import { parseExpiry } from './expiry.ts'
import { isSameHeader, MIN_HEADER_SCORE } from './detectHeader.ts'

export interface ParsedItem {
  rowNo: number
  itemKey: string
  name: string
  nameNorm: string
  article: string | null
  articleNorm: string | null
  price: number | null
  promoRaw: string | null
  promo: Promo
  unit: string | null
  unitNorm: string | null
  stock: string | null
  manufacturer: string | null
  expiry: number | null
  category: string | null
  extraJson: string | null
  extraText: string | null
}

export type SkipReason = 'empty' | 'category' | 'noName' | 'repeatedHeader'

export interface SkippedRow {
  rowNo: number
  reason: SkipReason
  text: string
}

export interface ExtractResult {
  items: ParsedItem[]
  skipped: SkippedRow[]
  categories: string[]
  /** Позиции, у которых название совпало и ключ пришлось развести. */
  collisions: number
}

export interface ExtractOptions {
  grid: unknown[][]
  headers: string[]
  /** Строка заголовков — нужна, чтобы узнавать её повторы ниже по листу. */
  headerRow?: number
  dataStartRow: number
  columns: Partial<Record<Field, number>>
  priceMultiplier?: number
}

const shortHash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)

export function extractRows(opts: ExtractOptions): ExtractResult {
  const { grid, headers, dataStartRow, columns } = opts
  const multiplier = opts.priceMultiplier ?? 1

  const nameCol = columns.name
  if (nameCol === undefined) throw new Error('Не назначена колонка наименования')

  const headerCells = opts.headerRow !== undefined ? (grid[opts.headerRow] ?? []) : []
  const mappedCols = Object.values(columns).filter((c): c is number => c !== undefined)

  const mapped = new Set(Object.values(columns))
  const extraCols = headers
    .map((_, c) => c)
    .filter((c) => !mapped.has(c) && (headers[c] ?? '').trim() !== '')

  const at = (row: unknown[], field: Field): unknown => {
    const c = columns[field]
    return c === undefined ? null : row[c]
  }

  const items: ParsedItem[] = []
  const skipped: SkippedRow[] = []
  const categories: string[] = []
  let currentCategory: string | null = null

  for (let r = dataStartRow; r < grid.length; r++) {
    const row = grid[r] ?? []
    const rowNo = r + 1

    if (row.every(isBlank)) {
      skipped.push({ rowNo, reason: 'empty', text: '' })
      continue
    }

    // Повтор шапки внутри таблицы. Без этой проверки в базу приезжает товар
    // с названием «Наименование» и без цены.
    if (headerCells.length > 0 && isSameHeader(row, headerCells, mappedCols)) {
      skipped.push({ rowNo, reason: 'repeatedHeader', text: cellText(row[nameCol]) })
      continue
    }

    // Чужая шапка — начало другой таблицы. Читать дальше нельзя: у листа
    // может быть продолжение, не имеющее к прайсу отношения.
    if (headerCells.length > 0 && headerScore(row) >= MIN_HEADER_SCORE) break

    const name = cellText(at(row, 'name'))
    if (name === '') {
      skipped.push({ rowNo, reason: 'noName', text: cellText(row.find((c) => !isBlank(c))) })
      continue
    }

    // Строка-категория: кроме названия в строке ничего нет.
    //
    // Проверять «нет цены» мало — товары без цены встречаются (Неман-Фарм,
    // строка 365: есть №, единица и производитель, цены нет).
    //
    // Ячейка, равная названию, тоже считается пустой: у Фармамира заголовок
    // категории объединён на несколько колонок, и разворот merge-диапазона
    // размножает текст по строке.
    const isFiller = (c: number): boolean => isBlank(row[c]) || cellText(row[c]) === name
    const othersEmpty =
      Object.entries(columns).every(([f, c]) => f === 'name' || isFiller(c as number)) &&
      extraCols.every(isFiller)

    if (othersEmpty) {
      currentCategory = name
      categories.push(name)
      skipped.push({ rowNo, reason: 'category', text: name })
      continue
    }

    const rawPrice = parseNumber(at(row, 'price'))
    const article = cellText(at(row, 'article')) || null
    const unit = cellText(at(row, 'unit')) || null
    const promoRaw = cellText(at(row, 'promo')) || null

    const extra: Record<string, string> = {}
    for (const c of extraCols) {
      const v = cellText(row[c])
      if (v !== '') extra[headers[c]] = v
    }
    const extraValues = Object.values(extra)

    items.push({
      rowNo,
      itemKey: '', // проставляется ниже, после разбора всех строк
      name,
      nameNorm: normalizeName(name),
      article,
      articleNorm: article ? normalizeArticle(article) : null,
      price: rawPrice === null ? null : Math.round(rawPrice * multiplier * 100) / 100,
      promoRaw,
      promo: parsePromo(promoRaw),
      unit,
      unitNorm: unit ? normalizeUnit(unit) : null,
      stock: cellText(at(row, 'stock')) || null,
      manufacturer: cellText(at(row, 'manufacturer')) || null,
      expiry: parseExpiry(at(row, 'expiry')),
      category: currentCategory,
      extraJson: extraValues.length ? JSON.stringify(extra) : null,
      extraText: extraValues.length ? extraValues.join(' ') : null,
    })
  }

  const collisions = assignKeys(items)
  return { items, skipped, categories, collisions }
}

/**
 * Стабильный ключ позиции внутри поставщика.
 *
 * Основа — нормализованный артикул, а при его отсутствии название. Срок
 * годности в ключ намеренно не входит: он меняется с каждой поставкой, и
 * позиция при переимпорте выглядела бы новой, обрывая историю цен.
 *
 * Но в прайсах встречаются две строки на один товар — разные партии с разной
 * ценой («ГЕРБИОН ПЛЮЩ» за 390 и за 153 с разными сроками). Их надо сохранить
 * обе, поэтому столкнувшиеся ключи разводятся суффиксом. Порядок суффиксов
 * задаётся ценой, а не позицией в файле: иначе перестановка строк поставщиком
 * приписала бы одной партии историю другой.
 */
function assignKeys(items: ParsedItem[]): number {
  const groups = new Map<string, ParsedItem[]>()
  for (const it of items) {
    const base = it.articleNorm || shortHash(it.nameNorm)
    const group = groups.get(base)
    if (group) group.push(it)
    else groups.set(base, [it])
  }

  let collisions = 0
  for (const [base, group] of groups) {
    if (group.length === 1) {
      group[0].itemKey = base
      continue
    }
    collisions += group.length
    const ordered = [...group].sort(
      (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.rowNo - b.rowNo,
    )
    ordered.forEach((it, i) => { it.itemKey = i === 0 ? base : `${base}#${i + 1}` })
  }
  return collisions
}
