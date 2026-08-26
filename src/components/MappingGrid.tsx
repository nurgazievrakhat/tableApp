import type { ColumnCheck, Field, SheetPreview } from '@shared/types'
import { FIELD_LABEL, FIELD_ORDER } from '../fields.ts'

/** Колонка считается пустой, если заполнена меньше чем в 3% строк. */
const EMPTY_THRESHOLD = 0.03
/** Сколько строк прайса показываем под шапкой. */
const SAMPLE_ROWS = 6

const colName = (i: number): string => {
  let s = ''
  let n = i
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

export interface MappingGridProps {
  preview: SheetPreview
  columns: Partial<Record<Field, number>>
  problems: Map<number, ColumnCheck>
  showAll: boolean
  onAssign: (col: number, field: Field | '') => void
  /** Клик по номеру строки — назначить её строкой заголовков. */
  onPickHeader: (rowIndex: number) => void
}

/**
 * Разметка прямо на фрагменте прайса.
 *
 * Колонки идут слева направо, как в Excel, а выпадающий список стоит над
 * колонкой — то есть ровно там, где пользователь только что видел свои данные.
 * Списком сверху вниз, как было раньше, приходилось держать соответствие
 * «третья строка списка = третья колонка файла» в голове.
 */
export default function MappingGrid({
  preview, columns, problems, showAll, onAssign, onPickHeader,
}: MappingGridProps) {
  const roleOf = new Map<number, Field>()
  for (const [f, c] of Object.entries(columns)) roleOf.set(c as number, f as Field)

  // Пустые колонки прячем: у «Бимед Фарм» лист на 256 колонок при восьми
  // заполненных, и показывать все — значит утопить нужное.
  const visible: number[] = []
  for (let c = 0; c < preview.cols; c++) {
    const filled = preview.columnFill[c] ?? 0
    if (showAll || filled >= EMPTY_THRESHOLD || roleOf.has(c)) visible.push(c)
  }

  const headerRow = preview.headerRow ?? -1
  const rows: number[] = []
  for (let i = 0; i < preview.sample.length && rows.length < SAMPLE_ROWS; i++) {
    const idx = preview.sampleFrom + i
    if (idx > headerRow) rows.push(i)
  }

  return (
    <div className="mapgrid-scroll">
      <table className="mapgrid">
        <thead>
          <tr className="letters">
            <th />
            {visible.map((c) => (
              <th key={c}>{colName(c)}</th>
            ))}
          </tr>
          <tr className="roles">
            <th />
            {visible.map((c) => {
              const problem = problems.get(c)
              return (
                <th key={c} className={problem ? 'has-problem' : undefined}>
                  <select
                    value={roleOf.get(c) ?? ''}
                    className={roleOf.has(c) ? 'assigned' : undefined}
                    onChange={(e) => onAssign(c, e.target.value as Field | '')}
                  >
                    <option value="">не нужно</option>
                    {FIELD_ORDER.map((f) => (
                      <option key={f} value={f}>{FIELD_LABEL[f]}</option>
                    ))}
                  </select>
                  {problem && (
                    <span className="col-flag" title={`Ожидались ${problem.expected}`}>
                      проверьте
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {headerRow >= 0 && headerRow >= preview.sampleFrom && (
            <tr className="headerRow">
              <td
                className="rowno mono"
                title="Это строка заголовков"
                onClick={() => onPickHeader(headerRow)}
              >
                {headerRow + 1}
              </td>
              {visible.map((c) => (
                <td key={c}>{preview.sample[headerRow - preview.sampleFrom]?.[c] ?? ''}</td>
              ))}
            </tr>
          )}
          {rows.map((i) => {
            const idx = preview.sampleFrom + i
            return (
              <tr key={idx}>
                <td
                  className="rowno mono"
                  title="Сделать эту строку заголовками"
                  onClick={() => onPickHeader(idx)}
                >
                  {idx + 1}
                </td>
                {visible.map((c) => (
                  <td
                    key={c}
                    className={roleOf.has(c) ? 'mapped' : undefined}
                    title={preview.sample[i][c]}
                  >
                    {preview.sample[i][c]}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
