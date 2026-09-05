import { useCallback, useEffect, useState } from 'react'
import type {
  ImportOutcome, Mapping, Source, SourceStatus, WatchEvent, WatchState,
} from '@shared/types'
import ImportDialog from './ImportDialog.tsx'
import SheetViewer, { type ViewerTarget } from './SheetViewer.tsx'
import SuppliersPanel from './SuppliersPanel.tsx'

const STATUS: Record<SourceStatus, { label: string; cls: string; hint: string }> = {
  ok: { label: 'актуален', cls: 'ok', hint: 'Файл на диске совпадает с загруженным' },
  changed: { label: 'изменился', cls: 'warn', hint: 'Содержимое отличается — нужен переимпорт' },
  touched: {
    label: 'пересохранён', cls: 'dim',
    hint: 'Дата правки другая, содержимое прежнее — переимпорт ничего не изменит',
  },
  missing: { label: 'файл не найден', cls: 'err', hint: 'Файл удалён или перемещён' },
  superseded: {
    label: 'заменён', cls: 'dim',
    hint: 'Позиции перешли к более свежему прайсу этого поставщика',
  },
}

const EVENT: Record<WatchEvent['type'], { label: string; cls: string }> = {
  imported: { label: 'загружен', cls: 'ok' },
  pending: { label: 'нужна разметка', cls: 'warn' },
  skipped: { label: 'пропущен', cls: 'dim' },
  error: { label: 'ошибка', cls: 'err' },
}

const fmtDate = (ts: number | null) =>
  ts === null ? '—' : new Date(ts * 1000).toLocaleDateString('ru-RU')
const fmtTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const fmtSize = (b: number | null) => (b === null ? '—' : `${(b / 1024 / 1024).toFixed(1)} МБ`)

function summary(o: ImportOutcome): string {
  if (o.status === 'duplicate') {
    return `содержимое совпадает с «${o.duplicateOf.split(/[\\/]/).pop()}», пропущено`
  }
  const r = o.result
  const parts: string[] = []
  if (r.inserted > 0) parts.push(`добавлено ${r.inserted}`)
  if (r.updated > 0) parts.push(`обновлено ${r.updated}`)
  if (r.priceChanged > 0) parts.push(`цен изменилось ${r.priceChanged}`)
  if (r.deactivated > 0) parts.push(`пропало ${r.deactivated}`)
  return parts.join(' · ') || 'без изменений'
}

export default function PricesView() {
  const [sources, setSources] = useState<Source[] | null>(null)
  const [watch, setWatch] = useState<WatchState | null>(null)
  /** Профили нужны, чтобы в просмотре прайса подписать размеченные колонки. */
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [busy, setBusy] = useState<number | 'all' | 'scan' | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState<{ path?: string | null } | null>(null)
  const [viewing, setViewing] = useState<ViewerTarget | null>(null)
  const [showLog, setShowLog] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [s, w, m] = await Promise.all([
        window.api.listSources(), window.api.watchState(), window.api.listMappings(),
      ])
      setSources(s)
      setWatch(w)
      setMappings(m)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
    // Автозагрузка происходит без участия пользователя — слушаем main.
    return window.api.onWatchUpdate((w) => { setWatch(w); void window.api.listSources().then(setSources) })
  }, [reload])

  async function act<T>(key: typeof busy, fn: () => Promise<T>) {
    setBusy(key)
    setError(null)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  const reimport = (fileId: number) =>
    act(fileId, async () => {
      const out = await window.api.reimportSource(fileId)
      setNotes((n) => ({ ...n, [fileId]: summary(out) }))
      await reload()
    })

  const reimportChanged = () =>
    act('all', async () => {
      for (const s of (sources ?? []).filter((x) => x.status === 'changed')) {
        const out = await window.api.reimportSource(s.fileId)
        setNotes((n) => ({ ...n, [s.fileId]: summary(out) }))
      }
      await reload()
    })

  if (!sources || !watch) return <div className="muted">Загрузка…</div>

  const working = busy !== null || watch.busy
  const changed = sources.filter((s) => s.status === 'changed').length
  const totalItems = sources.reduce((sum, s) => sum + s.itemsActive, 0)

  return (
    <>
      {/* Очередь наверху: это единственное, что требует действия человека. */}
      {watch.pending.length > 0 && (
        <section className="panel-box">
          <header>
            Требуют разметки <span className="count">({watch.pending.length})</span>
          </header>
          <div className="body">
            <p className="hint">
              Эти прайсы приложение не смогло отнести к известному поставщику.
              Разметьте колонки один раз — дальше такие файлы будут загружаться сами.
            </p>
            <table className="pending">
              <tbody>
                {watch.pending.map((p) => (
                  <tr key={p.path}>
                    <td>
                      <b title={p.path}>{p.fileName}</b>
                      <span className="note warn">
                        {p.reason === 'ambiguous'
                          ? `отпечаток совпал с профилями: ${p.candidates.join(', ')}`
                          : 'профиль не найден'}
                      </span>
                    </td>
                    <td className="num muted mono">{fmtTime(p.detectedAt)}</td>
                    <td className="actions">
                      <button
                        className="primary small"
                        disabled={working}
                        onClick={() => setImporting({ path: p.path })}
                      >
                        Разметить и загрузить
                      </button>
                      <button
                        className="small"
                        disabled={working}
                        onClick={() => act(null, async () => { setWatch(await window.api.clearPending(p.path)) })}
                        title="Убрать из очереди, не загружая"
                      >
                        Пропустить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel-box">
        <header>
          Загруженные прайсы <span className="count">({sources.length})</span>
        </header>
        <div className="body">
          <div className="toolbar">
            <button className="primary" disabled={working} onClick={() => setImporting({})}>
              Добавить прайс
            </button>
            {changed > 0 && (
              <button disabled={working} onClick={reimportChanged}>
                {busy === 'all' ? 'Переимпортирую…' : `Переимпортировать изменившиеся (${changed})`}
              </button>
            )}
            <span className="sep" />
            <span className="muted">
              активных позиций: <b>{totalItems.toLocaleString('ru-RU')}</b>
            </span>
          </div>

          {error && <pre>{error}</pre>}

          {sources.length === 0 ? (
            <p className="hint">
              Пока ничего не загружено. Нажмите «Добавить прайс» или назначьте папку
              автозагрузки ниже.
            </p>
          ) : (
            <div className="scroll" style={{ marginTop: 'var(--s4)' }}>
              <table className="sources">
                <thead>
                  <tr>
                    <th>Поставщик</th>
                    <th>Файл</th>
                    <th className="num">Позиций</th>
                    <th className="num">Дата прайса</th>
                    <th>Состояние</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => {
                    const st = STATUS[s.status]
                    return (
                      <tr key={s.fileId}>
                        <td className="supplier">{s.supplierName}</td>
                        <td>
                          <span title={s.path}>{s.fileName}</span>
                          <span className="size"> · {fmtSize(s.sizeBytes)} · лист {s.sheet}</span>
                          {notes[s.fileId] && <span className="note">{notes[s.fileId]}</span>}
                        </td>
                        <td className="num mono">
                          {s.itemsActive.toLocaleString('ru-RU')}
                          {s.itemsTotal !== s.itemsActive && (
                            <span className="muted"> / {s.itemsTotal}</span>
                          )}
                        </td>
                        <td className="num mono">{fmtDate(s.priceDate)}</td>
                        <td>
                          <span className={`status-pill ${st.cls}`} title={st.hint}>{st.label}</span>
                        </td>
                        <td className="actions">
                          <button
                            className="small"
                            disabled={working || s.status === 'missing'}
                            onClick={() => {
                              const m = mappings.find((x) => x.id === s.mappingId)
                              setViewing({
                                path: s.path, fileName: s.fileName, sheet: s.sheet,
                                row: (m?.headerRow ?? 0) + 1,
                                headerRow: m?.headerRow ?? null,
                                columns: m?.columns,
                              })
                            }}
                          >
                            Посмотреть
                          </button>
                          <button
                            className="small"
                            disabled={working || s.status === 'missing'}
                            onClick={() => reimport(s.fileId)}
                          >
                            {busy === s.fileId ? '…' : 'Обновить'}
                          </button>
                          <button
                            className="small danger"
                            disabled={working}
                            onClick={() =>
                              act(s.fileId, async () => {
                                await window.api.removeSource(s.fileId)
                                await reload()
                              })
                            }
                            title="Удалить прайс вместе с его позициями"
                          >
                            Удалить
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <SuppliersPanel onChanged={() => void reload()} />

      <section className="panel-box">
        <header>
          Папки автозагрузки <span className="count">({watch.folders.length})</span>
        </header>
        <div className="body">
          <p className="hint">
            Прайс, положенный в такую папку, загружается сам, если поставщик опознан
            по заголовкам. Неизвестные файлы попадают в очередь на разметку.
          </p>
          <div className="toolbar">
            <button
              disabled={working}
              onClick={() => act('scan', async () => { setWatch(await window.api.addWatchFolder()) })}
            >
              Добавить папку
            </button>
            {watch.folders.length > 0 && (
              <button
                disabled={working}
                onClick={() => act('scan', async () => { setWatch(await window.api.rescanFolders()) })}
              >
                {busy === 'scan' || watch.busy ? 'Проверяю…' : 'Проверить сейчас'}
              </button>
            )}
          </div>

          {watch.folders.length > 0 && (
            <table className="folders" style={{ marginTop: 'var(--s3)' }}>
              <tbody>
                {watch.folders.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <label className="inline">
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          disabled={working}
                          onChange={(e) =>
                            act(null, async () => {
                              setWatch(await window.api.toggleWatchFolder(f.id, e.target.checked))
                            })
                          }
                        />
                        <span className="mono path">{f.path}</span>
                      </label>
                    </td>
                    <td className="num">
                      {!f.exists && <span className="status-pill err">папка не найдена</span>}
                    </td>
                    <td className="actions">
                      <button
                        className="small danger"
                        disabled={working}
                        onClick={() =>
                          act(null, async () => { setWatch(await window.api.removeWatchFolder(f.id)) })
                        }
                      >
                        Убрать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {watch.events.length > 0 && (
        <section className="panel-box">
          <header>
            <span className="grow">Журнал автозагрузки</span>
            <button className="small" onClick={() => setShowLog((v) => !v)}>
              {showLog ? 'Свернуть' : `Показать (${watch.events.length})`}
            </button>
          </header>
          {showLog && (
            <div className="body flush">
              <div className="scroll">
                <table className="events">
                  <tbody>
                    {watch.events.map((e, i) => (
                      <tr key={`${e.path}-${e.at}-${i}`}>
                        <td className="num muted mono time">{fmtTime(e.at)}</td>
                        <td className="kind">
                          <span className={`status-pill ${EVENT[e.type].cls}`}>
                            {EVENT[e.type].label}
                          </span>
                        </td>
                        <td title={e.path}>{e.fileName}</td>
                        <td className="muted">
                          {e.supplierName && <b>{e.supplierName}: </b>}
                          {e.summary ?? e.error ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {importing && (
        <ImportDialog
          initialPath={importing.path}
          onClose={() => setImporting(null)}
          onDone={(out) => {
            setImporting(null)
            void reload()
            if (out.status === 'duplicate') setError(summary(out))
          }}
        />
      )}

      {viewing && <SheetViewer target={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}
