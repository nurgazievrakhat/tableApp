import { useEffect, useState } from 'react'
import type { ChangesReport, Supplier } from '@shared/types'
import ItemCard from './ItemCard.tsx'

const PERIODS: { label: string; days: number | null }[] = [
  { label: 'неделя', days: 7 },
  { label: 'месяц', days: 30 },
  { label: 'квартал', days: 90 },
  { label: 'всё время', days: null },
]

const money = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

const date = (ts: number) => new Date(ts * 1000).toLocaleDateString('ru-RU')

export default function ChangesView() {
  const [days, setDays] = useState<number | null>(30)
  const [direction, setDirection] = useState<'all' | 'up' | 'down'>('all')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [report, setReport] = useState<ChangesReport | null>(null)
  const [openItem, setOpenItem] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void window.api.listSuppliers().then(setSuppliers) }, [])

  useEffect(() => {
    const since = days === null ? 0 : Math.floor(Date.now() / 1000) - days * 86_400
    window.api
      .priceChanges({
        since,
        direction,
        supplierIds: selected.length ? selected : undefined,
        limit: 300,
      })
      .then((r) => { setReport(r); setError(null) })
      .catch((e: Error) => { setError(e.message); setReport(null) })
  }, [days, direction, selected])

  return (
    <>
      <section className="panel-box">
        <header>Что изменилось в ценах</header>
        <div className="body">
        <div className="toolbar">
          {PERIODS.map((p) => (
            <button
              key={p.label}
              className={days === p.days ? 'chip on' : 'chip'}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
          <span className="sep" />
          {(['all', 'up', 'down'] as const).map((d) => (
            <button
              key={d}
              className={direction === d ? 'chip on' : 'chip'}
              onClick={() => setDirection(d)}
            >
              {d === 'all' ? 'все' : d === 'up' ? 'подорожало' : 'подешевело'}
            </button>
          ))}
          <span className="sep" />
          {suppliers.map((s) => (
            <button
              key={s.id}
              className={selected.includes(s.id) ? 'chip on' : 'chip'}
              onClick={() =>
                setSelected((prev) =>
                  prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                )
              }
            >
              {s.name}
            </button>
          ))}
        </div>

        {error && <pre>{error}</pre>}

        {report && (
          <p className="hint muted">
            {report.total === 0 ? (
              'За выбранный период цены не менялись'
            ) : (
              <>
                Изменений: {report.total} · подорожало{' '}
                <span className="trend up">{report.up}</span> · подешевело{' '}
                <span className="trend down">{report.down}</span> · {report.elapsedMs} мс
              </>
            )}
          </p>
        )}
        </div>
      </section>

      {report && report.rows.length > 0 && (
        <section className="panel-box">
          <div className="body">
            <p className="hint">
              Сначала самые заметные изменения. Строка открывает карточку позиции.
            </p>
          </div>
          <div className="scroll tall">
            <table className="results">
              <thead>
                <tr>
                  <th className="num">Дата</th>
                  <th>Поставщик</th>
                  <th>Наименование</th>
                  <th className="num">Было</th>
                  <th className="num">Стало</th>
                  <th className="num">Изменение</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr
                    key={`${r.itemId}-${r.at}-${i}`}
                    className="clickable"
                    onClick={() => setOpenItem(r.itemId)}
                  >
                    <td className="num mono muted">{date(r.at)}</td>
                    <td className="supplier">{r.supplierName}</td>
                    <td>{r.name}</td>
                    <td className="num mono muted">{money(r.from)}</td>
                    <td className="num mono">{money(r.to)}</td>
                    <td className={r.pct > 0 ? 'num trend up' : 'num trend down'}>
                      {r.pct > 0 ? '▲ +' : '▼ '}
                      {r.pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {openItem !== null && <ItemCard itemId={openItem} onClose={() => setOpenItem(null)} />}
    </>
  )
}
