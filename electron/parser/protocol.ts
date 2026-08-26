import type { ColumnMap, Field } from './columns.ts'
import type { ParsedItem, SkippedRow } from './rows.ts'
import type { ColumnCheck } from './validate.ts'

export interface SheetSummary { name: string; rows: number; cols: number }

export interface CandidateInfo {
  row: number
  score: number
  dataRows: number
  fields: Partial<Record<Field, number>>
}

export interface SheetPreview {
  sheet: string
  rows: number
  cols: number
  /** Отпечаток строки заголовков — ключ поиска профиля поставщика (§9). */
  signature: string | null
  /** Заголовки как текст, для выпадающих списков на экране маппинга. */
  headers: string[]
  headerRow: number | null
  dataStartRow: number | null
  map: ColumnMap | null
  candidates: CandidateInfo[]
  /** Сверка разметки с данными: заголовок может врать (см. validate.ts). */
  checks: ColumnCheck[]
  /**
   * Доля заполненных ячеек по колонкам, 0..1, по выборке строк данных.
   * Нужна, чтобы не показывать в разметке пустые колонки: у «Бимед Фарм»
   * лист на 256 колонок, а данные лежат в восьми.
   */
  columnFill: number[]
  /** Окно строк для показа: индекс первой строки и сами строки как текст. */
  sampleFrom: number
  sample: string[][]
}

export interface ExtractPayload {
  items: ParsedItem[]
  skipped: SkippedRow[]
  categories: string[]
  collisions: number
  priceDate: number | null
  priceDateSource: 'cell' | 'filename' | 'mtime' | 'none'
}

export interface SheetWindow {
  sheet: string
  /** Индекс первой отданной строки, 0-based. */
  from: number
  rows: string[][]
  /** Всего строк на листе — нужно для полосы прокрутки. */
  total: number
  cols: number
  headerRow: number | null
}

export type ParseRequest =
  | { id: number; type: 'listSheets'; path: string }
  | {
      id: number
      type: 'readSheet'
      path: string
      sheet: string
      sampleRows?: number
      /** Строка заголовков вручную; без неё работает автоопределение. */
      headerRow?: number
    }
  | {
      id: number
      type: 'rows'
      path: string
      sheet: string
      from: number
      count: number
      headerRow?: number
    }
  | {
      id: number
      type: 'extract'
      path: string
      sheet: string
      headerRow: number
      dataStartRow: number
      columns: Partial<Record<Field, number>>
      priceMultiplier: number
    }

export type ParseResponse =
  | { id: number; ok: true; type: 'listSheets'; sheets: SheetSummary[]; file: string }
  | { id: number; ok: true; type: 'readSheet'; preview: SheetPreview }
  | { id: number; ok: true; type: 'extract'; result: ExtractPayload }
  | { id: number; ok: true; type: 'rows'; window: SheetWindow }
  | { id: number; ok: false; error: string }
