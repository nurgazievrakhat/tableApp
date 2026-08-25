import type { AppInfo, DbStatus } from '@shared/types'

export default function DbStatusView({ db, info }: { db: DbStatus; info: AppInfo }) {
  const schemaOk = db.schemaVersion === db.expectedVersion
  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>База данных</h2>
          <dl>
            <dt>Файл</dt>
            <dd className="mono wrap">{db.path}</dd>
            <dt>Размер</dt>
            <dd className="mono">{(db.sizeBytes / 1024).toFixed(1)} КБ</dd>
            <dt>Версия схемы</dt>
            <dd className="mono">
              {db.schemaVersion}
              {schemaOk ? <span className="ok"> ✓</span> : <span className="warn"> ожидалась {db.expectedVersion}</span>}
            </dd>
          </dl>
        </section>
        <section className="card">
          <h2>Окружение</h2>
          <dl>
            <dt>Версия</dt><dd className="mono">{info.version}</dd>
            <dt>Electron</dt><dd className="mono">{info.electron}</dd>
            <dt>Node</dt><dd className="mono">{info.node}</dd>
            <dt>Платформа</dt><dd className="mono">{info.platform}</dd>
          </dl>
        </section>
      </div>
      <section className="card">
        <h2>Таблицы <span className="muted">({db.tables.length})</span></h2>
        <table>
          <thead><tr><th>Таблица</th><th className="num">Строк</th></tr></thead>
          <tbody>
            {db.tables.map((t) => (
              <tr key={t.name}>
                <td className="mono">{t.name}</td>
                <td className="num mono">{t.rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
