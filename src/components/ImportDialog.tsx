import { useCallback, useEffect, useState } from 'react'
import type {
  ColumnCheck, Field, ImportOutcome, Mapping, OpenedFile, SheetPreview, Supplier,
} from '@shared/types'
import { FIELD_LABEL, FIELD_ORDER, REQUIRED_FIELDS } from '../fields.ts'
import SheetViewer from './SheetViewer.tsx'
import { useModal } from '../useModal.ts'

type Columns = Partial<Record<Field, number>>

/**
 * Представительная строка товара для колонки «Пример значения».
 *
 * Первая непустая не годится: сразу под шапкой часто идёт категория, у которой
 * заполнена одна ячейка. Берём первую строку минимум с тремя значениями.
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

export default function ImportDialog({
  initialPath, onClose, onDone,
}: {
  /** Путь к файлу; если не задан, откроется системный выбор файла. */
  initialPath?: string | null
  onClose: () => void
  onDone: (outcome: ImportOutcome) => void
}) {
  const [file, setFile] = useState<OpenedFile | null>(null)
  const [sheet, setSheet] = useState<string | null>(null)
  const [preview, setPreview] = useState<SheetPreview | null>(null)
  const [profile, setProfile] = useState<Mapping | null>(null)
  const [ambiguous, setAmbiguous] = useState<Mapping[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  const [supplierName, setSupplierName] = useState('')
  const [columns, setColumns] = useState<Columns>({})

  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)

  const loadSheet = useCallback(
    async (f: OpenedFile, sheetName: string, headerRow?: number) => {
      setBusy(true)
      setError(null)
      try {
        setSheet(sheetName)
        let p = await window.api.readSheet(f.path, sheetName, { headerRow })
        const lookup = await window.api.findMapping(p.signature, f.name)

        // Профиль знает свою строку заголовков — перечитываем по ней.
        if (headerRow === undefined && lookup.mapping && lookup.mapping.headerRow !== p.headerRow) {
          p = await window.api.readSheet(f.path, sheetName, { headerRow: lookup.mapping.headerRow })
        }

        setPreview(p)
        setAmbiguous(lookup.ambiguous)
        if (headerRow === undefined) {
          setProfile(lookup.mapping)
          setSupplierName(lookup.mapping?.supplierName ?? '')
          setColumns({ ...(lookup.mapping?.columns ?? p.map?.fields ?? {}) })
        } else {
          setColumns({ ...(p.map?.fields ?? {}) })
        }
      } catch (e) {
        setError((e as Error).message)
        setPreview(null)
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  useEffect(() => {
    void (async () => {
      setBusy(true)
      try {
        const opened = initialPath
          ? await window.api.openPriceFile(initialPath)
          : await window.api.pickPriceFile()
        if (!opened) { onClose(); return }
        setFile(opened)
        setSuppliers(await window.api.listSuppliers())
        if (opened.sheets.length > 0) await loadSheet(opened, opened.sheets[0].name)
        else setBusy(false)
      } catch (e) {
        setError((e as Error).message)
        setBusy(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath])

  useModal(onClose, !viewing)

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
  }

  /**
   * Одно действие вместо двух: профиль сохраняется и тут же применяется.
   * Разделять их незачем — размечают колонки ровно затем, чтобы загрузить файл.
   */
  async function saveAndImport() {
    if (!file || !preview || !sheet) return
    setSaving(true)
    setError(null)
    try {
      const mapping = await window.api.saveMapping({
        id: profile?.id,
        supplierName: supplierName.trim(),
        signature: preview.signature,
        fileName: file.name,
        headerRow: preview.headerRow ?? 0,
        dataStartRow: preview.dataStartRow,
        columns,
      })
      const outcome = await window.api.runImport(file.path, sheet, mapping.id)
      if (outcome.status === 'done') await window.api.clearPending(file.path)
      onDone(outcome)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Замечания показываем только для колонок, которые пользователь не трогал:
  // проверка сделана по автоматической разметке, а он мог уже всё поправить.
  const problems = new Map<number, ColumnCheck>()
  for (const c of preview?.checks ?? []) {
    if (!c.ok && columns[c.field] === c.col) problems.set(c.col, c)
  }

  const missing = REQUIRED_FIELDS.filter((f) => columns[f] === undefined)
  const ready = file && preview && supplierName.trim() !== '' && missing.length === 0
  const example = preview ? exampleRow(preview) : null
  const roleOf = new Map<number, Field>()
  for (const [f, c] of Object.entries(columns)) roleOf.set(c as number, f as Field)

  return (
    <>
      <div className="overlay" onClick={onClose}>
        <div className="panel wide" onClick={(e) => e.stopPropagation()}>
          <header>
            <span className="grow">
              {file ? file.name : 'Загрузка прайса'}
              {sheet && <span className="muted"> · лист {sheet}</span>}
            </span>
            {profile && <span className="badge ok-badge">профиль: {profile.supplierName}</span>}
            <button className="close" onClick={onClose} title="Закрыть (Esc)">×</button>
          </header>

          <div className="body">
            {error && <pre>{error}</pre>}
            {busy && !preview && <div className="muted">Читаю файл…</div>}

            {problems.size > 0 && (
              <p className="hint warn">
                Заголовок колонки расходится с тем, что под ней лежит. Так бывает,
                когда подписи в прайсе перепутаны местами — проверьте отмеченные
                строки и поправьте роль вручную.
              </p>
            )}

            {ambiguous.length > 0 && (
              <p className="hint warn">
                Отпечаток заголовков совпал с несколькими профилями
                ({ambiguous.map((m) => m.supplierName).join(', ')}), а имя файла их не
                разводит. Выберите поставщика вручную — выбор запомнится.
              </p>
            )}

            {file && file.sheets.length > 1 && (
              <div className="toolbar" style={{ marginBottom: 'var(--s4)' }}>
                <span className="muted">Лист:</span>
                {file.sheets.map((s) => (
                  <button
                    key={s.name}
                    className={s.name === sheet ? 'chip on' : 'chip'}
                    disabled={busy}
                    onClick={() => void loadSheet(file, s.name)}
                  >
                    {s.name} <span className="muted">{s.rows}×{s.cols}</span>
                  </button>
                ))}
              </div>
            )}

            {preview && (
              <>
                <div className="form">
                  <label className="field">
                    <span>Поставщик</span>
                    <input
                      list="suppliers"
                      value={supplierName}
                      placeholder="например, Неман-Фарм"
                      onChange={(e) => setSupplierName(e.target.value)}
                      style={{ width: 240 }}
                    />
                    <datalist id="suppliers">
                      {suppliers.map((s) => <option key={s.id} value={s.name} />)}
                    </datalist>
                  </label>

                  <label className="field">
                    <span>Строка заголовков</span>
                    <input
                      type="number"
                      min={1}
                      max={preview.rows}
                      value={(preview.headerRow ?? 0) + 1}
                      disabled={busy}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (file && n >= 1 && n <= preview.rows) {
                          void loadSheet(file, preview.sheet, n - 1)
                        }
                      }}
                    />
                  </label>

                  <label className="field">
                    <span>Найдено товаров</span>
                    <span className="mono big">
                      {preview.candidates[0]?.dataRows.toLocaleString('ru-RU') ?? 0}
                    </span>
                  </label>
                </div>

                <table className="mapping">
                  <thead>
                    <tr>
                      <th className="num">Кол.</th>
                      <th>Заголовок в файле</th>
                      <th>Что это</th>
                      <th>Пример значения</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.headers.map((header, col) => (
                      <tr key={col} className={roleOf.has(col) ? 'assigned' : undefined}>
                        <td className="num mono muted">{col + 1}</td>
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
              </>
            )}
          </div>

          <footer>
            {preview && (
              <button onClick={() => setViewing(true)}>Посмотреть лист целиком</button>
            )}
            <span className="grow">
              {missing.length > 0 && (
                <span className="warn">
                  Укажите колонки: {missing.map((f) => FIELD_LABEL[f]).join(', ')}
                </span>
              )}
              {missing.length === 0 && supplierName.trim() === '' && (
                <span className="warn">Укажите поставщика</span>
              )}
            </span>
            <button onClick={onClose}>Отмена</button>
            <button className="primary" disabled={!ready || saving || busy} onClick={saveAndImport}>
              {saving ? 'Загружаю…' : 'Загрузить в базу'}
            </button>
          </footer>
        </div>
      </div>

      {viewing && file && preview && (
        <SheetViewer
          target={{
            path: file.path,
            fileName: file.name,
            sheet: preview.sheet,
            row: (preview.headerRow ?? 0) + 1,
            headerRow: preview.headerRow,
            columns,
          }}
          onClose={() => setViewing(false)}
        />
      )}
    </>
  )
}
