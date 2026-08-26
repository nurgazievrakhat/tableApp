import { useCallback, useEffect, useState } from 'react'
import type {
  ColumnCheck, Field, ImportOutcome, Mapping, OpenedFile, SheetPreview, Supplier,
} from '@shared/types'
import { FIELD_LABEL, REQUIRED_FIELDS } from '../fields.ts'
import SheetViewer from './SheetViewer.tsx'
import MappingGrid from './MappingGrid.tsx'
import ResultPreview from './ResultPreview.tsx'
import { useModal } from '../useModal.ts'

type Columns = Partial<Record<Field, number>>

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
  const [showAll, setShowAll] = useState(false)

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

  /** Роль закреплена ровно за одной колонкой: назначая, снимаем со старой. */
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

  // Замечания показываем только там, где разметка осталась автоматической:
  // проверка сделана по ней, а пользователь мог уже всё поправить.
  const problems = new Map<number, ColumnCheck>()
  for (const c of preview?.checks ?? []) {
    if (!c.ok && columns[c.field] === c.col) problems.set(c.col, c)
  }

  /** Роли двух колонок перепутаны местами — предлагаем поменять одним нажатием. */
  const swap = findSwap(problems, columns)

  function applySwap() {
    if (!swap) return
    setColumns((prev) => ({ ...prev, [swap.a.field]: swap.b.col, [swap.b.field]: swap.a.col }))
  }

  const missing = REQUIRED_FIELDS.filter((f) => columns[f] === undefined)
  const items = preview?.candidates[0]?.dataRows ?? 0
  const ready = file && preview && supplierName.trim() !== '' && missing.length === 0

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

            {file && file.sheets.length > 1 && (
              <div className="toolbar sheets">
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
                <section className="step">
                  <h3><span className="num">1</span> Чей это прайс</h3>
                  <input
                    list="suppliers"
                    value={supplierName}
                    placeholder="Название поставщика"
                    onChange={(e) => setSupplierName(e.target.value)}
                    style={{ width: 280 }}
                  />
                  <datalist id="suppliers">
                    {suppliers.map((s) => <option key={s.id} value={s.name} />)}
                  </datalist>
                  {ambiguous.length > 0 && (
                    <p className="hint warn">
                      Такая же шапка есть у {ambiguous.map((m) => m.supplierName).join(' и ')} —
                      выберите, чей это прайс. Выбор запомнится.
                    </p>
                  )}
                </section>

                <section className="step">
                  <h3><span className="num">2</span> Что в колонках</h3>
                  <p className="hint">
                    Приложение разметило само. Проверьте по значениям под заголовками
                    и поправьте, если что-то не так.
                  </p>

                  {problems.size > 0 && (
                    <div className="alert">
                      <div className="grow">
                        <b>Подписи расходятся с тем, что в колонках.</b>
                        <ul>
                          {[...problems.values()].map((c) => (
                            <li key={c.col}>
                              Колонка {colLetter(c.col)} отмечена как «{FIELD_LABEL[c.field]}»,
                              но {c.message}
                              {c.betterCol !== undefined &&
                                ` — похоже, они в колонке ${colLetter(c.betterCol)}`}.
                            </li>
                          ))}
                        </ul>
                      </div>
                      {swap && (
                        <button className="primary small" onClick={applySwap}>
                          Поменять «{FIELD_LABEL[swap.a.field]}» и «{FIELD_LABEL[swap.b.field]}»
                        </button>
                      )}
                    </div>
                  )}

                  <MappingGrid
                    preview={preview}
                    columns={columns}
                    problems={problems}
                    showAll={showAll}
                    onAssign={assign}
                    onPickHeader={(row) => {
                      if (file && row !== preview.headerRow) void loadSheet(file, preview.sheet, row)
                    }}
                  />

                  <div className="toolbar grid-foot">
                    <span className="muted">
                      Заголовки — строка <b>{(preview.headerRow ?? 0) + 1}</b>.
                      Не та? Нажмите на номер нужной строки слева.
                    </span>
                    <span className="sep" />
                    <button className="small" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? 'Скрыть пустые колонки' : 'Показать все колонки'}
                    </button>
                    <button className="small" onClick={() => setViewing(true)}>
                      Открыть весь прайс
                    </button>
                  </div>

                  {missing.length > 0 && (
                    <p className="hint warn">
                      Без этого загрузить нельзя: {missing.map((f) => FIELD_LABEL[f]).join(', ')}.
                      Отметьте нужную колонку в списке над ней.
                    </p>
                  )}
                </section>

                <section className="step">
                  <h3><span className="num">3</span> Что попадёт в базу</h3>
                  <ResultPreview preview={preview} columns={columns} />
                </section>
              </>
            )}
          </div>

          <footer>
            <span className="grow muted">
              {/* Кнопка заблокирована — человек должен видеть, чего не хватает. */}
              {preview && supplierName.trim() === '' ? (
                <span className="warn">Укажите поставщика — шаг 1</span>
              ) : preview && missing.length > 0 ? (
                <span className="warn">
                  Отметьте колонки: {missing.map((f) => FIELD_LABEL[f]).join(', ')}
                </span>
              ) : (
                preview && <>Товаров в прайсе: <b>{items.toLocaleString('ru-RU')}</b></>
              )}
            </span>
            <button onClick={onClose}>Отмена</button>
            <button className="primary" disabled={!ready || saving || busy} onClick={saveAndImport}>
              {saving ? 'Загружаю…' : `Загрузить ${items.toLocaleString('ru-RU')} товаров`}
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

function colLetter(i: number): string {
  let s = ''
  let n = i
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

/**
 * Две роли, назначенные на колонки друг друга.
 *
 * Самый частый случай перепутанных подписей: у «Медлайф» колонка
 * «ПРОИЗВОДИТЕЛЬ» содержит даты, а «СРОК ГОДНОСТИ» — названия заводов.
 * Такое чинится одним нажатием, и незачем заставлять человека возиться
 * с двумя выпадающими списками.
 */
function findSwap(
  problems: Map<number, ColumnCheck>,
  columns: Partial<Record<Field, number>>,
): { a: ColumnCheck; b: ColumnCheck } | null {
  const list = [...problems.values()].filter((c) => c.betterCol !== undefined)
  for (const a of list) {
    const b = list.find(
      (x) => x !== a && x.col === a.betterCol && x.betterCol === a.col,
    )
    if (b && columns[a.field] === a.col && columns[b.field] === b.col) return { a, b }
  }
  return null
}
