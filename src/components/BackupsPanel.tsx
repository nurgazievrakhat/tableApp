import { Fragment, useEffect, useState } from 'react'
import type { BackupInfo, BackupState } from '@shared/types'

/**
 * Резервные копии базы.
 *
 * Вся работа приложения лежит в одном файле, и история цен — единственный
 * экземпляр данных, которые заново не собрать: старые прайсы у поставщика уже
 * не попросишь. Копия снимается сама при запуске, но выбирать, к какой
 * вернуться, должен человек.
 */
export default function BackupsPanel({ expectedVersion }: { expectedVersion: number }) {
  const [state, setState] = useState<BackupState | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listBackups().then(setState).catch((e: Error) => setError(e.message))
  }, [])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
      setRestarting(false)
    } finally {
      setBusy(false)
    }
  }

  async function restore(name: string) {
    // Ответа не будет: главный процесс закрывает базу и перезапускает
    // приложение прямо в обработчике. Окно должно объяснить, что происходит.
    setRestarting(true)
    await window.api.restoreBackup(name)
  }

  return (
    <>
      <h3>Резервные копии</h3>
      <p className="hint">
        Копия снимается сама при запуске — не чаще раза в сутки и обязательно
        перед обновлением базы. Хранятся последние семь.
      </p>

      {error && <pre>{error}</pre>}
      {state?.error && (
        <p className="hint warn">Последнюю копию сделать не удалось: {state.error}</p>
      )}
      {restarting && <p className="hint">Возвращаю базу и перезапускаю приложение…</p>}

      {state && state.backups.length === 0 ? (
        <p className="muted">Копий пока нет — первая появится после загрузки прайса.</p>
      ) : (
        <table className="backups">
          <thead>
            <tr>
              <th>Копия</th>
              <th className="num">Позиций</th>
              <th className="num">Размер</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(state?.backups ?? []).map((b) => (
              // Подтверждение занимает отдельную строку во всю ширину: втиснутое
              // в ячейку, оно раздвигало таблицу и рвало дату на четыре строки.
              <Fragment key={b.name}>
                <tr>
                  <td>
                    {when(b)}
                    {b.schemaVersion !== null && b.schemaVersion !== expectedVersion && (
                      <span className="warn"> · схема {b.schemaVersion}</span>
                    )}
                  </td>
                  <td className="num mono">
                    {b.items === null
                      ? <span className="warn">не читается</span>
                      : b.items.toLocaleString('ru-RU')}
                  </td>
                  <td className="num mono">{(b.sizeBytes / 1024 / 1024).toFixed(1)} МБ</td>
                  <td className="actions">
                    <button
                      className="small"
                      // Копию, которая не открылась, восстанавливать нечем.
                      disabled={busy || restarting || b.items === null || confirming === b.name}
                      onClick={() => { setConfirming(b.name); setError(null) }}
                    >
                      Вернуться к ней
                    </button>
                  </td>
                </tr>
                {confirming === b.name && (
                  <tr className="confirm-row">
                    <td colSpan={4}>
                      <div className="row">
                        <span className="grow">
                          Заменить нынешнюю базу этой копией? Нынешняя сохранится
                          отдельной копией, приложение перезапустится.
                        </span>
                        <button
                          className="small danger"
                          disabled={busy || restarting}
                          onClick={() => void act(() => restore(b.name))}
                        >
                          Да, вернуть
                        </button>
                        <button className="small" onClick={() => setConfirming(null)}>
                          Отмена
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar">
        <button
          className="small"
          disabled={busy || restarting}
          onClick={() => void act(async () => setState(await window.api.backupNow()))}
        >
          Сделать копию сейчас
        </button>
        <button
          className="small"
          disabled={busy || restarting}
          title={state?.dir}
          onClick={() => void act(() => window.api.openBackupsFolder())}
        >
          Открыть папку с копиями
        </button>
      </div>
    </>
  )
}

/**
 * «5 сентября в 14:32:05» — читается быстрее, чем 2026-09-05T14:32:05.
 *
 * Секунды показаны не ради точности: обычно копии отстоят на сутки, но кнопкой
 * «Сделать копию сейчас» их можно нащёлкать подряд, и без секунд соседние
 * строки станут неразличимы ровно там, где надо выбрать одну из них.
 */
function when(b: BackupInfo): string {
  return new Date(b.madeAt * 1000).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}
