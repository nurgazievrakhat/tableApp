import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { getDatabase } from '../db/connection.ts'
import { processFile, isPriceFile, type PendingFile, type WatchEvent } from './pipeline.ts'

export interface WatchedFolder {
  id: number
  path: string
  enabled: boolean
  exists: boolean
}

export interface WatchState {
  folders: WatchedFolder[]
  pending: PendingFile[]
  events: WatchEvent[]
  busy: boolean
}

const MAX_EVENTS = 60

let watcher: FSWatcher | null = null
let notify: ((state: WatchState) => void) | null = null

const pending = new Map<string, PendingFile>()
let events: WatchEvent[] = []
let busy = false

/** Очередь на один файл: два события подряд на один и тот же файл — обычное дело. */
const queue: string[] = []
let draining = false

export function onWatchUpdate(cb: (state: WatchState) => void): void {
  notify = cb
}

export function listFolders(): WatchedFolder[] {
  const rows = getDatabase()
    .prepare('SELECT id, path, enabled FROM watched_folders ORDER BY path')
    .all() as { id: number; path: string; enabled: number }[]
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    enabled: r.enabled === 1,
    exists: fs.existsSync(r.path),
  }))
}

export function getState(): WatchState {
  return {
    folders: listFolders(),
    pending: [...pending.values()].sort((a, b) => b.detectedAt - a.detectedAt),
    events,
    busy,
  }
}

function push(): void {
  notify?.(getState())
}

function record(event: WatchEvent): void {
  events = [event, ...events].slice(0, MAX_EVENTS)
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  busy = true
  push()

  try {
    while (queue.length > 0) {
      const file = queue.shift()!
      if (!fs.existsSync(file)) continue

      try {
        const { event, pending: p } = await processFile(file)
        record(event)
        if (p) pending.set(file, p)
        else pending.delete(file)
      } catch (err) {
        // Один битый файл не должен останавливать разбор остальных.
        record({
          type: 'error', path: file, fileName: path.basename(file),
          at: Math.floor(Date.now() / 1000), error: (err as Error).message,
        })
      }
      push()
    }
  } finally {
    draining = false
    busy = false
    push()
  }
}

function enqueue(file: string): void {
  if (!isPriceFile(file)) return
  if (!queue.includes(file)) queue.push(file)
  void drain()
}

/** Разовый обход папок: подхватывает то, что появилось, пока приложение не работало. */
export async function scanAll(): Promise<void> {
  for (const folder of listFolders()) {
    if (!folder.enabled || !folder.exists) continue
    let entries: string[]
    try {
      entries = fs.readdirSync(folder.path)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = path.join(folder.path, name)
      if (isPriceFile(full) && fs.statSync(full).isFile()) enqueue(full)
    }
  }
  await drain()
}

export function restartWatcher(): void {
  void watcher?.close()
  watcher = null

  const dirs = listFolders().filter((f) => f.enabled && f.exists).map((f) => f.path)
  if (dirs.length === 0) {
    push()
    return
  }

  watcher = chokidar.watch(dirs, {
    depth: 0,
    ignoreInitial: true,
    // Прайс копируют или скачивают — без этой паузы файл прочитается на
    // середине записи и разбор упадёт на битом zip.
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
  })

  watcher.on('add', enqueue)
  watcher.on('change', enqueue)
  watcher.on('unlink', (file) => {
    if (pending.delete(file)) push()
  })
  push()
}

export function addFolder(dir: string): void {
  getDatabase()
    .prepare('INSERT OR IGNORE INTO watched_folders(path, enabled) VALUES (?, 1)')
    .run(dir)
  restartWatcher()
}

export function removeFolder(id: number): void {
  const row = getDatabase()
    .prepare('SELECT path FROM watched_folders WHERE id = ?')
    .get(id) as { path: string } | undefined

  getDatabase().prepare('DELETE FROM watched_folders WHERE id = ?').run(id)

  if (row) {
    for (const key of [...pending.keys()]) {
      if (key.startsWith(row.path + path.sep)) pending.delete(key)
    }
  }
  restartWatcher()
}

export function setFolderEnabled(id: number, enabled: boolean): void {
  getDatabase()
    .prepare('UPDATE watched_folders SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, id)
  restartWatcher()
}

/** Файл размечен вручную — из очереди его можно убрать. */
export function clearPending(file: string): void {
  if (pending.delete(file)) push()
}

export function stopWatcher(): void {
  void watcher?.close()
  watcher = null
}
