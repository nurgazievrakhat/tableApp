import { useEffect, useState } from 'react'
import type { GroupedResult, MatchSuggestion, ProductGroup, SearchHit } from '@shared/types'

const money = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

/** Насколько это предложение дороже самого дешёвого в группе. */
function overpay(offer: SearchHit, min: number | null): string {
  if (min === null || offer.price === null || min <= 0 || offer.price === min) return ''
  return `+${Math.round(((offer.price - min) / min) * 100)}%`
}

function Group({
  group, onMerged, onOpenItem,
}: {
  group: ProductGroup
  onMerged: () => void
  onOpenItem: (itemId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<MatchSuggestion[] | null>(null)
  const [merging, setMerging] = useState<number | null>(null)

  // Подсказки считаются только для развёрнутого товара — их незачем готовить
  // для всей выдачи заранее.
  useEffect(() => {
    if (!open || suggestions !== null) return
    void window.api.suggestMatches(group.productId).then(setSuggestions).catch(() => setSuggestions([]))
  }, [open, suggestions, group.productId])

  async function merge(id: number) {
    setMerging(id)
    try {
      await window.api.mergeProducts(group.productId, [id])
      // Товар изменился — старые подсказки устарели и должны пересчитаться,
      // иначе предлагают склеить уже склеенное.
      setSuggestions(null)
      onMerged()
    } finally {
      setMerging(null)
    }
  }
  const best = group.offers.find((o) => o.price === group.minPrice) ?? group.offers[0]
  const single = group.supplierCount < 2

  return (
    <>
      <tr
        className={single ? 'group single clickable' : 'group clickable'}
        onClick={() => setOpen((v) => !v)}
      >
        <td className="caret">{open ? '▾' : '▸'}</td>
        <td>
          {group.title}
          <span className="offers-count">
            {single ? 'один поставщик' : `${group.supplierCount} поставщика`}
            {group.unitsDiffer && (
              <span
                className="unit-warn"
                title="Единицы измерения у поставщиков разные — цены напрямую не сравнимы"
              >
                разные единицы
              </span>
            )}
          </span>
        </td>
        <td className="supplier">{best.supplierName}</td>
        <td className="num mono best">{money(group.minPrice)}</td>
        <td className="num mono muted">{single ? '' : money(group.maxPrice)}</td>
        <td className="num mono">
          {group.spreadPct !== null && group.spreadPct > 0 && (
            <span
              className={
                group.unitsDiffer ? 'spread muted' : group.spreadPct >= 20 ? 'spread big' : 'spread'
              }
            >
              {group.unitsDiffer ? '≈' : ''}+{group.spreadPct}%
            </span>
          )}
        </td>
      </tr>

      {open &&
        group.offers.map((o) => (
          <tr
            key={o.id}
            className="offer clickable"
            onClick={(e) => { e.stopPropagation(); onOpenItem(o.id) }}
          >
            <td />
            <td className="muted offer-name" title={o.name}>
              {o.name}
              {o.article && <span className="art">{o.article}</span>}
            </td>
            <td className="supplier">{o.supplierName}</td>
            <td className="num mono">
              {money(o.price)}
              {o.promoPrice !== null && (
                <span className="pct">со скидкой {money(o.promoPrice)}</span>
              )}
            </td>
            <td className="num mono unit">{o.unit}</td>
            <td className="num mono">
              <span className="over">{overpay(o, group.minPrice)}</span>
            </td>
          </tr>
        ))}

      {open && suggestions && suggestions.length > 0 && (
        <tr className="offer suggest">
          <td />
          <td colSpan={5}>
            <div className="suggest-head">
              Похожие товары — совпали бренд, дозировка и количество. Проверьте:
              признаки не различают вкус, форму и производителя.
            </div>
            {suggestions.map((s) => (
              <div key={s.productId} className="suggest-row">
                <span className="suggest-title">{s.title}</span>
                <span className="supplier">{s.suppliers.join(', ')}</span>
                <span className="mono">{money(s.minPrice)}</span>
                <button
                  className="small"
                  disabled={merging !== null}
                  onClick={(e) => { e.stopPropagation(); void merge(s.productId) }}
                >
                  {merging === s.productId ? '…' : 'Это тот же товар'}
                </button>
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  )
}

export default function GroupedResults({
  result, onChanged, onOpenItem,
}: {
  result: GroupedResult
  onChanged: () => void
  onOpenItem: (itemId: number) => void
}) {
  return (
    <section className="panel-box">
      <div className="body">
        <p className="hint">
          Одна строка — один товар. Разворачивается в предложения поставщиков;
          самое дешёвое подсвечено.
          {result.onlyMulti && ' Показаны только товары, которые есть больше чем у одного поставщика.'}
        </p>
      </div>
      <div className="scroll tall">
        <table className="results grouped">
          <thead>
            <tr>
              <th />
              <th>Товар</th>
              <th>Дешевле всего у</th>
              <th className="num">Мин. цена</th>
              <th className="num">Макс.</th>
              <th className="num">Разброс</th>
            </tr>
          </thead>
          <tbody>
            {result.groups.map((g) => (
              <Group
                key={g.productId}
                group={g}
                onMerged={onChanged}
                onOpenItem={onOpenItem}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
