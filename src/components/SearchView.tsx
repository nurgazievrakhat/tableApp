import { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupedResult, SearchHit, SearchResult, Supplier } from '@shared/types'
import GroupedResults from './GroupedResults.tsx'
import ItemCard from './ItemCard.tsx'

const LIMIT = 200

const money = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

const shortDate = (ts: number | null) =>
  ts === null ? '' : new Date(ts * 1000).toLocaleDateString('ru-RU', { month: '2-digit', year: '2-digit' })

/** Разница со старой ценой: стрелка и процент. */
function PriceTrend({ hit }: { hit: SearchHit }) {
  if (hit.prevPrice === null || hit.price === null || hit.prevPrice === hit.price) return null
  const up = hit.price > hit.prevPrice
  const pct = Math.round(((hit.price - hit.prevPrice) / hit.prevPrice) * 100)
  return (
    <span className={up ? 'trend up' : 'trend down'} title={`было ${money(hit.prevPrice)}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

export default function SearchView() {
  const [text, setText] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [maxPrice, setMaxPrice] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)
  const [grouped, setGrouped] = useState(false)
  const [onlyMulti, setOnlyMulti] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [groups, setGroups] = useState<GroupedResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /**
   * Номер последнего отправленного запроса. Отмена таймера debounce не
   * отменяет уже ушедший запрос, и медленный ответ на старый запрос мог
   * затереть свежий результат — при быстрых локальных запросах это
   * проявляется редко, но воспроизводится.
   */
  const seq = useRef(0)
  /** Меняется после ручной склейки — заставляет выдачу перезапроситься. */
  const [revision, setRevision] = useState(0)
  const [openItem, setOpenItem] = useState<number | null>(null)

  useEffect(() => {
    void window.api.listSuppliers().then(setSuppliers)
    inputRef.current?.focus()
  }, [])

  // Запрос уходит с задержкой: иначе на каждое нажатие клавиши идёт поиск.
  useEffect(() => {
    if (text.trim() === '') {
      seq.current++
      setResult(null)
      setGroups(null)
      return
    }
    const timer = setTimeout(() => {
      const ticket = ++seq.current
      const query = {
        text,
        supplierIds: selected.length ? selected : undefined,
        maxPrice: maxPrice === '' ? null : Number(maxPrice),
        onlyActive,
        limit: LIMIT,
      }
      const request = grouped
        ? window.api.searchGrouped({ ...query, onlyMulti })
        : window.api.search(query)

      request
        .then((r) => {
          if (ticket !== seq.current) return
          if ('groups' in r) { setGroups(r); setResult(null) }
          else { setResult(r); setGroups(null) }
          setError(null)
        })
        .catch((e: Error) => {
          if (ticket !== seq.current) return
          setError(e.message)
          setResult(null)
          setGroups(null)
        })
    }, 180)
    return () => clearTimeout(timer)
  }, [text, selected, maxPrice, onlyActive, grouped, onlyMulti, revision])

  function toggleSupplier(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const view = result ?? groups
  const corrected = useMemo(
    () => view?.corrections.map((c) => `${c.from} → ${c.to}`).join(', ') ?? '',
    [view],
  )
  const found = result ? result.total : (groups?.total ?? 0)

  return (
    <>
      <section className="panel-box">
        <div className="body">
        <input
          ref={inputRef}
          className="search"
          value={text}
          placeholder="Название или артикул — например, аэртал 100 мг"
          onChange={(e) => setText(e.target.value)}
        />

        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Режим показа">
            <button className={grouped ? '' : 'on'} onClick={() => setGrouped(false)}>
              Список
            </button>
            <button
              className={grouped ? 'on' : ''}
              onClick={() => setGrouped(true)}
              title="Одна строка на товар, цены всех поставщиков рядом"
            >
              Сравнение цен
            </button>
          </div>
          <span className="sep" />
          {suppliers.map((s) => (
            <button
              key={s.id}
              className={selected.includes(s.id) ? 'chip on' : 'chip'}
              onClick={() => toggleSupplier(s.id)}
            >
              {s.name}
            </button>
          ))}
          <label className="inline">
            цена до
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              style={{ width: 90 }}
            />
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={!onlyActive}
              onChange={(e) => setOnlyActive(!e.target.checked)}
            />
            показывать снятые с прайса
          </label>

          {grouped && (
            <label className="inline">
              <input
                type="checkbox"
                checked={onlyMulti}
                onChange={(e) => setOnlyMulti(e.target.checked)}
              />
              только там, где есть выбор
            </label>
          )}
        </div>

        {error && <pre>{error}</pre>}

        {view && (
          <p className="hint muted">
            {found === 0 ? (
              'Ничего не найдено'
            ) : (
              <>
                Найдено {found} {grouped ? 'товаров' : 'позиций'}
                {found > LIMIT && ` · показаны первые ${LIMIT}, уточните запрос`}
                {' · '}
                {view.elapsedMs} мс
              </>
            )}
            {corrected && <span className="warn"> · исправлено: {corrected}</span>}
          </p>
        )}
        </div>
      </section>

      {groups && groups.groups.length > 0 && (
        <GroupedResults
          result={groups}
          onChanged={() => setRevision((r) => r + 1)}
          onOpenItem={setOpenItem}
        />
      )}

      {result && result.hits.length > 0 && (
        <section className="panel-box">
          <div className="scroll tall">
            <table className="results">
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th>Наименование</th>
                  <th className="num">Цена</th>
                  <th className="num">Со скидкой</th>
                  <th className="num">От кол-ва</th>
                  <th>Ед.</th>
                  <th>Производитель</th>
                  <th className="num">Годен до</th>
                </tr>
              </thead>
              <tbody>
                {result.hits.map((h) => (
                  <tr
                    key={h.id}
                    className={h.isActive ? 'clickable' : 'inactive clickable'}
                    onClick={() => setOpenItem(h.id)}
                  >
                    <td className="supplier">{h.supplierName}</td>
                    <td title={h.category ?? ''}>
                      {h.name}
                      {!h.isActive && <span className="tag">нет в прайсе</span>}
                    </td>
                    <td className="num mono">
                      {money(h.price)} <PriceTrend hit={h} />
                    </td>
                    <td className="num mono promo">
                      {h.promoPrice !== null ? (
                        <>
                          {money(h.promoPrice)}
                          <span className="pct">−{h.promoPct}%</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num mono promo">
                      {h.bulkPrice !== null ? (
                        <>
                          {money(h.bulkPrice)}
                          <span className="pct">от {h.bulkMinQty} уп</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">{h.unit}</td>
                    <td className="muted ellipsis">{h.manufacturer}</td>
                    <td className="num muted mono">{shortDate(h.expiry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {openItem !== null && <ItemCard itemId={openItem} onClose={() => setOpenItem(null)} />}

      {!view && (
        <section className="panel-box">
          <div className="body">
          <p className="muted">
            Поиск идёт сразу по всем импортированным прайсам. Порядок слов не важен,
            дозировку можно писать и слитно, и через пробел. Опечатки исправляются
            по словам, которые встречаются в ваших прайсах.
          </p>
          <p className="muted">
            Режим <b>сравнения цен</b> схлопывает одинаковый товар разных поставщиков
            в одну строку и показывает, у кого дешевле.
          </p>
          </div>
        </section>
      )}
    </>
  )
}
