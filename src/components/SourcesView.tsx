import { useCallback, useEffect, useState } from 'react'
import type { ImportOutcome, Source, SourceStatus } from '@shared/types'

const STATUS: Record<SourceStatus, { label: string; cls: string; hint: string }> = {
  ok: { label: 'актуален', cls: 'ok', hint: 'Файл на диске совпадает с загруженным' },
  changed: { label: 'изменился', cls: 'warn', hint: 'Содержимое файла отличается — нужен переимпорт' },
  touched: {
    label: 'пересохранён',
    cls: 'muted',
    hint: 'Дата правки изменилась, содержимое прежнее — переимпорт ничего не изменит',
  },
  missing: { label: 'файл не найден', cls: 'err-text', hint: 'Файл удалён или перемещён' },
  superseded: {
    label: 'заменён',
    cls: 'muted',
    hint: 'Позиции перешли к более свежему прайсу этого поставщика. Переимпорт вернёт цены из этого файла.',
  },
}

const fmtDate = (ts: number | null) =>
  ts === null ? '—' : new Date(ts * 1000).toLocaleDateString('ru-RU')

const fmtSize = (b: number | null) => (b === null ? '—' : `${(b / 1024 / 1024).toFixed(1)} МБ`)

function summary(o: ImportOutcome): string {
  if (o.status === 'duplicate') {
    return `содержимое совпадает с «${o.duplicateOf.split(/[\\/]/).pop()}», пропущено`
  }
  const r = o.result
  const parts = [`обновлено ${r.updated}`]
  if (r.inserted > 0) parts.push(`добавлено ${r.inserted}`)
  if (r.priceChanged > 0) parts.push(`цен изменилось ${r.priceChanged}`)
  if (r.deactivated > 0) parts.push(`пропало ${r.deactivated}`)
  return parts.join(' · ')
}

export default function SourcesView() {
  const [sources, setSources] = useState<Source[] | null>(null)
  const [busy, setBusy] = useState<number | 'all' | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setSources(await window.api.listSources())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  async function reimport(fileId: number) {
    setBusy(fileId)
    setError(null)
    try {
      const out = await window.api.reimportSource(fileId)
      setNotes((n) => ({ ...n, [fileId]: summary(out) }))
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** Переимпортируем только реально изменившиеся: остальным это ничего не даст. */
  async function reimportChanged() {
    const targets = (sources ?? []).filter((s) => s.status === 'changed')
    setBusy('all')
    setError(null)
    try {
      for (const s of targets) {
        const out = await window.api.reimportSource(s.fileId)
        setNotes((n) => ({ ...n, [s.fileId]: summary(out) }))
      }
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(s: Source) {
    setBusy(s.fileId)
    setError(null)
    try {
      await window.api.removeSource(s.fileId)
      setNotes((n) => {
        const next = { ...n }
        delete next[s.fileId]
        return next
      })
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!sources) return <div className="muted">Загрузка…</div>

  const changed = sources.filter((s) => s.status === 'changed').length
  const totalItems = sources.reduce((sum, s) => sum + s.itemsActive, 0)

  return (
    <>
      <section className="card">
        <div className="toolbar">
          <span className="muted">
            Прайсов: <b>{sources.length}</b> · активных позиций: <b>{totalItems}</b>
          </span>
          {changed > 0 && (
            <button onClick={reimportChanged} disabled={busy !== null}>
              {busy === 'all' ? 'Переимпортирую…' : `Переимпортировать изменившиеся (${changed})`}
            </button>
          )}
        </div>
        {error && <pre>{error}</pre>}
        {sources.length === 0 && (
          <p className="muted">
            Пока ничего не загружено. Откройте прайс на вкладке «Загрузить прайс».
          </p>
        )}
      </section>

      {sources.length > 0 && (
        <section className="card">
          <div className="scroll">
            <table className="sources">
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th>Файл</th>
                  <th>Лист</th>
                  <th className="num">Позиций</th>
                  <th className="num">Дата прайса</th>
                  <th className="num">Загружен</th>
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
                        <span className="muted size"> {fmtSize(s.sizeBytes)}</span>
                        {notes[s.fileId] && <span className="note">{notes[s.fileId]}</span>}
                      </td>
                      <td className="muted mono">{s.sheet}</td>
                      <td className="num mono">
                        {s.itemsActive}
                        {s.itemsTotal !== s.itemsActive && (
                          <span className="muted"> / {s.itemsTotal}</span>
                        )}
                      </td>
                      <td className="num mono">{fmtDate(s.priceDate)}</td>
                      <td className="num mono muted">{fmtDate(s.lastImportAt)}</td>
                      <td>
                        <span className={st.cls} title={st.hint}>{st.label}</span>
                      </td>
                      <td className="actions">
                        <button
                          className="small"
                          disabled={busy !== null || s.status === 'missing'}
                          onClick={() => reimport(s.fileId)}
                        >
                          {busy === s.fileId ? '…' : 'Переимпорт'}
                        </button>
                        <button
                          className="small danger"
                          disabled={busy !== null}
                          onClick={() => remove(s)}
                          title="Удалить источник вместе с его позициями"
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
        </section>
      )}
    </>
  )
}
