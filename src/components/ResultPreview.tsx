import type { Field, SheetPreview } from '@shared/types'
// Разборщики значений — чистые функции без обращений к системе, поэтому их
// можно взять и в интерфейс. Важно, что это те же самые функции, которыми
// пойдёт настоящий импорт: показанное здесь не может разойтись с тем, что
// окажется в базе.
import { parseNumber } from '../../electron/parser/values.ts'
import { parseExpiry } from '../../electron/parser/expiry.ts'
import { parsePromo } from '../../electron/parser/promo.ts'
import { normalizeUnit } from '../../electron/parser/normalize.ts'
import { FIELD_LABEL } from '../fields.ts'

/** Поля показываем в том порядке, в каком человек читает карточку товара. */
const ORDER: Field[] = [
  'name', 'article', 'price', 'unit', 'manufacturer', 'expiry', 'stock', 'promo', 'packQty', 'vat',
]

/** Первая строка, похожая на товар: не категория и не почти пустая. */
function firstItemRow(preview: SheetPreview, nameCol: number | undefined): number | null {
  const header = preview.headerRow ?? -1
  for (let i = 0; i < preview.sample.length; i++) {
    const idx = preview.sampleFrom + i
    if (idx <= header) continue
    const row = preview.sample[i]
    if (nameCol !== undefined && (row[nameCol] ?? '').trim() === '') continue
    if (row.filter((v) => v && v.trim() !== '').length >= 3) return i
  }
  return null
}

interface Shown {
  field: Field
  raw: string
  value: string
  bad: boolean
}

export default function ResultPreview({
  preview, columns,
}: {
  preview: SheetPreview
  columns: Partial<Record<Field, number>>
}) {
  const i = firstItemRow(preview, columns.name)
  if (i === null) return <p className="hint">Пока не видно ни одной строки с товаром.</p>

  const row = preview.sample[i]
  const rowNo = preview.sampleFrom + i + 1

  const shown: Shown[] = []
  for (const field of ORDER) {
    const col = columns[field]
    if (col === undefined) continue
    const raw = row[col] ?? ''
    shown.push({ field, raw, ...interpret(field, raw) })
  }

  return (
    <>
      <table className="result-preview">
        <tbody>
          {shown.map((s) => (
            <tr key={s.field} className={s.bad ? 'bad' : undefined}>
              <td className="label">{FIELD_LABEL[s.field]}</td>
              <td className={s.bad ? 'warn' : 'value'}>{s.value}</td>
              {s.raw !== s.value && (
                <td className="muted raw" title="Как записано в прайсе">{s.raw}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Строка {rowNo} прайса — так она будет выглядеть в базе.</p>
    </>
  )
}

/** Как приложение поймёт значение в этой роли. */
function interpret(field: Field, raw: string): { value: string; bad: boolean } {
  const empty = raw.trim() === ''

  switch (field) {
    case 'price': {
      const n = parseNumber(raw)
      return n === null
        ? { value: empty ? 'пусто' : 'не похоже на цену', bad: true }
        : { value: n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }), bad: false }
    }
    case 'expiry': {
      const ts = parseExpiry(raw)
      return ts === null
        ? { value: empty ? 'пусто' : 'не похоже на дату', bad: !empty }
        : { value: new Date(ts * 1000).toLocaleDateString('ru-RU'), bad: false }
    }
    case 'unit': {
      const u = normalizeUnit(raw)
      return { value: u || 'пусто', bad: false }
    }
    case 'promo': {
      const p = parsePromo(raw)
      if (empty) return { value: 'нет', bad: false }
      if (p.pct !== null) return { value: `скидка ${p.pct}%`, bad: false }
      if (p.bulkPct !== null) {
        return { value: `от ${p.bulkMinQty} уп: ${p.bulkPct}%`, bad: false }
      }
      return { value: 'условие не разобрано, сохраним как есть', bad: false }
    }
    default:
      return { value: empty ? 'пусто' : raw, bad: false }
  }
}
