import { useState } from 'react'
import SearchView from './components/SearchView.tsx'
import ChangesView from './components/ChangesView.tsx'
import PricesView from './components/PricesView.tsx'
import DbStatusDialog from './components/DbStatusDialog.tsx'

type View = 'search' | 'changes' | 'prices'

const TABS: { id: View; label: string; hint: string }[] = [
  { id: 'search', label: 'Поиск', hint: 'Поиск товара и сравнение цен' },
  { id: 'changes', label: 'Изменения', hint: 'Что подорожало и подешевело' },
  { id: 'prices', label: 'Прайсы', hint: 'Загруженные прайсы и папки' },
]

export default function App() {
  const [view, setView] = useState<View>('search')
  const [showStatus, setShowStatus] = useState(false)

  return (
    <div className="app">
      <header className="appbar">
        <div className="brand">
          TableEasy
          <small>прайс-листы поставщиков</small>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={view === t.id ? 'tab active' : 'tab'}
              title={t.hint}
              onClick={() => setView(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {view === 'search' && <SearchView />}
        {view === 'changes' && <ChangesView />}
        {view === 'prices' && <PricesView />}
      </main>

      <footer className="appfoot">
        <span>Поиск идёт по локальной базе — прайсы читаются только при загрузке.</span>
        <button className="link" onClick={() => setShowStatus(true)}>
          Состояние базы
        </button>
      </footer>

      {showStatus && <DbStatusDialog onClose={() => setShowStatus(false)} />}
    </div>
  )
}
