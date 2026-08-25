import { useEffect, useState } from 'react'
import type { AppInfo, DbStatus } from '@shared/types'
import { useModal } from '../useModal.ts'

export default function DbStatusDialog({ onClose }: { onClose: () => void }) {
  const [db, setDb] = useState<DbStatus | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([window.api.getDbStatus(), window.api.getAppInfo()])
      .then(([s, a]) => { setDb(s); setInfo(a) })
      .catch((e: Error) => setError(e.message))
  }, [])

  useModal(onClose)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="grow">Состояние базы</span>
          <button className="close" onClick={onClose} title="Закрыть (Esc)">×</button>
        </header>

        <div className="body">
          {error && <pre>{error}</pre>}
          {!db || !info ? (
            !error && <div className="muted">Загрузка…</div>
          ) : (
            <>
              <dl className="item-facts">
                <dt>Файл базы</dt>
                <dd className="mono wrap">{db.path}</dd>
                <dt>Размер</dt>
                <dd className="mono">{(db.sizeBytes / 1024 / 1024).toFixed(1)} МБ</dd>
                <dt>Версия схемы</dt>
                <dd className="mono">
                  {db.schemaVersion}
                  {db.schemaVersion === db.expectedVersion ? (
                    <span className="ok"> ✓ актуальна</span>
                  ) : (
                    <span className="warn"> ожидалась {db.expectedVersion}</span>
                  )}
                </dd>
                <dt>Версия программы</dt>
                <dd className="mono">{info.version}</dd>
                <dt>Окружение</dt>
                <dd className="mono">
                  Electron {info.electron} · Node {info.node} · {info.platform}
                </dd>
              </dl>

              <h3>Таблицы</h3>
              <table>
                <thead>
                  <tr><th>Таблица</th><th className="num">Строк</th></tr>
                </thead>
                <tbody>
                  {db.tables.map((t) => (
                    <tr key={t.name}>
                      <td className="mono">{t.name}</td>
                      <td className="num mono">{t.rows.toLocaleString('ru-RU')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
