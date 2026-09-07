import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'
import { useModal } from '../useModal.ts'

const mb = (b: number | null) => (b === null ? null : `${(b / 1024 / 1024).toFixed(0)} МБ`)

/**
 * Обновление приложения — ссылка в подвале и окно за ней.
 *
 * Проверка идёт при запуске, но сама по себе она только подсвечивает ссылку.
 * Скачивание и установка — по нажатию: тянуть сотню мегабайт по рабочему
 * интернету без спроса и подменять программу при закрытии окна нельзя.
 */
export default function UpdateBar() {
  const [s, setS] = useState<UpdateState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.updateState().then(setS)
    return window.api.onUpdateState(setS)
  }, [])

  if (!s) return null

  const found = s.status === 'available' || s.status === 'downloading' || s.status === 'ready'

  return (
    <>
      <span className="muted">Версия {s.currentVersion}</span>
      <button className={found ? 'link accent' : 'link'} onClick={() => setOpen(true)}>
        {found ? `Доступно обновление ${s.newVersion}` : 'Проверить обновления'}
      </button>
      {open && (
        <UpdateDialog
          s={s}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function UpdateDialog({
  s, busy, setBusy, onClose,
}: {
  s: UpdateState
  busy: boolean
  setBusy: (v: boolean) => void
  onClose: () => void
}) {
  useModal(onClose)

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  const working = busy || s.status === 'checking' || s.status === 'downloading'

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel narrow" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="grow">Обновление</span>
          <button className="close" onClick={onClose} title="Закрыть (Esc)">×</button>
        </header>

        <div className="body">
          <dl className="item-facts">
            <dt>Установлена</dt>
            <dd className="mono">{s.currentVersion}</dd>
            {s.newVersion && s.status !== 'none' && (
              <>
                <dt>Доступна</dt>
                <dd className="mono">
                  {s.newVersion}
                  {mb(s.sizeBytes) && <span className="muted"> · {mb(s.sizeBytes)}</span>}
                </dd>
              </>
            )}
          </dl>

          {!s.supported && (
            <p className="hint">
              Обновляется установленное приложение. Сейчас оно запущено из исходников,
              поэтому обновлять нечего.
            </p>
          )}

          {s.status === 'checking' && <p className="muted">Проверяю…</p>}

          {s.status === 'none' && <p className="ok">У вас последняя версия.</p>}

          {s.notes && s.status === 'available' && (
            <>
              <h3>Что изменилось</h3>
              <pre className="notes">{s.notes}</pre>
            </>
          )}

          {s.status === 'downloading' && (
            <>
              <div className="progress"><div style={{ width: `${s.percent}%` }} /></div>
              <p className="muted">Скачано {s.percent}%</p>
            </>
          )}

          {s.status === 'ready' && (
            <p className="hint">
              Загружено. Приложение закроется, установит обновление и откроется снова.
              Загруженные прайсы и история цен останутся на месте.
            </p>
          )}

          {s.status === 'error' && (
            <>
              <pre>{s.error}</pre>
              <p className="hint">
                Чаще всего это значит, что нет связи с github.com. Установщик всегда
                можно скачать вручную со страницы релизов.
              </p>
            </>
          )}
        </div>

        <footer>
          <span className="grow" />
          <button onClick={onClose}>Закрыть</button>
          {/* Пока идёт скачивание, проверять нечего — кнопка только мешает. */}
          {s.supported && !['ready', 'available', 'downloading'].includes(s.status) && (
            <button
              className="primary"
              disabled={working}
              onClick={() => void act(() => window.api.checkForUpdate())}
            >
              {s.status === 'checking' ? 'Проверяю…' : 'Проверить'}
            </button>
          )}
          {s.status === 'available' && (
            <button
              className="primary"
              disabled={working}
              onClick={() => void act(() => window.api.downloadUpdate())}
            >
              Скачать {mb(s.sizeBytes) ?? ''}
            </button>
          )}
          {s.status === 'ready' && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void act(() => window.api.installUpdate())}
            >
              Установить и перезапустить
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
