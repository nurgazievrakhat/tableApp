import { useCallback, useEffect, useRef, useState } from 'react'
import type { Field, SheetWindow } from '@shared/types'
import { FIELD_LABEL } from '../fields.ts'
import { useModal } from '../useModal.ts'

/** Высота строки задана в CSS и здесь — иначе виртуализация не сойдётся. */
const ROW_H = 26
/** Сколько строк держим загруженными вокруг видимой области. */
const CHUNK = 300

export interface ViewerTarget {
  path: string
  fileName: string
  sheet: string
  /** Строка, к которой надо перейти (1-based, как в Excel). */
  row?: number | null
  headerRow?: number | null
  columns?: Partial<Record<Field, number>>
}

const colName = (i: number): string => {
  let s = ''
  let n = i
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

export default function SheetViewer({
  target, onClose,
}: {
  target: ViewerTarget
  onClose: () => void
}) {
  const [win, setWin] = useState<SheetWindow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [goto, setGoto] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  const load = useCallback(
    async (from: number) => {
      const ticket = ++seq.current
      setLoading(true)
      try {
        const w = await window.api.readRows(
          target.path, target.sheet,
          Math.max(0, from), CHUNK,
          target.headerRow ?? undefined,
        )
        if (ticket === seq.current) { setWin(w); setError(null) }
      } catch (e) {
        if (ticket === seq.current) setError((e as Error).message)
      } finally {
        if (ticket === seq.current) setLoading(false)
      }
    },
    [target.path, target.sheet, target.headerRow],
  )

  // Открываемся сразу на нужной строке — ради этого вьюер и вызывают из карточки.
  useEffect(() => {
    const focus = (target.row ?? 1) - 1
    void load(focus - Math.floor(CHUNK / 3)).then(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = Math.max(0, focus * ROW_H - el.clientHeight / 2)
    })
  }, [load, target.row])

  useModal(onClose)

  /** Догружаем окно, когда прокрутка вышла за пределы загруженного куска. */
  function onScroll() {
    const el = scrollRef.current
    if (!el || !win) return
    const firstVisible = Math.floor(el.scrollTop / ROW_H)
    const lastVisible = firstVisible + Math.ceil(el.clientHeight / ROW_H)
    const loadedTo = win.from + win.rows.length
    if (firstVisible < win.from + 20 || lastVisible > loadedTo - 20) {
      void load(firstVisible - Math.floor(CHUNK / 3))
    }
  }

  function jump(rowNumber: number) {
    const el = scrollRef.current
    if (!el) return
    const idx = Math.max(0, rowNumber - 1)
    void load(idx - Math.floor(CHUNK / 3))
    el.scrollTop = Math.max(0, idx * ROW_H - el.clientHeight / 2)
  }

  const roleOf = new Map<number, Field>()
  for (const [f, c] of Object.entries(target.columns ?? {})) roleOf.set(c as number, f as Field)

  const headerRow = target.headerRow ?? win?.headerRow ?? null
  const total = win?.total ?? 0
  const cols = win?.cols ?? 0

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="grow">
            {target.fileName}
            <span className="muted"> · лист {target.sheet}</span>
          </span>
          <button className="close" onClick={onClose} title="Закрыть (Esc)">×</button>
        </header>

        <div className="viewer-toolbar">
          <span className="muted">
            строк: <b>{total.toLocaleString('ru-RU')}</b>
            {cols > 0 && <> · колонок: <b>{cols}</b></>}
          </span>
          <span className="sep" />
          <label className="inline">
            Перейти к строке
            <input
              type="number"
              min={1}
              max={total || undefined}
              value={goto}
              onChange={(e) => setGoto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && goto !== '') jump(Number(goto))
              }}
            />
          </label>
          <button className="small" onClick={() => goto !== '' && jump(Number(goto))}>
            Перейти
          </button>
          {headerRow !== null && (
            <>
              <span className="sep" />
              <button className="small" onClick={() => jump(headerRow + 1)}>
                К шапке (строка {headerRow + 1})
              </button>
            </>
          )}
          {target.row && (
            <button className="small" onClick={() => jump(target.row!)}>
              К позиции (строка {target.row})
            </button>
          )}
          {loading && <span className="muted">читаю…</span>}
        </div>

        {error && <div className="body"><pre>{error}</pre></div>}

        <div className="viewer-scroll" ref={scrollRef} onScroll={onScroll}>
          {win && (
            <div style={{ height: total * ROW_H, position: 'relative' }}>
              <table
                className="sheet"
                style={{ position: 'absolute', top: win.from * ROW_H, width: '100%' }}
              >
                <thead>
                  <tr>
                    <th />
                    {Array.from({ length: cols }, (_, c) => (
                      <th key={c}>
                        {colName(c)}
                        {roleOf.has(c) && (
                          <span className="role">{FIELD_LABEL[roleOf.get(c)!]}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {win.rows.map((row, i) => {
                    const rowIndex = win.from + i
                    const isHeader = rowIndex === headerRow
                    const isTarget = target.row != null && rowIndex === target.row - 1
                    const cls = [isHeader && 'headerRow', isTarget && 'target']
                      .filter(Boolean)
                      .join(' ')
                    return (
                      <tr key={rowIndex} className={cls} style={{ height: ROW_H }}>
                        <td className="rowno mono">{rowIndex + 1}</td>
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            className={roleOf.has(c) ? 'mapped' : undefined}
                            title={cell}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
