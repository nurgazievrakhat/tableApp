import * as XLSX from 'xlsx'
import * as cptable from 'xlsx/dist/cpexcel.full.mjs'
import fs from 'node:fs'

/**
 * Таблица кодовых страниц для старых .xls.
 *
 * BIFF хранит строки в кодировке, указанной в записи CODEPAGE. Без этой
 * таблицы SheetJS читает их как Latin-1, и «ОсОО "БИМЕД Фарм"» превращается
 * в «ÎñÎÎ "ÁÈÌÅÄ Ôàðì"». Детектор заголовков после такого не находит ничего:
 * он ищет «Наименование», а в ячейке абракадабра.
 *
 * Из шести присланных прайсов три оказались в CP1251.
 */
XLSX.set_cptable(cptable)
import { detectHeader, forceHeader, type HeaderDetection } from './detectHeader.ts'

export interface SheetSummary {
  name: string
  rows: number
  cols: number
}

export interface SheetPreview {
  sheet: string
  rows: number
  cols: number
  /** Строки листа целиком (0-based). Для UI режем на стороне вызывающего. */
  grid: unknown[][]
  detection: HeaderDetection
}

/**
 * Разворачивает объединённые ячейки: SheetJS отдаёт значение только в левой
 * верхней ячейке диапазона, остальные приходят пустыми. В прайсе Неман-Фарм
 * таких диапазонов 312 — все в преамбуле, но у других поставщиков они
 * встречаются и внутри таблицы.
 */
function fillMerges(ws: XLSX.WorkSheet, grid: unknown[][]): void {
  for (const m of ws['!merges'] ?? []) {
    const value = grid[m.s.r]?.[m.s.c]
    if (value === null || value === undefined) continue
    for (let r = m.s.r; r <= m.e.r; r++) {
      const row = (grid[r] ??= [])
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue
        row[c] = value
      }
    }
  }
}

function toGrid(ws: XLSX.WorkSheet): unknown[][] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  })
  fillMerges(ws, grid)
  return grid
}

export function readWorkbook(path: string): XLSX.WorkBook {
  // Читаем файл сами, а не через XLSX.readFile: ESM-сборка SheetJS не имеет
  // доступа к fs. Заодно одинаково работает в Node, воркере и Electron.
  return readWorkbookBuffer(fs.readFileSync(path))
}

export function readWorkbookBuffer(buf: Buffer): XLSX.WorkBook {
  // sheetStubs — чтобы пустые ячейки не схлопывались и индексы колонок не ехали.
  return XLSX.read(buf, { type: 'buffer', cellDates: true, sheetStubs: true })
}

export function listSheets(wb: XLSX.WorkBook): SheetSummary[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    const ref = ws?.['!ref']
    const range = ref ? XLSX.utils.decode_range(ref) : null
    return {
      name,
      rows: range ? range.e.r - range.s.r + 1 : 0,
      cols: range ? range.e.c - range.s.c + 1 : 0,
    }
  })
}

export function readSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  headerRow?: number,
): SheetPreview {
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`Лист «${sheetName}» не найден`)

  const grid = toGrid(ws)
  const cols = grid.reduce((max, row) => Math.max(max, row?.length ?? 0), 0)

  return {
    sheet: sheetName,
    rows: grid.length,
    cols,
    grid,
    detection: headerRow === undefined ? detectHeader(grid) : forceHeader(grid, headerRow),
  }
}
