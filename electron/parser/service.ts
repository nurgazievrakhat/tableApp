import { utilityProcess, type UtilityProcess } from 'electron'
import path from 'node:path'
import type {
  ParseRequest, ParseResponse, SheetSummary, SheetPreview, ExtractPayload, SheetWindow,
} from './protocol.ts'
import type { Field } from './columns.ts'

/** Сколько ждём ответ, прежде чем считать процесс зависшим. */
const TIMEOUT_MS = 60_000

/**
 * Обычный Omit по объединению схлопывает его до общих полей: у ParseRequest
 * остались бы только id и type, а path и sheet пропали бы. Распределяем вручную.
 */
type RequestBody = ParseRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never

type Pending = {
  resolve: (r: ParseResponse) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

let child: UtilityProcess | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function failAll(reason: string): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(reason))
  }
  pending.clear()
}

function spawn(): UtilityProcess {
  if (child) return child

  const entry = path.join(__dirname, 'parser.worker.js')
  const proc = utilityProcess.fork(entry, [], { serviceName: 'table-easy-parser' })

  proc.on('message', (msg: ParseResponse) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    clearTimeout(p.timer)
    p.resolve(msg)
  })

  proc.on('exit', (code) => {
    child = null
    failAll(`Процесс разбора завершился (код ${code})`)
  })

  child = proc
  return proc
}

function request(req: RequestBody): Promise<ParseResponse> {
  const proc = spawn()
  const id = nextId++

  return new Promise<ParseResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Разбор файла не уложился в отведённое время'))
    }, TIMEOUT_MS)

    pending.set(id, { resolve, reject, timer })
    proc.postMessage({ ...req, id } as ParseRequest)
  })
}

function unwrap(res: ParseResponse): Extract<ParseResponse, { ok: true }> {
  if (!res.ok) throw new Error(res.error)
  return res
}

export async function listSheets(file: string): Promise<{ sheets: SheetSummary[]; file: string }> {
  const res = unwrap(await request({ type: 'listSheets', path: file }))
  if (res.type !== 'listSheets') throw new Error('Неожиданный ответ процесса разбора')
  return { sheets: res.sheets, file: res.file }
}

export async function readSheet(
  file: string,
  sheet: string,
  opts: { headerRow?: number; sampleRows?: number } = {},
): Promise<SheetPreview> {
  const res = unwrap(
    await request({ type: 'readSheet', path: file, sheet, ...opts }),
  )
  if (res.type !== 'readSheet') throw new Error('Неожиданный ответ процесса разбора')
  return res.preview
}

export async function extract(
  file: string,
  sheet: string,
  headerRow: number,
  dataStartRow: number,
  columns: Partial<Record<Field, number>>,
  priceMultiplier = 1,
): Promise<ExtractPayload> {
  const res = unwrap(
    await request({
      type: 'extract', path: file, sheet, headerRow, dataStartRow, columns, priceMultiplier,
    }),
  )
  if (res.type !== 'extract') throw new Error('Неожиданный ответ процесса разбора')
  return res.result
}

export async function readRows(
  file: string,
  sheet: string,
  from: number,
  count: number,
  headerRow?: number,
): Promise<SheetWindow> {
  const res = unwrap(await request({ type: 'rows', path: file, sheet, from, count, headerRow }))
  if (res.type !== 'rows') throw new Error('Неожиданный ответ процесса разбора')
  return res.window
}

export function stopParser(): void {
  child?.kill()
  child = null
  failAll('Процесс разбора остановлен')
}
