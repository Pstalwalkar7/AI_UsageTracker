import { createContext, useContext, useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { api, useApi, type Meta, type RangeKey } from './api'
import { dateLabel } from './format'
import Summary from './pages/Summary'
import Portfolio from './pages/Portfolio'
import ToolDetail from './pages/ToolDetail'
import Spend from './pages/Spend'
import Departments from './pages/Departments'
import Backlog from './pages/Backlog'
import LogRun from './pages/LogRun'
import Method from './pages/Method'

interface Ctx {
  range: RangeKey
  meta: Meta | null
  version: number
  bump: () => void   // call after any write so every page refetches
}
const AppCtx = createContext<Ctx>({ range: '6m', meta: null, version: 0, bump: () => {} })
export const useApp = () => useContext(AppCtx)

// 24×24 stroke icons (paths only)
const ICONS: Record<string, string> = {
  summary: 'M4 19V9m6 10V5m6 14v-7m4 7H2',
  tools: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 16.5h7M16.5 13v7',
  spend: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3',
  departments: 'M3 21h18M5 21V8l7-4 7 4v13M9 21v-5h6v5M9 11h.01M15 11h.01',
  backlog: 'M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  log: 'M4 12h10m0 0-4-4m4 4-4 4M20 4v16',
  method: 'M5 4h14v16H5zM8.5 8h7M8.5 12h7M8.5 16h4',
}

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d={ICONS[name]} />
    </svg>
  )
}

const NAV = [
  { to: '/', label: 'Executive Summary', who: 'C-suite', icon: 'summary' },
  { to: '/tools', label: 'Tool Portfolio', who: 'AI Ops Director', icon: 'tools' },
  { to: '/spend', label: 'AI Spend', who: 'Finance', icon: 'spend' },
  { to: '/departments', label: 'Departments', who: 'Dept heads', icon: 'departments' },
  { to: '/backlog', label: 'Backlog Prioritizer', who: 'AI Ops team', icon: 'backlog' },
  { to: '/log', label: 'Log a Run', who: 'Tool owners', icon: 'log' },
  { to: '/method', label: 'How the math works', who: 'Everyone', icon: 'method' },
]

type Theme = 'auto' | 'light' | 'dark'
function readTheme(): Theme {
  const q = new URLSearchParams(location.search).get('theme')
  if (q === 'light' || q === 'dark' || q === 'auto') return q
  try {
    const t = localStorage.getItem('theme')
    if (t === 'light' || t === 'dark') return t
  } catch { /* storage unavailable */ }
  return 'auto'
}

const RANGE_LABEL: Record<RangeKey, string> = { '1m': '30 days', '3m': '90 days', '6m': '6 months' }

function readRange(): RangeKey {
  try {
    const r = localStorage.getItem('range')
    if (r === '1m' || r === '3m' || r === '6m') return r
  } catch { /* storage unavailable */ }
  return '6m'
}

export default function App() {
  const [range, setRange] = useState<RangeKey>(readRange)
  const [version, setVersion] = useState(0)
  const bump = () => setVersion(v => v + 1)
  const { data: meta } = useApi<Meta>('/api/meta', version)
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])

  const pickRange = (r: RangeKey) => {
    setRange(r)
    try { localStorage.setItem('range', r) } catch { /* ignore */ }
  }

  const reset = async () => {
    if (!confirm('Regenerate the demo data? Your edits, logged runs and ideas will be discarded.')) return
    await api('/api/admin/reset', { method: 'POST' })
    bump()
  }

  return (
    <AppCtx.Provider value={{ range, meta, version, bump }}>
      <div className="min-h-screen lg:flex">
        <aside className={`border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r`}>
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-2.5">
              <div className="grid grid-cols-1 h-8 w-8 place-items-center rounded-lg" style={{ background: 'var(--series-1)' }}>
                <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden><path d="M7 22l6-6 4 4 8-10" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div>
                <div className="text-[15px] font-semibold leading-tight">AI Impact Tracker</div>
                <div className="text-xs text-muted">Impact, not adoption</div>
              </div>
            </div>
            <button className="rounded-md px-2 py-1 text-sm text-ink-2 lg:hidden" onClick={() => setMenuOpen(o => !o)}>
              {menuOpen ? 'Close' : 'Menu'}
            </button>
          </div>
          <nav className={`${menuOpen ? 'block' : 'hidden'} px-3 pb-4 lg:block`}>
            {NAV.map(n => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `mb-0.5 flex items-start gap-3 rounded-lg px-3 py-2 transition-colors ${isActive ? 'bg-accent-wash text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
              >
                {({ isActive }) => (
                  <>
                    <span className={`mt-0.5 ${isActive ? 'text-accent' : ''}`}><Icon name={n.icon} /></span>
                    <span>
                      <span className="block text-sm font-medium">{n.label}</span>
                      <span className="block text-xs text-muted">{n.who}</span>
                    </span>
                  </>
                )}
              </NavLink>
            ))}
            <div className="mt-6 border-t border-line px-3 pt-4 text-xs leading-relaxed text-muted">
              Proof of concept with seeded demo data. Every number links back to its formula on
              “How the math works”.
              <button onClick={reset} className="mt-3 block font-medium text-accent hover:underline">Reset demo data</button>
            </div>
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-page/90 px-4 py-3 backdrop-blur sm:px-8">
            <div className="text-sm text-ink-2">
              Data as of <span className="font-medium text-ink">{meta ? dateLabel(meta.as_of) : '…'}</span>
              <span className="hidden sm:inline"> · showing the last {RANGE_LABEL[range]}</span>
            </div>
            <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Theme">
              {(['auto', 'light', 'dark'] as Theme[]).map(t => (
                <button key={t} onClick={() => setTheme(t)} aria-pressed={theme === t} title={`${t[0].toUpperCase() + t.slice(1)} theme`}
                  className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${theme === t ? 'bg-accent-wash text-ink' : 'text-muted hover:text-ink'}`}>
                  {t === 'auto' ? 'Auto' : t === 'light' ? '☀︎' : '☾'}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Date range">
              {(['1m', '3m', '6m'] as RangeKey[]).map(r => (
                <button
                  key={r}
                  onClick={() => pickRange(r)}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${range === r ? 'bg-accent-wash text-ink' : 'text-ink-2 hover:text-ink'}`}
                  aria-pressed={range === r}
                >
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            </div>
          </div>
          <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-8 sm:py-8">
            <Routes>
              <Route path="/" element={<Summary />} />
              <Route path="/tools" element={<Portfolio />} />
              <Route path="/tools/:id" element={<ToolDetail />} />
              <Route path="/spend" element={<Spend />} />
              <Route path="/departments" element={<Departments />} />
              <Route path="/backlog" element={<Backlog />} />
              <Route path="/log" element={<LogRun />} />
              <Route path="/method" element={<Method />} />
            </Routes>
          </main>
        </div>
      </div>
    </AppCtx.Provider>
  )
}
