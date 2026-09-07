import { app } from 'electron'
import electronUpdater from 'electron-updater'

/**
 * Обновление приложения по кнопке.
 *
 * Файлы обновлений лежат в релизах GitHub того же репозитория, откуда собран
 * установщик: репозиторий публичный, значит хостить ничего не надо и токен не
 * нужен. Установщик NSIS кладёт рядом blockmap, поэтому скачиваются только
 * изменившиеся куски, а не все 114 МБ.
 *
 * Скачивание не запускается само: человек нажимает «Проверить обновления»,
 * видит, что за версия и сколько весит, и решает. Незаметно тянуть сотню
 * мегабайт по рабочему интернету — не то поведение, которого ждут.
 *
 * Подпись установщика не проверяется, и это осознанно: приложение не подписано
 * сертификатом, publisherName в app-update.yml пустой, и electron-updater сам
 * пропускает проверку. Защитой остаются HTTPS до github.com и то, что релизы
 * выкладывает только сборка из этого репозитория.
 */

const { autoUpdater } = electronUpdater

export type UpdateStatus =
  | 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  currentVersion: string
  status: UpdateStatus
  newVersion: string | null
  /** Описание релиза, как его написали при выпуске. */
  notes: string | null
  sizeBytes: number | null
  /** Процент скачивания, 0–100. */
  percent: number
  error: string | null
  /**
   * В режиме разработки обновлять нечего: обновляется установленное
   * приложение, а не запущенное из исходников.
   */
  supported: boolean
}

let state: UpdateState = {
  currentVersion: app.getVersion(),
  status: 'idle',
  newVersion: null,
  notes: null,
  sizeBytes: null,
  percent: 0,
  error: null,
  supported: app.isPackaged,
}

let notify: (s: UpdateState) => void = () => {}

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  notify(state)
}

/** Описание релиза приходит строкой или списком — приводим к тексту. */
function toNotes(notes: unknown): string | null {
  if (typeof notes === 'string') return notes.trim() || null
  if (Array.isArray(notes)) {
    const text = notes
      .map((n) => (typeof n === 'string' ? n : String((n as { note?: string }).note ?? '')))
      .join('\n')
      .trim()
    return text || null
  }
  return null
}

export function initUpdater(send: (s: UpdateState) => void): void {
  notify = send
  if (!state.supported) return

  autoUpdater.autoDownload = false
  // Ставим только по кнопке: молча подменять программу при закрытии — значит
  // однажды удивить человека изменившимся окном без объяснений.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    set({
      status: 'available',
      newVersion: info.version,
      notes: toNotes(info.releaseNotes),
      sizeBytes: info.files?.[0]?.size ?? null,
      percent: 0,
      error: null,
    })
  })

  autoUpdater.on('update-not-available', () => {
    set({ status: 'none', newVersion: null, notes: null, sizeBytes: null, error: null })
  })

  autoUpdater.on('download-progress', (p) => {
    set({ status: 'downloading', percent: Math.round(p.percent) })
  })

  autoUpdater.on('update-downloaded', () => {
    set({ status: 'ready', percent: 100 })
  })

  autoUpdater.on('error', (err) => {
    set({ status: 'error', error: err.message })
  })
}

export function getUpdateState(): UpdateState {
  return state
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (!state.supported) return state
  set({ status: 'checking', error: null })
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    // Нет сети, GitHub недоступен, релизов ещё нет — всё это сюда.
    set({ status: 'error', error: (err as Error).message })
  }
  return state
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (!state.supported || state.status !== 'available') return state
  set({ status: 'downloading', percent: 0, error: null })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    set({ status: 'error', error: (err as Error).message })
  }
  return state
}

/** Закрывает приложение и запускает установщик. Возврата отсюда нет. */
export function installUpdate(): void {
  if (state.status !== 'ready') throw new Error('Обновление ещё не скачано')
  autoUpdater.quitAndInstall()
}
