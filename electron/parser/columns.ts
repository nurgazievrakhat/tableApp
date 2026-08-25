/** Классификация колонок прайса по заголовку. См. ARCHITECTURE.md §5, шаг 2. */

export type Field =
  | 'rowNum' | 'name' | 'price' | 'article' | 'unit' | 'stock'
  | 'manufacturer' | 'expiry' | 'promo' | 'vat' | 'packQty'

export interface ColumnMatch {
  col: number       // 0-based
  field: Field
  weight: number
  header: string
}

export interface ColumnMap {
  fields: Partial<Record<Field, number>>  // поле -> индекс колонки
  extra: number[]                          // непонятые колонки, уедут в extra_json
  matches: ColumnMatch[]
}

/**
 * Заголовок к сравнимому виду: «Ед. изм.» и «ед изм» — одно и то же.
 * Символ № сохраняем: без него «№ п/п» превращается в «п п».
 */
export function normHeader(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9%№]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Вес отражает уверенность. Точное совпадение бьёт вхождение подстроки:
 * «Цена за ед.товара с НДС без НСП» содержит и «цена», и «ндс», и без весов
 * попала бы не в ту колонку.
 *
 * Границы слова записаны как (?![а-яa-z]), а не \b: в JavaScript \b работает
 * только по ASCII, поэтому после кириллицы он молча не срабатывает —
 * /^цена\b/ не находит «цена за ед товара».
 */
const PATTERNS: { field: Field; re: RegExp; weight: number }[] = [
  // Наименование
  { field: 'name', re: /^(наименование|товар|название|номенклатура|продукт|описание)$/, weight: 10 },
  { field: 'name', re: /^наименование(?![а-яa-z])/, weight: 9 },
  { field: 'name', re: /(?:^|\s)(наименование|номенклатура)(?![а-яa-z])/, weight: 6 },

  // Цена
  { field: 'price', re: /^(цена|стоимость|прайс|оптовые|опт|розница)$/, weight: 10 },
  { field: 'price', re: /^цена(?![а-яa-z])/, weight: 9 },
  { field: 'price', re: /^(оптов|розничн)/, weight: 8 },
  { field: 'price', re: /(?:^|\s)цена(?![а-яa-z])/, weight: 5 },
  // Цены по форме оплаты: «Наличный», «Безналичный», «Нал.», «Б/нал».
  { field: 'price', re: /^(наличн|безналичн|нал|безнал|б\s*нал)(?![а-яa-z])/, weight: 8 },
  { field: 'price', re: /^(наличн|безналичн)/, weight: 8 },

  // Артикул
  { field: 'article', re: /^(артикул|код|sku|арт)$/, weight: 10 },
  { field: 'article', re: /^(артикул|код товара|кат номер)(?![а-яa-z])/, weight: 8 },

  // Единица измерения
  { field: 'unit', re: /^(ед изм|ед|единица|единица измерения)$/, weight: 10 },
  { field: 'unit', re: /^ед(?![а-яa-z])/, weight: 7 },

  // Остаток. Осторожно с «налич»: «наличие» — это склад, а «наличный» —
  // форма оплаты, и такая колонка содержит цену. У «Прима Интернэшнл» весь
  // прайс держится на колонке «Наличный», и приняв её за остаток, приложение
  // осталось бы вовсе без цен.
  { field: 'stock', re: /^(остаток|наличие|склад|кол во|количество)$/, weight: 10 },
  { field: 'stock', re: /^(остат|наличие|в наличии)/, weight: 8 },

  // Производитель
  { field: 'manufacturer', re: /^(производитель|изготовитель|страна|бренд)$/, weight: 10 },
  { field: 'manufacturer', re: /(производител|изготовител)/, weight: 8 },
  { field: 'manufacturer', re: /^завод(?![а-яa-z])/, weight: 7 },

  // Срок годности
  { field: 'expiry', re: /^(срок годности|годен до)$/, weight: 10 },
  { field: 'expiry', re: /^срок годн/, weight: 9 },
  { field: 'expiry', re: /^ср\s*год/, weight: 8 },
  // «Срок» без уточнения: в прайсе рядом с датами это всегда срок годности.
  { field: 'expiry', re: /^срок$/, weight: 7 },

  // Акция
  { field: 'promo', re: /^(акция|скидка)$/, weight: 10 },
  { field: 'promo', re: /^доп\s*скидка$/, weight: 9 },

  // НДС
  { field: 'vat', re: /^ндс$/, weight: 10 },

  // Количество в упаковке
  { field: 'packQty', re: /^(заводская упаковка|упаковка)$/, weight: 9 },
  { field: 'packQty', re: /^к\s*во в упак/, weight: 9 },
  { field: 'packQty', re: /кол\s*во.*упак/, weight: 8 },

  // Номер строки
  { field: 'rowNum', re: /^(№ п п|№|n п п|no|№№)$/, weight: 10 },
  { field: 'rowNum', re: /^№\s*п/, weight: 9 },
]

/** Лучшее поле для одного заголовка. */
function bestField(header: string): { field: Field; weight: number } | null {
  let best: { field: Field; weight: number } | null = null
  for (const p of PATTERNS) {
    if (!p.re.test(header)) continue
    if (!best || p.weight > best.weight) best = { field: p.field, weight: p.weight }
  }
  return best
}

/**
 * Раскладывает строку заголовков по полям. Если на одно поле претендуют
 * несколько колонок, побеждает та, что увереннее; остальные уходят в extra
 * (так «Без НДС» не отбирает роль цены у «Цена за ед.товара с НДС»).
 */
export function classifyHeader(cells: unknown[]): ColumnMap {
  const matches: ColumnMatch[] = []
  const unmatched: number[] = []

  cells.forEach((cell, col) => {
    const header = normHeader(cell)
    if (header === '') return
    const hit = bestField(header)
    if (hit) matches.push({ col, field: hit.field, weight: hit.weight, header })
    else unmatched.push(col)
  })

  const fields: Partial<Record<Field, number>> = {}
  const taken = new Set<number>()

  for (const m of [...matches].sort((a, b) => b.weight - a.weight)) {
    if (fields[m.field] !== undefined) continue
    fields[m.field] = m.col
    taken.add(m.col)
  }

  // Заголовки уже занятых колонок: по ним отсеиваем артефакты объединённых
  // ячеек. Разворот merge-диапазона копирует и заголовок, и данные, поэтому
  // «Завод - изготовитель» приходит дважды — второй экземпляр не нужен ни как
  // поле, ни в extra_json.
  const takenHeaders = new Set(
    [...taken].map((col) => normHeader(cells[col])).filter((h) => h !== ''),
  )

  const extra = [
    ...unmatched,
    ...matches.filter((m) => !taken.has(m.col)).map((m) => m.col),
  ]
    .filter((col) => !takenHeaders.has(normHeader(cells[col])))
    .sort((a, b) => a - b)

  return { fields, extra, matches }
}

/** Насколько строка похожа на заголовок таблицы: сумма весов уверенных попаданий. */
export function headerScore(cells: unknown[]): number {
  const { matches } = classifyHeader(cells)
  const byField = new Map<Field, number>()
  for (const m of matches) byField.set(m.field, Math.max(byField.get(m.field) ?? 0, m.weight))
  return [...byField.values()].reduce((a, b) => a + b, 0)
}
