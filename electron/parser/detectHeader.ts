import { classifyHeader, headerScore, normHeader, type ColumnMap } from './columns.ts'
import { isBlank, parseNumber } from './values.ts'

/** Минимальная уверенность, чтобы строку вообще считать кандидатом в заголовки. */
export const MIN_HEADER_SCORE = 18
/**
 * Сколько подряд содержательных «не-товарных» строк терпим внутри таблицы —
 * заголовков разделов, примечаний.
 *
 * Пустые строки в этот счёт не идут: они ничего не говорят о том, что таблица
 * кончилась. У «Лектос» посреди прайса стоят 19 пустых строк подряд, и по
 * прежнему правилу блок обрывался на них, теряя 763 позиции из 1320.
 */
const MAX_GAP = 12

export interface HeaderCandidate {
  row: number            // 0-based
  score: number
  dataRows: number       // сколько строк-товаров под ней насчитали
  lastDataRow: number
  map: ColumnMap
}

export interface HeaderDetection {
  headerRow: number | null
  dataStartRow: number | null
  map: ColumnMap | null
  chosen: HeaderCandidate | null
  /** Все кандидаты, отсортированы как рассматривались. Показываем в UI. */
  candidates: HeaderCandidate[]
}

/**
 * Та же самая шапка, повторённая ниже по листу.
 *
 * Поставщики дублируют строку заголовков через каждые несколько десятков
 * строк — чтобы её было видно при прокрутке и на печати. Такая строка не
 * начинает новую таблицу, а продолжает текущую: в прайсе Бимед-Фарма
 * нумерация позиций проходит через повтор насквозь.
 */
export function isSameHeader(
  row: unknown[],
  header: unknown[],
  /** Колонки, которые реально размечены. Если заданы, сверяем только их. */
  cols?: number[],
): boolean {
  // Сверять всю строку целиком нельзя: у «Лектос» одна и та же шапка в разных
  // секциях идёт то с колонкой «Уп», то без неё. Значимо совпадение тех
  // колонок, которые мы читаем, — это и есть структура таблицы.
  if (cols && cols.length >= 2) {
    return cols.every((c) => {
      const a = normHeader(row[c])
      return a !== '' && a === normHeader(header[c])
    })
  }

  const a = row.map(normHeader).filter((x) => x !== '')
  const b = header.map(normHeader).filter((x) => x !== '')
  return a.length > 0 && a.length === b.length && a.every((x, i) => x === b[i])
}

/** Дёшево отсекаем строки данных до дорогой проверки по словарю. */
function looksNumeric(row: unknown[]): boolean {
  let filled = 0
  let numeric = 0
  for (const cell of row) {
    if (isBlank(cell)) continue
    filled++
    if (parseNumber(cell) !== null) numeric++
  }
  return filled > 0 && numeric / filled > 0.4
}

/**
 * Длина блока товаров под заголовком.
 *
 * Ключевая деталь: блок обрывается на следующей строке-заголовке. Без этого
 * акционная таблица в преамбуле «перетекала» бы через разрыв в настоящий прайс
 * и получала бы его длину — а вместе с ней и победу.
 */
function measureDataRun(
  grid: unknown[][],
  headerRow: number,
  map: ColumnMap,
): { rows: number; lastRow: number } {
  const headerCells = grid[headerRow] ?? []
  const mappedCols = Object.values(map.fields).filter((c): c is number => c !== undefined)
  const nameCol = map.fields.name
  const priceCol = map.fields.price
  if (nameCol === undefined) return { rows: 0, lastRow: headerRow }

  let hits = 0
  let lastRow = headerRow
  let gap = 0

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? []

    // Повтор той же шапки — не конец таблицы, а служебная строка внутри неё.
    if (isSameHeader(row, headerCells, mappedCols)) continue

    // Другая шапка — начало другой таблицы.
    if (!looksNumeric(row) && headerScore(row) >= MIN_HEADER_SCORE) break

    const hasName = !isBlank(row[nameCol])
    const hasPrice =
      priceCol !== undefined
        ? parseNumber(row[priceCol]) !== null
        : row.some((c) => parseNumber(c) !== null)

    if (hasName && hasPrice) {
      hits++
      lastRow = r
      gap = 0
    } else if (row.every(isBlank)) {
      continue
    } else if (++gap > MAX_GAP) {
      break
    }
  }

  return { rows: hits, lastRow }
}

/**
 * Ищет строку заголовков настоящего прайса.
 *
 * Правило «первая строка, похожая на заголовок» неверно: в прайсе Неман-Фарм
 * преамбула на 262 строки содержит три акционные таблицы со своими шапками.
 * Побеждает та шапка, под которой самый длинный блок товаров — настоящий прайс
 * это тысячи строк, ловушки — десятки.
 */
export function detectHeader(grid: unknown[][]): HeaderDetection {
  const candidates: HeaderCandidate[] = []

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    if (row.length === 0 || looksNumeric(row)) continue

    const score = headerScore(row)
    if (score < MIN_HEADER_SCORE) continue

    const map = classifyHeader(row)
    if (map.fields.name === undefined) continue // без названия таблица бессмысленна

    const { rows, lastRow } = measureDataRun(grid, r, map)
    candidates.push({ row: r, score, dataRows: rows, lastDataRow: lastRow, map })
  }

  const ranked = [...candidates].sort(
    (a, b) => b.dataRows - a.dataRows || b.score - a.score || a.row - b.row,
  )
  const chosen = ranked[0] ?? null

  return {
    headerRow: chosen?.row ?? null,
    dataStartRow: chosen ? chosen.row + 1 : null,
    map: chosen?.map ?? null,
    chosen,
    candidates: ranked,
  }
}

/**
 * Собирает описание для заданной вручную строки заголовков.
 * Нужно, когда пользователь поправил автоопределение или когда применяется
 * сохранённый профиль поставщика — там строка известна заранее.
 */
export function forceHeader(grid: unknown[][], headerRow: number): HeaderDetection {
  const auto = detectHeader(grid)
  const row = grid[headerRow] ?? []
  const map = classifyHeader(row)
  const { rows, lastRow } = measureDataRun(grid, headerRow, map)
  const chosen: HeaderCandidate = {
    row: headerRow, score: headerScore(row), dataRows: rows, lastDataRow: lastRow, map,
  }

  // Автокандидатов сохраняем: пользователь должен видеть, от чего отказался.
  const candidates = [chosen, ...auto.candidates.filter((c) => c.row !== headerRow)]

  return {
    headerRow, dataStartRow: headerRow + 1, map, chosen, candidates,
  }
}
