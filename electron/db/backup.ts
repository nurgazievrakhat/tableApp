import BetterSqlite3, { type Database } from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { getBackupDir, getDbPath } from './paths.ts'

/**
 * Резервные копии базы.
 *
 * Вся работа приложения — в одном файле data.db: и загруженные прайсы, и
 * история цен, которую заново уже не собрать. Неудачная миграция, оборванный
 * импорт или случайное удаление поставщика были необратимы, потому что второго
 * экземпляра этих данных нигде нет.
 *
 * Копия снимается через VACUUM INTO, а не копированием файла: при WAL часть
 * свежих изменений лежит в отдельном журнале, и простой copy дал бы копию,
 * отставшую от базы или, хуже, несогласованную. VACUUM INTO пишет цельный
 * снимок на момент запроса и заодно сжимает его.
 */

/** Сколько копий храним. */
const KEEP = 7

/**
 * Не чаще раза в сутки. Иначе десяток запусков за один рабочий день вытеснит
 * из ротации всю прошлую неделю — ровно тогда, когда она понадобится.
 */
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000

/**
 * data-2026-09-05-143205.db, с хвостом -2 при совпадении до секунды.
 *
 * Секунды в имени не для чтения — до минуты хватило бы. Они нужны, чтобы имена
 * сортировались по времени как строки: хвост «-2» встал бы перед точкой и
 * выглядел старше, чем копия без хвоста, а по этому порядку выбирается и
 * последняя копия, и то, что вытесняется из ротации.
 */
const NAME_RE = /^data-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?\.db$/

export interface BackupInfo {
  name: string
  /** Момент создания, unix-секунды: разобран из имени файла. */
  madeAt: number
  sizeBytes: number
  /** null — файл не открылся как база: копия испорчена. */
  schemaVersion: number | null
  items: number | null
}

let lastError: string | null = null

export interface BackupState {
  dir: string
  backups: BackupInfo[]
  /** Почему не удалось снять копию при запуске. */
  error: string | null
}

export function getBackupState(): BackupState {
  return { dir: getBackupDir(), backups: listBackups(), error: lastError }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function stamp(d: Date): string {
  return `data-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function madeAtFromName(name: string): number {
  const m = NAME_RE.exec(name)
  if (!m) return 0
  const [, y, mo, d, hh, mm, ss] = m
  return Math.floor(new Date(+y, +mo - 1, +d, +hh, +mm, +ss).getTime() / 1000)
}

/** Имена копий, новые первыми: формат имени сортируется по времени как строка. */
function listNames(): string[] {
  const dir = getBackupDir()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((n) => NAME_RE.test(n)).sort().reverse()
}

function describe(name: string): BackupInfo {
  const file = path.join(getBackupDir(), name)
  const info: BackupInfo = {
    name,
    madeAt: madeAtFromName(name),
    sizeBytes: fs.statSync(file).size,
    schemaVersion: null,
    items: null,
  }

  // Копию читаем только чтобы показать, что в ней лежит. Испорченный файл —
  // не повод ронять диалог: он и должен быть виден как испорченный.
  try {
    const probe = new BetterSqlite3(file, { readonly: true, fileMustExist: true })
    try {
      info.schemaVersion = probe.pragma('user_version', { simple: true }) as number
      info.items = (probe.prepare('SELECT count(*) AS n FROM items').get() as { n: number }).n
    } finally {
      probe.close()
    }
  } catch {
    /* остаётся null */
  }

  return info
}

export function listBackups(): BackupInfo[] {
  return listNames().map(describe)
}

/** Копировать нечего, пока не загружен ни один прайс. */
function worthBackup(db: Database): boolean {
  const table = db
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'items'")
    .get() as { n: number }
  if (table.n === 0) return false
  return ((db.prepare('SELECT count(*) AS n FROM items').get() as { n: number }).n) > 0
}

/** Снимок прямо сейчас, без оглядки на расписание. Возвращает имя файла. */
export function backupNow(db: Database): string {
  const dir = getBackupDir()
  fs.mkdirSync(dir, { recursive: true })

  // VACUUM INTO отказывается писать поверх существующего файла — и правильно
  // делает: затирать чужую копию нельзя. При совпадении до секунды берём хвост.
  const base = stamp(new Date())
  let name = `${base}.db`
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}.db`

  db.prepare('VACUUM INTO ?').run(path.join(dir, name))
  rotate()
  return name
}

/** Лишние копии сверх KEEP. Удаляем только свои файлы — чужое в папке не трогаем. */
function rotate(): void {
  const dir = getBackupDir()
  for (const name of listNames().slice(KEEP)) {
    try {
      fs.rmSync(path.join(dir, name))
    } catch (err) {
      console.error(`Не удалось удалить старую копию ${name}:`, (err as Error).message)
    }
  }
}

/**
 * Копия при запуске: обязательно перед миграцией и раз в сутки на всякий
 * случай. Миграция переписывает таблицы целиком, и если она не сойдётся на
 * чьих-то данных, откатываться будет некуда.
 *
 * Ошибку копирования не пропускаем наружу: приложение должно открыться даже
 * при заполненном диске. Причину показываем в «Состоянии базы».
 */
export function backupOnStartup(db: Database, migrationPending: boolean): void {
  lastError = null
  try {
    if (!worthBackup(db)) return

    const names = listNames()
    if (!migrationPending && names.length > 0) {
      const age = Date.now() - madeAtFromName(names[0]) * 1000
      if (age < MIN_INTERVAL_MS) return
    }

    backupNow(db)
  } catch (err) {
    lastError = (err as Error).message
    console.error('Не удалось сделать резервную копию:', lastError)
  }
}

/**
 * Проверка копии перед возвратом к ней.
 *
 * Вынесена отдельно, чтобы вызывающий мог убедиться в пригодности файла до
 * того, как закроет рабочую базу: иначе отказ на повреждённой копии оставлял
 * приложение вообще без базы.
 */
export function checkBackup(name: string): void {
  // Имя приходит из окна, поэтому сверяем его с образцом, а не просто
  // склеиваем путь: «../../data.db» тут не должно сработать.
  if (!NAME_RE.test(name)) throw new Error(`Недопустимое имя копии: ${name}`)

  const src = path.join(getBackupDir(), name)
  if (!fs.existsSync(src)) throw new Error(`Копия ${name} не найдена`)

  let probe: Database
  try {
    probe = new BetterSqlite3(src, { readonly: true, fileMustExist: true })
  } catch (err) {
    throw new Error(`Копия ${name} не открывается: ${(err as Error).message}`)
  }
  try {
    probe.prepare('SELECT count(*) FROM items').get()
  } catch (err) {
    throw new Error(`Копия ${name} повреждена и не подходит: ${(err as Error).message}`)
  } finally {
    probe.close()
  }
}

/**
 * Возврат к копии: файл базы заменяется целиком.
 *
 * База к этому моменту должна быть закрыта, а копия — проверена checkBackup;
 * вызывающий отвечает за то и другое.
 *
 * Копия сначала кладётся рядом и лишь потом переименовывается на место: если
 * места на диске не хватит, оборвётся копирование во временный файл, а рабочая
 * база останется целой. Журналы WAL удаляем — они относятся к прежнему файлу,
 * и SQLite, увидев их рядом с новым, попытается накатить чужие изменения.
 */
export function applyBackup(name: string): void {
  const src = path.join(getBackupDir(), name)
  const target = getDbPath()
  const tmp = `${target}.restoring`

  try {
    fs.copyFileSync(src, tmp)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }

  fs.renameSync(tmp, target)
  for (const suffix of ['-wal', '-shm']) fs.rmSync(target + suffix, { force: true })
}
