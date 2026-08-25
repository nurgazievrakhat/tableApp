import { useEffect, useState } from 'react'
import type { Field, Mapping, SheetPreview, Supplier } from '@shared/types'
import { FIELD_LABEL, FIELD_ORDER, REQUIRED_FIELDS } from '../fields.ts'

interface Props {
  fileName: string
  preview: SheetPreview
  profile: Mapping | null
  suppliers: Supplier[]
  busy: boolean
  onHeaderRowChange: (row: number) => void
  onSaved: (m: Mapping) => void
}

type Columns = Partial<Record<Field, number>>

/**
 * Представительная строка товара для колонки «Пример значения».
 *
 * Первая непустая строка не годится: сразу под шапкой часто идёт категория
 * («Лекарственные средства, БАДЫ»), у которой заполнена одна ячейка. Берём
 * первую строку, где заполнено хотя бы три колонки, — и показываем примеры
 * из неё одной, чтобы пользователь видел цельную запись, а не винегрет.
 */
function exampleRow(preview: SheetPreview): string[] | null {
  const header = preview.headerRow ?? -1
  for (let i = 0; i < preview.sample.length; i++) {
    if (preview.sampleFrom + i <= header) continue
    const row = preview.sample[i]
    if (row.filter((v) => v && v.trim() !== '').length >= 3) return row
  }
  return null
}

export default function MappingEditor({
  fileName, preview, profile, suppliers, busy, onHeaderRowChange, onSaved,
}: Props) {
  const [supplierName, setSupplierName] = useState('')
  const [columns, setColumns] = useState<Columns>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Профиль побеждает автоопределение: ради этого он и сохранялся.
  useEffect(() => {
    setColumns(profile ? { ...profile.columns } : { ...(preview.map?.fields ?? {}) })
    setSupplierName(profile?.supplierName ?? '')
    setSaved(null)
    setError(null)
  }, [preview, profile])

  /** Поле закреплено ровно за одной колонкой: назначая, снимаем со старой. */
  function assign(col: number, field: Field | '') {
    setColumns((prev) => {
      const next: Columns = {}
      for (const [f, c] of Object.entries(prev)) {
        if (c !== col && f !== field) next[f as Field] = c as number
      }
      if (field !== '') next[field] = col
      return next
    })
    setSaved(null)
  }

  const roleOf = new Map<number, Field>()
  for (const [f, c] of Object.entries(columns)) roleOf.set(c as number, f as Field)

  const example = exampleRow(preview)

  const missing = REQUIRED_FIELDS.filter((f) => columns[f] === undefined)
  const canSave = supplierName.trim() !== '' && missing.length === 0 && !busy && !saving

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const m = await window.api.saveMapping({
        id: profile?.id,
        supplierName: supplierName.trim(),
        signature: preview.signature,
        fileName, // из него main выведет маску имени файла
        headerRow: preview.headerRow ?? 0,
        dataStartRow: preview.dataStartRow,
        columns,
      })
      setSaved(`Профиль «${m.supplierName}» сохранён`)
      onSaved(m)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Разметка колонок</h2>

      {profile ? (
        <p className="hint ok">
          ✓ Найден профиль «{profile.supplierName}» — разметка применена автоматически.
          Правки ниже перезапишут его.
        </p>
      ) : (
        <p className="hint muted">
          Профиль для этого файла ещё не сохранён. Проверьте разметку, назовите
          поставщика и сохраните — следующий его прайс разметится сам.
        </p>
      )}

      <div className="form">
        <label>
          <span>Поставщик</span>
          <input
            list="suppliers"
            value={supplierName}
            placeholder="например, Неман-Фарм"
            onChange={(e) => { setSupplierName(e.target.value); setSaved(null) }}
          />
          <datalist id="suppliers">
            {suppliers.map((s) => <option key={s.id} value={s.name} />)}
          </datalist>
        </label>

        <label>
          <span>Строка заголовков</span>
          <input
            type="number"
            min={1}
            max={preview.rows}
            value={(preview.headerRow ?? 0) + 1}
            disabled={busy}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (n >= 1 && n <= preview.rows) onHeaderRowChange(n - 1)
            }}
          />
        </label>

        <label>
          <span>Отпечаток</span>
          <code className="mono muted">{preview.signature ?? '—'}</code>
        </label>
      </div>

      <table className="mapping">
        <thead>
          <tr><th className="num">Колонка</th><th>Заголовок в файле</th><th>Роль</th><th>Пример значения</th></tr>
        </thead>
        <tbody>
          {preview.headers.map((header, col) => (
              <tr key={col} className={roleOf.has(col) ? 'assigned' : ''}>
                <td className="num mono muted">{col}</td>
                <td>{header || <span className="muted">пусто</span>}</td>
                <td>
                  <select
                    value={roleOf.get(col) ?? ''}
                    onChange={(e) => assign(col, e.target.value as Field | '')}
                  >
                    <option value="">— не использовать —</option>
                    {FIELD_ORDER.map((f) => (
                      <option key={f} value={f}>{FIELD_LABEL[f]}</option>
                    ))}
                  </select>
                </td>
                <td className="muted ellipsis">{example?.[col] ?? ''}</td>
              </tr>
          ))}
        </tbody>
      </table>

      <div className="toolbar save">
        <button onClick={save} disabled={!canSave}>
          {saving ? 'Сохраняю…' : profile ? 'Обновить профиль' : 'Сохранить профиль'}
        </button>
        {missing.length > 0 && (
          <span className="warn">
            Не назначено обязательное: {missing.map((f) => FIELD_LABEL[f]).join(', ')}
          </span>
        )}
        {supplierName.trim() === '' && missing.length === 0 && (
          <span className="warn">Укажите поставщика</span>
        )}
        {saved && <span className="ok">{saved}</span>}
        {error && <span className="warn">{error}</span>}
      </div>
    </section>
  )
}
