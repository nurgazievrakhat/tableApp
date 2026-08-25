import { useEffect, useState } from 'react'
import type { PendingFile, WatchEvent, WatchState } from '@shared/types'

const fmtTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

const EVENT_STYLE: Record<WatchEvent['type'], string> = {
  imported: 'ok',
  pending: 'warn',
  skipped: 'muted',
  error: 'err-text',
}

const EVENT_LABEL: Record<WatchEvent['type'], string> = {
  imported: 'загружен',
  pending: 'нужна разметка',
  skipped: 'пропущен',
  error: 'ошибка',
}

export default function WatchView({ onSetup }: { onSetup: (file: PendingFile) => void }) {
  const [state, setState] = useState<WatchState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.watchState().then(setState).catch((e: Error) => setError(e.message))
    // Импорт может произойти без участия пользователя — слушаем main.
    return window.api.onWatchUpdate(setState)
  }, [])

  async function act(fn: () => Promise<WatchState>) {
    setBusy(true)
    setError(null)
    try {
      setState(await fn())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!state) return <div className="muted">Загрузка…</div>

  const working = busy || state.busy

  return (
    <>
      <section className="card">
        <h2>Наблюдаемые папки</h2>
        <p className="hint muted">
          Прайс, положенный в такую папку, разбирается сам. Если поставщик опознан
          по отпечатку заголовков — импортируется без вопросов; если нет — попадает
          в очередь на разметку ниже.
        </p>

        <div className="toolbar">
          <button onClick={() => act(() => window.api.addWatchFolder())} disabled={working}>
            Добавить папку
          </button>
          {state.folders.length > 0 && (
            <button onClick={() => act(() => window.api.rescanFolders())} disabled={working}>
              {working ? 'Проверяю…' : 'Проверить сейчас'}
            </button>
          )}
        </div>

        {error && <pre>{error}</pre>}

        {state.folders.length === 0 ? (
          <p className="muted">Папки не назначены — автоподхват выключен.</p>
        ) : (
          <table className="folders">
            <tbody>
              {state.folders.map((f) => (
                <tr key={f.id}>
                  <td>
                    <label className="inline">
                      <input
                        type="checkbox"
                        checked={f.enabled}
                        disabled={working}
                        onChange={(e) =>
                          act(() => window.api.toggleWatchFolder(f.id, e.target.checked))
                        }
                      />
                      <span className="mono path">{f.path}</span>
                    </label>
                  </td>
                  <td className="num">
                    {!f.exists && <span className="err-text">папка не найдена</span>}
                  </td>
                  <td className="actions">
                    <button
                      className="small danger"
                      disabled={working}
                      onClick={() => act(() => window.api.removeWatchFolder(f.id))}
                    >
                      Убрать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {state.pending.length > 0 && (
        <section className="card">
          <h2>
            Требуют разметки <span className="muted">({state.pending.length})</span>
          </h2>
          <p className="hint muted">
            Приложение не угадывает поставщика. Разметьте колонки один раз — дальше
            такие прайсы будут загружаться сами.
          </p>
          <table className="pending">
            <tbody>
              {state.pending.map((p) => (
                <tr key={p.path}>
                  <td>
                    <span title={p.path}>{p.fileName}</span>
                    <span className="note warn">
                      {p.reason === 'ambiguous'
                        ? `отпечаток совпал с несколькими профилями: ${p.candidates.join(', ')}`
                        : 'профиль не найден'}
                    </span>
                  </td>
                  <td className="num muted mono">{fmtTime(p.detectedAt)}</td>
                  <td className="actions">
                    <button className="small" onClick={() => onSetup(p)} disabled={working}>
                      Разметить
                    </button>
                    <button
                      className="small"
                      disabled={working}
                      onClick={() => act(() => window.api.clearPending(p.path))}
                      title="Убрать из очереди, не загружая"
                    >
                      Пропустить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {state.events.length > 0 && (
        <section className="card">
          <h2>Журнал</h2>
          <div className="scroll">
            <table className="events">
              <tbody>
                {state.events.map((e, i) => (
                  <tr key={`${e.path}-${e.at}-${i}`}>
                    <td className="num muted mono time">{fmtTime(e.at)}</td>
                    <td className={EVENT_STYLE[e.type]}>{EVENT_LABEL[e.type]}</td>
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
        </section>
      )}
    </>
  )
}
