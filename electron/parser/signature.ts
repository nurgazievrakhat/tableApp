import { createHash } from 'node:crypto'
import { normHeader } from './columns.ts'

/**
 * Отпечаток строки заголовков — ключ, по которому у нового файла опознаётся
 * профиль поставщика (ARCHITECTURE.md §9).
 *
 * Считается по нормализованным заголовкам, поэтому переживает смену регистра,
 * лишние пробелы и точки: «Ед. изм.» и «ед изм» дают один отпечаток.
 * Пустые колонки отбрасываются — иначе добавленный поставщиком пустой столбец
 * сбросил бы профиль.
 */
export function headerSignature(cells: unknown[]): string {
  const parts = cells.map(normHeader).filter((h) => h !== '')
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
}

const DATE_RE = /\d{1,2}[.\-_/]\d{1,2}[.\-_/]\d{2,4}/g
const COPY_RE = /\s*\(\d+\)\s*$/
const NUMBER_RE = /\d{2,}/g

/**
 * Маска имени файла: «Прайс Фармамир от 18.08.26.xls» → «Прайс Фармамир от *.xls».
 *
 * Нужна как второй ключ рядом с отпечатком. Отпечатка одного мало: прайс
 * Фармамира — выгрузка 1С, и другой поставщик на том же шаблоне даст ту же
 * строку заголовков, а значит и тот же отпечаток.
 */
export function filenameMask(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const ext = dot > 0 ? filename.slice(dot) : ''
  let base = dot > 0 ? filename.slice(0, dot) : filename

  base = base
    .replace(COPY_RE, '')   // «(2)» — след повторного скачивания
    .replace(DATE_RE, '*')
    .replace(NUMBER_RE, '*')
    .replace(/\*(?:[\s.\-_]*\*)+/g, '*')
    .trim()
    .replace(/[\s\-_]+$/, '')

  return base + ext
}

/** Подходит ли имя файла под маску. */
export function matchesMask(filename: string, mask: string): boolean {
  const re = new RegExp(
    '^' + mask.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
    'i',
  )
  return re.test(filename)
}
