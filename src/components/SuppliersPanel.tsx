import { useEffect, useState } from 'react'
import type { SupplierDetails } from '@shared/types'

/**
 * Управление поставщиками.
 *
 * Имя поставщика вводится вручную при разметке, и опечатка в нём — самая
 * дешёвая ошибка, которую до сих пор нельзя было исправить: приходилось
 * удалять прайс и загружать заново. Здесь она правится на месте.
 */
export default function SuppliersPanel({ onChanged }: { onChanged: () => void }) {
  const [list, setList] = useState<SupplierDetails[] | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    try {
      setList(await window.api.supplierDetails())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => { void reload() }, [])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await reload()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Отмена убирает и сообщение об ошибке: оно относилось к брошенному действию. */
  function cancel() {
    setEditing(null)
    setConfirming(null)
    setError(null)
  }

  function startRename(s: SupplierDetails) {
    setEditing(s.id)
    setDraft(s.name)
    setConfirming(null)
    setError(null)
  }

  // Пока не загружен ни один прайс, управлять нечем — панель не показываем.
  if (!list || list.length === 0) return null

  return (
    <section className="panel-box">
      <header>
        Поставщики <span className="count">({list.length})</span>
      </header>
      <div className="body">
        <p className="hint">
          Имя поставщика видно в поиске и в сравнении цен. Его можно поправить, не
          трогая загруженные прайсы. Удаление поставщика уносит его прайсы, позиции
          и историю цен.
        </p>

        {error && <pre>{error}</pre>}

        <table className="suppliers">
          <thead>
            <tr>
              <th>Поставщик</th>
              <th className="num">Позиций</th>
              <th className="num">Прайсов</th>
              <th>Профили разметки</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>
                  {editing === s.id ? (
                    <input
                      autoFocus
                      className="rename"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && draft.trim() !== '') {
                          void act(async () => {
                            await window.api.renameSupplier(s.id, draft)
                            setEditing(null)
                          })
                        }
                        if (e.key === 'Escape') cancel()
                      }}
                    />
                  ) : (
                    <b className="supplier">{s.name}</b>
                  )}
                </td>
                <td
                  className="num mono"
                  title={
                    s.totalItems === s.activeItems
                      ? undefined
                      : 'Активных в последнем прайсе / всего. Снятые с продажи остаются '
                        + 'ради истории цен и уйдут вместе с поставщиком.'
                  }
                >
                  {s.activeItems.toLocaleString('ru-RU')}
                  {s.totalItems !== s.activeItems && (
                    <span className="muted"> / {s.totalItems.toLocaleString('ru-RU')}</span>
                  )}
                </td>
                <td className="num mono">{s.files}</td>
                <td className="muted">
                  {s.profiles.length === 0 ? (
                    '—'
                  ) : (
                    s.profiles.map((p) => (
                      <span key={p.id} className="profile-chip">
                        <span className="mono">{p.filenameMask ?? 'без маски'}</span>
                        <button
                          className="tiny"
                          disabled={busy}
                          title="Удалить профиль: прайсы и позиции останутся, но следующий файл придётся разметить заново"
                          onClick={() => void act(() => window.api.removeMapping(p.id))}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </td>
                <td className="actions">
                  {editing === s.id ? (
                    <>
                      <button
                        className="primary small"
                        disabled={busy || draft.trim() === ''}
                        onClick={() =>
                          void act(async () => {
                            await window.api.renameSupplier(s.id, draft)
                            setEditing(null)
                          })
                        }
                      >
                        Сохранить
                      </button>
                      <button className="small" onClick={cancel}>Отмена</button>
                    </>
                  ) : confirming === s.id ? (
                    <>
                      <span className="warn confirm-text">
                        {/* Удаление уносит и снятые с продажи позиции, поэтому здесь
                            всего, а не активных, как в колонке слева. */}
                        Удалить {plural(s.totalItems, 'позицию', 'позиции', 'позиций')}
                        {s.files > 0 && ` и ${plural(s.files, 'прайс', 'прайса', 'прайсов')}`}?
                      </span>
                      <button
                        className="small danger"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await window.api.removeSupplier(s.id)
                            setConfirming(null)
                          })
                        }
                      >
                        Да, удалить
                      </button>
                      <button className="small" onClick={cancel}>Отмена</button>
                    </>
                  ) : (
                    <>
                      <button className="small" disabled={busy} onClick={() => startRename(s)}>
                        Переименовать
                      </button>
                      <button
                        className="small danger"
                        disabled={busy}
                        onClick={() => { setConfirming(s.id); setEditing(null); setError(null) }}
                      >
                        Удалить
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * Русское склонение после числа: 1 позиция, 2 позиции, 5 позиций.
 *
 * «Удалить 3 120 прайс(ов)?» — не тот текст, который хочется читать в окне,
 * где нажатие необратимо.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const s = n.toLocaleString('ru-RU')
  const t = n % 100
  if (t >= 11 && t <= 14) return `${s} ${many}`
  const d = n % 10
  if (d === 1) return `${s} ${one}`
  if (d >= 2 && d <= 4) return `${s} ${few}`
  return `${s} ${many}`
}
