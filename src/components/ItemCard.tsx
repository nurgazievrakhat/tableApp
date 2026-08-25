import { useEffect, useState } from 'react'
import type { ItemDetail, PriceChange } from '@shared/types'
import SheetViewer from './SheetViewer.tsx'
import { useModal } from '../useModal.ts'

const money = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

const date = (ts: number | null) =>
  ts === null ? '—' : new Date(ts * 1000).toLocaleDateString('ru-RU')

interface Point { t: number; p: number }

/**
 * Точки для графика. Первая — цена до самого раннего изменения, дальше по
 * одной на каждое изменение.
 */
function series(changes: PriceChange[]): Point[] {
  const pts: Point[] = []
  if (changes.length === 0) return pts
  if (changes[0].from !== null) pts.push({ t: changes[0].at, p: changes[0].from })
  for (const c of changes) if (c.to !== null) pts.push({ t: c.at, p: c.to })
  return pts
}

function PriceChart({ changes }: { changes: PriceChange[] }) {
  const pts = series(changes)
  if (pts.length < 2) return null

  const W = 460
  const H = 120
  const PAD = { l: 8, r: 8, t: 14, b: 18 }

  const prices = pts.map((p) => p.p)
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const span = hi - lo || Math.max(hi * 0.1, 1)

  // Если все изменения пришлись на один день, шкала времени вырождается —
  // раскладываем точки равномерно по порядку.
  const t0 = pts[0].t
  const t1 = pts[pts.length - 1].t
  const flat = t1 === t0

  const x = (i: number) =>
    PAD.l +
    (flat
      ? (i / (pts.length - 1)) * (W - PAD.l - PAD.r)
      : ((pts[i].t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r))

  const y = (p: number) => PAD.t + (1 - (p - lo) / span) * (H - PAD.t - PAD.b)

  // Ступенчатая линия: цена держится до следующего изменения.
  let d = `M ${x(0)} ${y(pts[0].p)}`
  for (let i = 1; i < pts.length; i++) d += ` L ${x(i)} ${y(pts[i - 1].p)} L ${x(i)} ${y(pts[i].p)}`

  const last = pts[pts.length - 1]
  const rising = last.p > pts[0].p

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="История цены">
      <path d={d} fill="none" stroke={rising ? 'var(--err)' : 'var(--ok)'} strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.p)} r="3" fill={rising ? 'var(--err)' : 'var(--ok)'} />
          {/* Крайние подписи прижимаем внутрь, иначе их срезает край области. */}
          <text
            x={x(i)}
            y={y(p.p) - 7}
            className="chart-label"
            textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}
          >
            {money(p.p)}
          </text>
        </g>
      ))}
      <text x={PAD.l} y={H - 4} className="chart-axis">{date(t0)}</text>
      {!flat && (
        <text x={W - PAD.r} y={H - 4} className="chart-axis" textAnchor="end">{date(t1)}</text>
      )}
    </svg>
  )
}

export default function ItemCard({ itemId, onClose }: { itemId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)

  useEffect(() => {
    setDetail(null)
    window.api.itemDetail(itemId).then(setDetail).catch((e: Error) => setError(e.message))
  }, [itemId])

  useModal(onClose, !viewing)

  return (
    <>
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="grow">Карточка позиции</span>
          <button className="close" onClick={onClose} title="Закрыть (Esc)">×</button>
        </header>

        <div className="body">
        {error && <pre>{error}</pre>}
        {!detail && !error && <div className="muted">Загрузка…</div>}

        {detail && (
          <>
            <h2 className="item-title">{detail.name}</h2>
            <div className="item-sub">
              <span className="supplier">{detail.supplierName}</span>
              {detail.article && <span className="art">{detail.article}</span>}
              {!detail.isActive && <span className="tag">нет в прайсе</span>}
            </div>

            <dl className="item-facts">
              <dt>Цена</dt>
              <dd className="mono big">{money(detail.price)} <span className="muted">{detail.unit}</span></dd>
              <dt>Производитель</dt><dd>{detail.manufacturer ?? '—'}</dd>
              <dt>Годен до</dt><dd className="mono">{date(detail.expiry)}</dd>
              <dt>Остаток</dt><dd>{detail.stock ?? '—'}</dd>
              <dt>Категория</dt><dd className="muted">{detail.category ?? '—'}</dd>
              <dt>Дата прайса</dt><dd className="mono">{date(detail.priceDate)}</dd>
            </dl>

            {detail.promoRaw && (
              <p className="promo-raw" title="Как записано в прайсе">{detail.promoRaw}</p>
            )}

            {Object.keys(detail.extra).length > 0 && (
              <>
                <h3>Прочие колонки прайса</h3>
                <dl className="item-facts">
                  {Object.entries(detail.extra).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            <h3>История цены</h3>
            {detail.changes.length === 0 ? (
              <p className="muted">Цена не менялась с момента первой загрузки.</p>
            ) : (
              <>
                <PriceChart changes={detail.changes} />
                <table className="changes">
                  <tbody>
                    {[...detail.changes].reverse().map((c, i) => (
                      <tr key={i}>
                        <td className="mono muted">{date(c.at)}</td>
                        <td className="mono">{money(c.from)}</td>
                        <td className="muted">→</td>
                        <td className="mono">{money(c.to)}</td>
                        <td className={c.pct !== null && c.pct > 0 ? 'trend up' : 'trend down'}>
                          {c.pct === null ? '' : `${c.pct > 0 ? '+' : ''}${c.pct}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <p className="source-line muted" title={detail.filePath}>
              <span className="grow">
                Источник: {detail.fileName} · лист {detail.sheet} · строка {detail.rowNo ?? '—'}
              </span>
              <button className="small" onClick={() => setViewing(true)}>
                Показать в файле
              </button>
            </p>
          </>
        )}
        </div>
      </div>
    </div>

    {viewing && detail && (
      <SheetViewer
        target={{
          path: detail.filePath,
          fileName: detail.fileName,
          sheet: detail.sheet,
          row: detail.rowNo,
        }}
        onClose={() => setViewing(false)}
      />
    )}
    </>
  )
}
