import BetterSqlite3, { type Database } from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { migrate, SCHEMA_VERSION, type MigrationResult } from './migrations.ts'

let db: Database | null = null
let lastMigration: MigrationResult | null = null

export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'data.db')
}

export function openDatabase(): Database {
  if (db) return db

  const file = getDbPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })

  db = new BetterSqlite3(file)

  // WAL — чтобы чтение из UI не блокировалось идущим импортом.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  // Миграции идут с выключенными внешними ключами: изменить ограничение в
  // SQLite можно только пересборкой таблицы, а пересобрать её при включённых
  // ключах нельзя — на неё ссылаются другие. Переключать этот режим внутри
  // транзакции бесполезно, поэтому он снимается здесь, до неё.
  db.pragma('foreign_keys = OFF')
  lastMigration = migrate(db)

  // После пересборки таблиц проверяем, что ссылки никуда не разъехались.
  // Молча включить ключи поверх испорченных данных было бы хуже, чем упасть.
  const broken = db.pragma('foreign_key_check') as unknown[]
  if (broken.length > 0) {
    throw new Error(
      `После миграции нарушены связи между таблицами (${broken.length}). ` +
        'База не изменена — сообщите разработчику.',
    )
  }

  db.pragma('foreign_keys = ON')
  return db
}

export function getDatabase(): Database {
  if (!db) throw new Error('База не открыта: вызовите openDatabase() до обращения к ней')
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = null
}

export interface DbStatus {
  path: string
  schemaVersion: number
  expectedVersion: number
  appliedNow: string[]
  sizeBytes: number
  tables: { name: string; rows: number }[]
}

export function getStatus(): DbStatus {
  const conn = getDatabase()
  const tables = conn
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'items_fts%'
       ORDER BY name`,
    )
    .all() as { name: string }[]

  return {
    path: getDbPath(),
    schemaVersion: conn.pragma('user_version', { simple: true }) as number,
    expectedVersion: SCHEMA_VERSION,
    appliedNow: lastMigration?.applied ?? [],
    sizeBytes: fs.existsSync(getDbPath()) ? fs.statSync(getDbPath()).size : 0,
    tables: tables.map((t) => ({
      name: t.name,
      rows: (conn.prepare(`SELECT count(*) AS n FROM "${t.name}"`).get() as { n: number }).n,
    })),
  }
}
