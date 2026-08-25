import { useEffect, useState } from 'react'
import type { AppInfo, DbStatus } from '@shared/types'
import DbStatusView from './components/DbStatusView.tsx'
import PricePreview from './components/PricePreview.tsx'
import SearchView from './components/SearchView.tsx'
import SourcesView from './components/SourcesView.tsx'
import WatchView from './components/WatchView.tsx'
import ChangesView from './components/ChangesView.tsx'

type View = 'search' | 'changes' | 'price' | 'sources' | 'watch' | 'status'

export default function App() {
  const [view, setView] = useState<View>('search')
  /** Файл, открытый по кнопке «Разметить» из очереди автоподхвата. */
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [db, setDb] = useState<DbStatus | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([window.api.getDbStatus(), window.api.getAppInfo()])
      .then(([status, appInfo]) => { setDb(status); setInfo(appInfo) })
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="screen">
      <header className="head">
        <h1>TableEasy</h1>
        <nav className="tabs">
          <button className={view === 'search' ? 'tab active' : 'tab'} onClick={() => setView('search')}>
            Поиск
          </button>
          <button className={view === 'changes' ? 'tab active' : 'tab'} onClick={() => setView('changes')}>
            Изменения
          </button>
          <button className={view === 'price' ? 'tab active' : 'tab'} onClick={() => setView('price')}>
            Загрузить прайс
          </button>
          <button className={view === 'sources' ? 'tab active' : 'tab'} onClick={() => setView('sources')}>
            Источники
          </button>
          <button className={view === 'watch' ? 'tab active' : 'tab'} onClick={() => setView('watch')}>
            Папки
          </button>
          <button className={view === 'status' ? 'tab active' : 'tab'} onClick={() => setView('status')}>
            Состояние
          </button>
        </nav>
      </header>

      {error && <div className="card error"><h2>Ошибка</h2><pre>{error}</pre></div>}

      {view === 'search' && <SearchView />}
      {view === 'changes' && <ChangesView />}
      {view === 'price' && <PricePreview initialPath={pendingPath} />}
      {view === 'sources' && <SourcesView />}
      {view === 'watch' && (
        <WatchView
          onSetup={(f) => { setPendingPath(f.path); setView('price') }}
        />
      )}
      {view === 'status' && (db && info ? <DbStatusView db={db} info={info} /> : <div className="muted">Загрузка…</div>)}

      <footer className="muted">
        Этап 9 из 11 — история цен. Следующий: сборка установщика под Windows.
      </footer>
    </div>
  )
}
