import { useState, type ReactNode } from 'react'
import type { Flag } from '../api'

export function Card({ children, className = '', title, subtitle, action }: {
  children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, question, persona, children }: {
  title: string; question: string; persona: string; children?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">For {persona}</div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-[15px] text-ink-2">“{question}”</p>
      </div>
      {children}
    </header>
  )
}

const FLAG_STYLE: Record<Flag, { dot: string; wash: string; icon: string; label: string }> = {
  SCALE: { dot: 'var(--good)', wash: 'var(--good-wash)', icon: '▲', label: 'Scale' },
  FIX: { dot: 'var(--warning)', wash: 'var(--warning-wash)', icon: '◆', label: 'Fix' },
  KILL: { dot: 'var(--critical)', wash: 'var(--critical-wash)', icon: '✕', label: 'Kill' },
  WATCH: { dot: 'var(--neutral)', wash: 'var(--neutral-wash)', icon: '●', label: 'Watch' },
}
export const flagColor = (f: Flag) => FLAG_STYLE[f].dot

export function FlagBadge({ flag, overridden, size = 'sm' }: { flag: Flag; overridden?: boolean; size?: 'sm' | 'lg' }) {
  const s = FLAG_STYLE[flag]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold text-ink ${size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'}`}
      style={{ background: s.wash }}
      title={overridden ? 'Manually overridden by the Director' : 'Automatic recommendation'}
    >
      <span style={{ color: s.dot }} aria-hidden>{s.icon}</span>
      {flag}
      {overridden && <span className="font-normal text-ink-2">(override)</span>}
    </span>
  )
}

export function Stat({ label, value, sub, explain }: { label: string; value: ReactNode; sub?: ReactNode; explain?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="text-sm font-medium text-ink-2">{label}</div>
      <div className="mt-1 text-[32px] font-semibold leading-tight tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-1 text-sm text-ink-2">{sub}</div>}
      {explain && <div className="mt-3">{explain}</div>}
    </div>
  )
}

export function Delta({ value, goodWhenUp = true }: { value: number | null; goodWhenUp?: boolean }) {
  if (value == null) return <span className="text-muted">—</span>
  if (Math.abs(value) < 0.005) return <span className="font-medium text-ink-2">→ 0%</span>
  const up = value > 0
  const good = up === goodWhenUp
  return (
    <span className={`font-medium ${Math.abs(value) < 0.005 ? 'text-ink-2' : good ? 'text-good-text' : 'text-bad-text'}`}>
      {up ? '↑' : value < 0 ? '↓' : '→'} {Math.abs(value * 100).toFixed(0)}%
    </span>
  )
}

/** "How is this calculated?" disclosure. Every headline number in the app has one. */
export function Explain({ children, label = 'How is this calculated?', defaultOpen = false }: {
  children: ReactNode; label?: string; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        aria-expanded={open}
      >
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span> {label}
      </button>
      {open && <div className="mt-2 space-y-1.5 rounded-lg bg-accent-wash p-3 text-[13px] leading-relaxed text-ink-2">{children}</div>}
    </div>
  )
}

/** One line of math: label = expression = result. */
export function Formula({ label, expr, result }: { label?: ReactNode; expr: ReactNode; result?: ReactNode }) {
  return (
    <div className="tnum">
      {label && <span className="font-medium text-ink">{label} = </span>}
      <span>{expr}</span>
      {result != null && <span className="font-semibold text-ink"> = {result}</span>}
    </div>
  )
}

export function Loading() {
  return <div className="py-24 text-center text-sm text-muted">Loading…</div>
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 text-sm">
      <div className="font-semibold text-bad-text">Couldn’t load data</div>
      <div className="mt-1 text-ink-2">{error}. Is the API running on :8000?</div>
    </div>
  )
}

export function Callout({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div
      className="rounded-lg p-3 text-sm text-ink-2"
      style={{ background: tone === 'warn' ? 'var(--warning-wash)' : 'var(--accent-wash)' }}
    >
      {children}
    </div>
  )
}

export function LegendItem({ color, label, shape = 'square' }: { color: string; label: string; shape?: 'square' | 'line' | 'dot' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span
        aria-hidden
        style={{
          background: color,
          width: shape === 'line' ? 14 : 10,
          height: shape === 'line' ? 2 : 10,
          borderRadius: shape === 'dot' ? 999 : 2,
        }}
      />
      {label}
    </span>
  )
}

export function Th({ children, className = '', onClick, active }: { children?: ReactNode; className?: string; onClick?: () => void; active?: 'asc' | 'desc' | null }) {
  return (
    <th
      onClick={onClick}
      className={`whitespace-nowrap border-b border-line px-3 py-2 text-left text-xs font-medium text-muted ${onClick ? 'cursor-pointer select-none hover:text-ink' : ''} ${className}`}
    >
      {children}
      {active && <span className="ml-1">{active === 'asc' ? '↑' : '↓'}</span>}
    </th>
  )
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  const nowrap = className.includes('text-right') ? 'whitespace-nowrap' : ''
  return <td className={`border-b border-line px-3 py-2.5 text-sm tnum ${nowrap} ${className}`}>{children}</td>
}
