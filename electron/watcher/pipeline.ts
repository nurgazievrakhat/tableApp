import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { listSheets, readSheet } from '../parser/service.ts'
import { findMapping } from '../db/repo/mappings.ts'
import { findFileByHash } from '../db/repo/imports.ts'
import { performImport } from '../import/run.ts'

export type WatchEventType = 'imported' | 'pending' | 'skipped' | 'error'

export interface WatchEvent {
  type: WatchEventType
  path: string
  fileName: string
  at: number
  supplierName?: string
  summary?: string
  /** Почему файл не удалось принять автоматически. */
  reason?: 'no-profile' | 'ambiguous' | 'duplicate' | 'already-imported' | 'no-header'
  candidates?: string[]
  error?: string
}

export interface PendingFile {
  path: string
  fileName: string
  sheet: string
  signature: string | null
  reason: 'no-profile' | 'ambiguous'
  candidates: string[]
  detectedAt: number
}

export const isPriceFile = (file: string): boolean =>
  /\.(xlsx|xls|xlsm|xlsb)$/i.test(file) && !path.basename(file).startsWith('~$')

const sha1 = (file: string): string =>
  createHash('sha1').update(fs.readFileSync(file)).digest('hex')

/**
 * Что делать с файлом, появившимся в наблюдаемой папке (ARCHITECTURE.md §9).
 *
 *   хеш уже в базе          -> молча пропустить (повторно скачанный «прайс (2)»)
 *   профиль опознан         -> импортировать
 *   профиль не опознан      -> в очередь на разметку, ничего не гадая
 */
export async function processFile(file: string): Promise<{
  event: WatchEvent
  pending?: PendingFile
}> {
  const fileName = path.basename(file)
  const at = Math.floor(Date.now() / 1000)
  const base = { path: file, fileName, at }

  try {
    const hash = sha1(file)
    const twin = findFileByHash(hash)

    if (twin) {
      // Тот же путь — файл уже загружен и не менялся. Другой путь — копия.
      return {
        event: {
          ...base,
          type: 'skipped',
          reason: twin.path === file ? 'already-imported' : 'duplicate',
          summary:
            twin.path === file
              ? 'уже загружен, содержимое не менялось'
              : `то же содержимое, что «${path.basename(twin.path)}»`,
        },
      }
    }

    const { sheets } = await listSheets(file)
    if (sheets.length === 0) {
      return { event: { ...base, type: 'error', error: 'В книге нет листов' } }
    }

    const sheet = sheets[0].name
    const preview = await readSheet(file, sheet)

    if (preview.signature === null) {
      return {
        event: { ...base, type: 'pending', reason: 'no-header', summary: 'не найдена строка заголовков' },
        pending: {
          path: file, fileName, sheet, signature: null,
          reason: 'no-profile', candidates: [], detectedAt: at,
        },
      }
    }

    const lookup = findMapping(preview.signature, fileName)

    if (!lookup.mapping) {
      const ambiguous = lookup.ambiguous.length > 0
      return {
        event: {
          ...base,
          type: 'pending',
          reason: ambiguous ? 'ambiguous' : 'no-profile',
          candidates: lookup.ambiguous.map((m) => m.supplierName),
          summary: ambiguous
            ? `отпечаток совпал с несколькими профилями: ${lookup.ambiguous.map((m) => m.supplierName).join(', ')}`
            : 'профиль не найден — нужна разметка колонок',
        },
        pending: {
          path: file, fileName, sheet,
          signature: preview.signature,
          reason: ambiguous ? 'ambiguous' : 'no-profile',
          candidates: lookup.ambiguous.map((m) => m.supplierName),
          detectedAt: at,
        },
      }
    }

    const outcome = await performImport(file, sheet, lookup.mapping.id)

    if (outcome.status === 'duplicate') {
      return {
        event: {
          ...base, type: 'skipped', reason: 'duplicate',
          summary: `то же содержимое, что «${path.basename(outcome.duplicateOf)}»`,
        },
      }
    }

    const r = outcome.result
    const parts: string[] = []
    if (r.inserted > 0) parts.push(`добавлено ${r.inserted}`)
    if (r.updated > 0) parts.push(`обновлено ${r.updated}`)
    if (r.priceChanged > 0) parts.push(`цен изменилось ${r.priceChanged}`)
    if (r.deactivated > 0) parts.push(`пропало ${r.deactivated}`)

    return {
      event: {
        ...base, type: 'imported',
        supplierName: outcome.supplierName,
        summary: parts.join(' · ') || 'без изменений',
      },
    }
  } catch (e) {
    return { event: { ...base, type: 'error', error: (e as Error).message } }
  }
}
