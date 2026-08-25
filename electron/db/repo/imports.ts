import { getDatabase } from '../connection.ts'
import type { ParsedItem, SkippedRow } from '../../parser/rows.ts'

export interface RunImportParams {
  supplierId: number
  mappingId: number
  filePath: string
  sheet: string
  fileHash: string
  mtime: number
  priceDate: number | null
  items: ParsedItem[]
  skipped: SkippedRow[]
}

export interface ImportResult {
  importId: number
  fileId: number
  total: number
  inserted: number
  updated: number
  priceChanged: number
  deactivated: number
  reactivated: number
  skipped: number
  elapsedMs: number
}

interface ExistingRow {
  id: number
  price: number | null
  is_active: number
}

export function runImport(p: RunImportParams): ImportResult {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const upsertFile = db.prepare(
    `INSERT INTO files(supplier_id, path, sheet, file_hash, mtime, mapping_id)
     VALUES (@supplierId, @path, @sheet, @hash, @mtime, @mappingId)
     ON CONFLICT(path, sheet) DO UPDATE SET
       supplier_id = excluded.supplier_id,
       file_hash   = excluded.file_hash,
       mtime       = excluded.mtime,
       mapping_id  = excluded.mapping_id
     RETURNING id`,
  )

  const insertImport = db.prepare(
    `INSERT INTO imports(file_id, imported_at, price_date, rows_total, rows_ok, rows_skipped)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )

  const findItem = db.prepare(
    'SELECT id, price, is_active FROM items WHERE supplier_id = ? AND item_key = ?',
  )

  const insertItem = db.prepare(
    `INSERT INTO items(
       supplier_id, file_id, item_key, name, name_norm, article, article_norm,
       price, currency, promo_raw, promo_pct, promo_from, promo_to,
       bulk_pct, bulk_min_qty, unit, unit_norm, stock, manufacturer, expiry,
       category, row_no, extra_json, extra_text, last_import_id, is_active)
     VALUES (
       @supplierId, @fileId, @itemKey, @name, @nameNorm, @article, @articleNorm,
       @price, @currency, @promoRaw, @promoPct, @promoFrom, @promoTo,
       @bulkPct, @bulkMinQty, @unit, @unitNorm, @stock, @manufacturer, @expiry,
       @category, @rowNo, @extraJson, @extraText, @importId, 1)`,
  )

  const updateItem = db.prepare(
    `UPDATE items SET
       file_id = @fileId, name = @name, name_norm = @nameNorm,
       article = @article, article_norm = @articleNorm,
       price = @price, currency = @currency, promo_raw = @promoRaw,
       promo_pct = @promoPct, promo_from = @promoFrom, promo_to = @promoTo,
       bulk_pct = @bulkPct, bulk_min_qty = @bulkMinQty,
       unit = @unit, unit_norm = @unitNorm, stock = @stock,
       manufacturer = @manufacturer, expiry = @expiry, category = @category,
       row_no = @rowNo, extra_json = @extraJson, extra_text = @extraText,
       last_import_id = @importId, is_active = 1
     WHERE id = @id`,
  )

  // История пишется только при фактическом изменении цены (§8): полные снимки
  // на каждый импорт раздули бы базу на порядок без пользы.
  const insertHistory = db.prepare(
    `INSERT OR IGNORE INTO price_history(item_id, price, currency, changed_at, import_id)
     VALUES (?, ?, ?, ?, ?)`,
  )

  // Гасим по поставщику, а не по файлу: прайс следующей недели приходит новым
  // файлом, но каталог у поставщика тот же — позиции и ключуются по нему
  // (UNIQUE(supplier_id, item_key)). Область гашения обязана совпадать с ключом,
  // иначе исчезнувшие позиции остаются «активными» навсегда.
  const deactivate = db.prepare(
    `UPDATE items SET is_active = 0
     WHERE supplier_id = ? AND is_active = 1
       AND (last_import_id IS NULL OR last_import_id != ?)`,
  )

  const run = db.transaction((): ImportResult => {
    const started = Date.now()

    const { id: fileId } = upsertFile.get({
      supplierId: p.supplierId, path: p.filePath, sheet: p.sheet,
      hash: p.fileHash, mtime: p.mtime, mappingId: p.mappingId,
    }) as { id: number }

    const { id: importId } = insertImport.get(
      fileId, now, p.priceDate,
      p.items.length + p.skipped.length, p.items.length, p.skipped.length,
    ) as { id: number }

    let inserted = 0
    let updated = 0
    let priceChanged = 0
    let reactivated = 0

    for (const it of p.items) {
      const row = {
        supplierId: p.supplierId, fileId, importId,
        itemKey: it.itemKey, name: it.name, nameNorm: it.nameNorm,
        article: it.article, articleNorm: it.articleNorm,
        price: it.price, currency: 'KGS',
        promoRaw: it.promoRaw,
        promoPct: it.promo.pct, promoFrom: it.promo.from, promoTo: it.promo.to,
        bulkPct: it.promo.bulkPct, bulkMinQty: it.promo.bulkMinQty,
        unit: it.unit, unitNorm: it.unitNorm, stock: it.stock,
        manufacturer: it.manufacturer, expiry: it.expiry, category: it.category,
        rowNo: it.rowNo, extraJson: it.extraJson, extraText: it.extraText,
      }

      const existing = findItem.get(p.supplierId, it.itemKey) as ExistingRow | undefined

      if (!existing) {
        insertItem.run(row)
        inserted++
        continue
      }

      if (existing.price !== it.price) {
        insertHistory.run(existing.id, existing.price, 'KGS', now, importId)
        priceChanged++
      }
      if (existing.is_active === 0) reactivated++

      updateItem.run({ ...row, id: existing.id })
      updated++
    }

    const deactivated = deactivate.run(p.supplierId, importId).changes

    return {
      importId, fileId,
      total: p.items.length,
      inserted, updated, priceChanged, deactivated, reactivated,
      skipped: p.skipped.length,
      elapsedMs: Date.now() - started,
    }
  })

  return run()
}

/** Уже импортированный файл с тем же содержимым — повод пропустить (§9). */
export function findFileByHash(hash: string): { id: number; path: string } | null {
  return (
    (getDatabase()
      .prepare('SELECT id, path FROM files WHERE file_hash = ? LIMIT 1')
      .get(hash) as { id: number; path: string } | undefined) ?? null
  )
}
