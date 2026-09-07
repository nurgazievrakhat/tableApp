import type { Database } from 'better-sqlite3'
import m001 from './migrations/001_init.sql?raw'
import m002 from './migrations/002_vocab.sql?raw'
import m003 from './migrations/003_import_refs.sql?raw'
import m004 from './migrations/004_price_alt.sql?raw'
import m005 from './migrations/005_product_key_not_unique.sql?raw'
import m006 from './migrations/006_file_mapping_ref.sql?raw'

/**
 * Миграции применяются по порядку, версия хранится в PRAGMA user_version.
 * Добавление миграции = дописать элемент в массив, ничего не трогая выше.
 */
const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  { version: 1, name: '001_init', sql: m001 },
  { version: 2, name: '002_vocab', sql: m002 },
  { version: 3, name: '003_import_refs', sql: m003 },
  { version: 4, name: '004_price_alt', sql: m004 },
  { version: 5, name: '005_product_key_not_unique', sql: m005 },
  { version: 6, name: '006_file_mapping_ref', sql: m006 },
]

export interface MigrationResult {
  from: number
  to: number
  applied: string[]
}

export function migrate(db: Database): MigrationResult {
  const from = db.pragma('user_version', { simple: true }) as number
  const applied: string[] = []

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue

    // Каждая миграция — своя транзакция: упавшая не оставит схему наполовину применённой.
    const run = db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    })

    try {
      run()
      applied.push(migration.name)
    } catch (err) {
      throw new Error(
        `Миграция ${migration.name} не применилась: ${(err as Error).message}`,
      )
    }
  }

  return { from, to: db.pragma('user_version', { simple: true }) as number, applied }
}

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version
