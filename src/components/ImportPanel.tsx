import { useState } from 'react'
import type { ImportOutcome, Mapping } from '@shared/types'

const SKIP_LABEL: Record<string, string> = {
  category: 'строки-категории',
  empty: 'пустые строки',
  noName: 'без наименования',
}

const fmtDate = (ts: number | null) =>
  ts === null ? '—' : new Date(ts * 1000).toLocaleDateString('ru-RU')

const SOURCE_LABEL: Record<string, string> = {
  cell: 'из ячейки прайса',
  filename: 'из имени файла',
  mtime: 'по дате файла',
  none: 'не найдена',
}

export default function ImportPanel({
  filePath, sheet, profile,
}: {
  filePath: string
  sheet: string
  profile: Mapping | null
}) {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!profile) return
    setBusy(true)
    setError(null)
    setOutcome(null)
    try {
      const out = await window.api.runImport(filePath, sheet, profile.id)
      setOutcome(out)
      // Файл мог ждать в очереди на разметку — теперь он разобран.
      if (out.status === 'done') await window.api.clearPending(filePath)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Импорт в базу</h2>

      {!profile ? (
        <p className="hint muted">
          Сначала сохраните профиль поставщика — импорт идёт по нему.
        </p>
      ) : (
        <div className="toolbar">
          <button onClick={run} disabled={busy}>
            {busy ? 'Импортирую…' : `Импортировать как «${profile.supplierName}»`}
          </button>
          {busy && <span className="muted">разбор и запись идут в отдельном процессе</span>}
        </div>
      )}

      {error && <pre>{error}</pre>}

      {outcome?.status === 'duplicate' && (
        <p className="hint warn">
          Файл с таким же содержимым уже загружен — «{outcome.duplicateOf.split(/[\\/]/).pop()}».
          Повторный импорт пропущен.
        </p>
      )}

      {outcome?.status === 'done' && (
        <>
          <dl className="result">
            <dt>Позиций</dt>
            <dd className="mono">{outcome.result.total}</dd>
            <dt>Добавлено</dt>
            <dd className="mono">{outcome.result.inserted}</dd>
            <dt>Обновлено</dt>
            <dd className="mono">{outcome.result.updated}</dd>
            <dt>Цена изменилась</dt>
            <dd className="mono">
              {outcome.result.priceChanged > 0
                ? <span className="accent">{outcome.result.priceChanged}</span>
                : '0'}
            </dd>
            <dt>Пропало из прайса</dt>
            <dd className="mono">
              {outcome.result.deactivated > 0
                ? <span className="warn">{outcome.result.deactivated}</span>
                : '0'}
            </dd>
            <dt>Дата прайса</dt>
            <dd className="mono">
              {fmtDate(outcome.priceDate)}{' '}
              <span className="muted">({SOURCE_LABEL[outcome.priceDateSource]})</span>
            </dd>
            <dt>Время записи</dt>
            <dd className="mono">{outcome.result.elapsedMs} мс</dd>
          </dl>

          <p className="hint muted">
            Пропущено строк: {outcome.result.skipped}
            {Object.entries(outcome.skipReasons).length > 0 && ' — '}
            {Object.entries(outcome.skipReasons)
              .map(([k, v]) => `${SKIP_LABEL[k] ?? k}: ${v}`)
              .join(', ')}
            {outcome.collisions > 0 && (
              <> · одинаковых названий разведено: {outcome.collisions}</>
            )}
          </p>

          {outcome.categories.length > 0 && (
            <p className="hint muted">
              Категории: {outcome.categories.map((c) => c.slice(0, 34)).join(' · ')}
            </p>
          )}
        </>
      )}
    </section>
  )
}
