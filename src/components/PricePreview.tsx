import { useEffect, useState } from 'react'
import type { Field, Mapping, OpenedFile, SheetPreview, Supplier } from '@shared/types'
import { FIELD_LABEL } from '../fields.ts'
import MappingEditor from './MappingEditor.tsx'
import ImportPanel from './ImportPanel.tsx'

export default function PricePreview({ initialPath }: { initialPath?: string | null }) {
  const [file, setFile] = useState<OpenedFile | null>(null)
  const [sheet, setSheet] = useState<string | null>(null)
  const [preview, setPreview] = useState<SheetPreview | null>(null)
  const [profile, setProfile] = useState<Mapping | null>(null)
  const [ambiguous, setAmbiguous] = useState<Mapping[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Читает лист и подбирает профиль. headerRow задаётся, когда пользователь
   * поправил строку заголовков или когда её диктует найденный профиль.
   */
  async function load(f: OpenedFile, sheetName: string, headerRow?: number) {
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
      setProfile(headerRow === undefined ? lookup.mapping : profile)
      setAmbiguous(lookup.ambiguous)
      setSuppliers(await window.api.listSuppliers())
    } catch (e) {
      setError((e as Error).message)
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  // Файл пришёл из очереди «требуют разметки» — открываем его сразу.
  useEffect(() => {
    if (!initialPath) return
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const opened = await window.api.openPriceFile(initialPath)
        setFile(opened)
        setPreview(null)
        setProfile(null)
        if (opened.sheets.length > 0) await load(opened, opened.sheets[0].name)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath])

  async function pick() {
    setBusy(true)
    setError(null)
    try {
      const opened = await window.api.pickPriceFile()
      if (!opened) return
      setFile(opened)
      setPreview(null)
      setProfile(null)
      if (opened.sheets.length > 0) await load(opened, opened.sheets[0].name)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const roleOf = new Map<number, Field>()
  const active = profile?.columns ?? preview?.map?.fields
  if (active) for (const [f, c] of Object.entries(active)) roleOf.set(c as number, f as Field)

  return (
    <>
      <section className="card">
        <div className="toolbar">
          <button onClick={pick} disabled={busy}>{busy ? 'Читаю…' : 'Открыть прайс'}</button>
          {file && <span className="muted"><b>{file.name}</b> · листов: {file.sheets.length}</span>}
          {profile && <span className="badge ok-badge">профиль: {profile.supplierName}</span>}
        </div>

        {file && file.sheets.length > 1 && (
          <div className="tabs">
            {file.sheets.map((s) => (
              <button key={s.name} className={s.name === sheet ? 'tab active' : 'tab'}
                      onClick={() => load(file, s.name)} disabled={busy}>
                {s.name} <span className="muted">{s.rows}×{s.cols}</span>
              </button>
            ))}
          </div>
        )}

        {error && <pre>{error}</pre>}
        {ambiguous.length > 0 && (
          <p className="hint warn">
            Отпечаток заголовков совпал с {ambiguous.length} профилями
            ({ambiguous.map((m) => m.supplierName).join(', ')}), а имя файла их не разводит.
            Выберите поставщика вручную — выбор запомнится.
          </p>
        )}
        {!file && !error && (
          <p className="muted">
            Выберите файл <span className="mono">.xlsx</span> или <span className="mono">.xls</span> —
            приложение найдёт строку заголовков, разметит колонки и подберёт сохранённый профиль.
          </p>
        )}
      </section>

      {preview && file && (
        <>
          <section className="card">
            <h2>Что определено</h2>
            <dl>
              <dt>Лист</dt>
              <dd className="mono">{preview.sheet} · {preview.rows}×{preview.cols}</dd>
              <dt>Строка заголовков</dt>
              <dd className="mono">
                {preview.headerRow === null
                  ? <span className="warn">не найдена</span>
                  : <>{preview.headerRow + 1} <span className="ok">✓</span></>}
              </dd>
              <dt>Товаров под ней</dt>
              <dd className="mono">{preview.candidates[0]?.dataRows ?? 0}</dd>
            </dl>
          </section>

          <MappingEditor
            fileName={file.name}
            preview={preview}
            profile={profile}
            suppliers={suppliers}
            busy={busy}
            onHeaderRowChange={(row) => void load(file, preview.sheet, row)}
            onSaved={(m) => { setProfile(m); setAmbiguous([]) }}
          />

          <ImportPanel filePath={file.path} sheet={preview.sheet} profile={profile} />

          {preview.candidates.length > 1 && (
            <section className="card">
              <h2>Отвергнутые кандидаты <span className="muted">({preview.candidates.length - 1})</span></h2>
              <p className="muted hint">
                Строк, похожих на заголовок, в листе несколько. Выбрана та, под которой
                самый длинный блок товаров.
              </p>
              <table>
                <thead><tr><th>Строка</th><th className="num">Товаров</th><th className="num">Вес</th><th>Поля</th></tr></thead>
                <tbody>
                  {preview.candidates.map((c) => (
                    <tr key={c.row} className={c.row === preview.headerRow ? 'chosen' : ''}>
                      <td className="mono">{c.row === preview.headerRow && '► '}{c.row + 1}</td>
                      <td className="num mono">{c.dataRows}</td>
                      <td className="num mono">{c.score}</td>
                      <td className="muted">{Object.keys(c.fields).map((f) => FIELD_LABEL[f as Field]).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="card">
            <h2>Превью листа</h2>
            <div className="scroll">
              <table className="sheet">
                <tbody>
                  {preview.sample.map((row, i) => {
                    const rowIndex = preview.sampleFrom + i
                    const isHeader = rowIndex === preview.headerRow
                    return (
                      <tr key={rowIndex} className={isHeader ? 'headerRow' : ''}>
                        <td className="rowno mono">{rowIndex + 1}</td>
                        {row.map((cell, c) => (
                          <td key={c} title={cell}>
                            {isHeader && roleOf.has(c) && (
                              <span className="role">{FIELD_LABEL[roleOf.get(c)!]}</span>
                            )}
                            {cell}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  )
}
