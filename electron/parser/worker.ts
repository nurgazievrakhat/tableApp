/**
 * Процесс разбора таблиц (utilityProcess). Живёт отдельно от main, потому что
 * разбор блокирует поток: прайс на 5930 строк — это ~420мс, на 100k — секунды.
 * См. ARCHITECTURE.md §3.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readWorkbook, listSheets, readSheet } from './readWorkbook.ts'
import { cellText } from './values.ts'
import { headerSignature } from './signature.ts'
import { extractRows } from './rows.ts'
import { detectPriceDate } from './priceDate.ts'
import type { ParseRequest, ParseResponse, SheetPreview, ExtractPayload } from './protocol.ts'
import type * as XLSX from 'xlsx'

const DEFAULT_SAMPLE_ROWS = 40

type ExtractColumns = Extract<ParseRequest, { type: 'extract' }>['columns']

/**
 * Кэш на одну книгу: UI почти всегда сначала просит список листов, а потом
 * превью — без кэша один и тот же файл читался бы дважды.
 */
let cache: { path: string; mtimeMs: number; size: number; wb: XLSX.WorkBook } | null = null

function load(file: string): XLSX.WorkBook {
  const st = fs.statSync(file)
  if (cache && cache.path === file && cache.mtimeMs === st.mtimeMs && cache.size === st.size) {
    return cache.wb
  }
  const wb = readWorkbook(file)
  cache = { path: file, mtimeMs: st.mtimeMs, size: st.size, wb }
  return wb
}

function buildPreview(
  file: string,
  sheetName: string,
  sampleRows: number,
  headerRow?: number,
): SheetPreview {
  const sheet = readSheet(load(file), sheetName, headerRow)
  const d = sheet.detection

  // Показываем окно вокруг найденной шапки: пользователю нужно увидеть саму
  // шапку и что под ней, а не 262 строки преамбулы.
  const from = d.headerRow === null ? 0 : Math.max(0, d.headerRow - 3)
  const to = Math.min(sheet.grid.length, from + sampleRows)

  const sample: string[][] = []
  for (let r = from; r < to; r++) {
    const row = sheet.grid[r] ?? []
    sample.push(Array.from({ length: sheet.cols }, (_, c) => cellText(row[c])))
  }

  const headerCells = d.headerRow === null ? [] : (sheet.grid[d.headerRow] ?? [])

  return {
    sheet: sheetName,
    rows: sheet.rows,
    cols: sheet.cols,
    signature: d.headerRow === null ? null : headerSignature(headerCells),
    headers: Array.from({ length: sheet.cols }, (_, c) => cellText(headerCells[c])),
    headerRow: d.headerRow,
    dataStartRow: d.dataStartRow,
    map: d.map,
    candidates: d.candidates.map((c) => ({
      row: c.row,
      score: c.score,
      dataRows: c.dataRows,
      fields: c.map.fields,
    })),
    sampleFrom: from,
    sample,
  }
}

function buildExtract(
  file: string,
  sheetName: string,
  headerRow: number,
  dataStartRow: number,
  columns: ExtractColumns,
  priceMultiplier: number,
): ExtractPayload {
  const sheet = readSheet(load(file), sheetName, headerRow)
  const headers = Array.from({ length: sheet.cols }, (_, c) =>
    cellText((sheet.grid[headerRow] ?? [])[c]),
  )

  const res = extractRows({
    grid: sheet.grid, headers, dataStartRow, columns, priceMultiplier,
  })
  const st = fs.statSync(file)
  const pd = detectPriceDate(
    sheet.grid, headerRow, path.basename(file), Math.floor(st.mtimeMs / 1000),
  )

  return { ...res, priceDate: pd.date, priceDateSource: pd.source }
}

function handle(req: ParseRequest): ParseResponse {
  try {
    switch (req.type) {
      case 'listSheets':
        return {
          id: req.id, ok: true, type: 'listSheets',
          sheets: listSheets(load(req.path)),
          file: path.basename(req.path),
        }
      case 'extract':
        return {
          id: req.id, ok: true, type: 'extract',
          result: buildExtract(
            req.path, req.sheet, req.headerRow, req.dataStartRow,
            req.columns, req.priceMultiplier,
          ),
        }
      case 'readSheet':
        return {
          id: req.id, ok: true, type: 'readSheet',
          preview: buildPreview(
            req.path, req.sheet, req.sampleRows ?? DEFAULT_SAMPLE_ROWS, req.headerRow,
          ),
        }
    }
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message }
  }
}

process.parentPort.on('message', (e) => {
  process.parentPort.postMessage(handle(e.data as ParseRequest))
})
