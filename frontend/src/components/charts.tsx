import type { ReactNode } from 'react'

/** Shared tooltip shell for Recharts `content=`. */
export function TipBox({ title, rows }: { title: ReactNode; rows: { color?: string; label: string; value: ReactNode }[] }) {
  return (
    <div className="min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map(r => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5 tnum">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            {r.color && <span aria-hidden style={{ background: r.color, width: 8, height: 8, borderRadius: 2 }} />}
            {r.label}
          </span>
          <span className="font-medium text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export const axisProps = {
  tickLine: false,
  axisLine: { stroke: 'var(--axis)' },
  tick: { fill: 'var(--muted)', fontSize: 12 },
} as const

export const gridProps = { stroke: 'var(--grid)', vertical: false } as const

export const MODEL_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)']

/**
 * Pick a label side for each scatter point so neighbours don't overprint each other.
 * `x`/`y` should be in a space where distances look like screen distances (e.g. log10 for log axes).
 * Points close to each other horizontally get opposite sides; points near the right edge label leftward.
 */
export function labelSides<T>(points: T[], x: (p: T) => number, y: (p: T) => number,
  opts: { closeX: number; closeY: number; rightEdge: number }): Map<T, 'left' | 'right'> {
  const sides = new Map<T, 'left' | 'right'>()
  const sorted = [...points].sort((a, b) => x(a) - x(b))
  sorted.forEach(p => sides.set(p, x(p) >= opts.rightEdge ? 'left' : 'right'))
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i]
    if (Math.abs(x(b) - x(a)) < opts.closeX && Math.abs(y(b) - y(a)) < opts.closeY) {
      sides.set(a, 'left')
      sides.set(b, 'right')
    }
  }
  return sides
}
