import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { extract } from '../parser/service.ts'
import { get as getMapping } from '../db/repo/mappings.ts'
import { runImport, findFileByHash } from '../db/repo/imports.ts'
import { invalidateVocabulary } from '../db/repo/spelling.ts'
import { linkProducts } from '../db/repo/products.ts'
import type { ImportOutcome } from '@shared/types'

/**
 * Разбор по профилю и запись. Единый путь для всех трёх сценариев:
 * ручного импорта, переимпорта источника и автоподхвата из папки.
 */
export async function performImport(
  filePath: string,
  sheet: string,
  mappingId: number,
): Promise<ImportOutcome> {
  const mapping = getMapping(mappingId)
  const st = fs.statSync(filePath)
  const hash = createHash('sha1').update(fs.readFileSync(filePath)).digest('hex')

  // Файл с таким содержимым уже загружен под другим именем — это повторное
  // скачивание, а не новый прайс. Переимпорт того же пути при этом разрешён.
  const twin = findFileByHash(hash)
  if (twin && twin.path !== filePath) {
    return { status: 'duplicate', duplicateOf: twin.path }
  }

  const payload = await extract(
    filePath, sheet, mapping.headerRow,
    mapping.dataStartRow ?? mapping.headerRow + 1,
    mapping.columns, mapping.priceMultiplier,
  )

  const result = runImport({
    supplierId: mapping.supplierId,
    mappingId: mapping.id,
    filePath, sheet, fileHash: hash,
    mtime: Math.floor(st.mtimeMs / 1000),
    priceDate: payload.priceDate,
    items: payload.items,
    skipped: payload.skipped,
  })

  // Словарь исправления опечаток строится из содержимого базы.
  invalidateVocabulary()
  // Новые позиции нужно связать с каноническими товарами, иначе они не попадут
  // в сравнение по поставщикам.
  linkProducts()

  return {
    status: 'done',
    result,
    supplierName: mapping.supplierName,
    categories: payload.categories,
    collisions: payload.collisions,
    priceDate: payload.priceDate,
    priceDateSource: payload.priceDateSource,
    skipReasons: payload.skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1
      return acc
    }, {}),
  }
}
