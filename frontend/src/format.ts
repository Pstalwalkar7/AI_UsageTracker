export const usd = (n: number | null | undefined, opts: { compact?: boolean; cents?: boolean } = {}) => {
  if (n == null || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (opts.compact && abs >= 1000) {
    const s = abs >= 1e6 ? `${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M` : `${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`
    return `${n < 0 ? '−' : ''}$${s}`
  }
  const digits = opts.cents || (abs > 0 && abs < 10) ? 2 : 0
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${n < 0 ? '−' : ''}$${s}`
}

/** Unit prices: 2 decimals, or 4 for sub-dime amounts where cents would round to $0.0x. */
export const usd4 = (n: number | null | undefined) => {
  if (n == null) return '—'
  const d = Math.abs(n) < 0.1 ? 4 : 2
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

export const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : `${(n * 100).toFixed(digits)}%`

export const signedPct = (n: number | null | undefined) => {
  if (n == null) return '—'
  const r = Math.round(n * 100)
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}%`
}

export const roiX = (n: number | null | undefined, digits = 1) => {
  if (n == null) return '—'
  const s = Math.abs(n).toFixed(digits)
  return `${n < 0 && Number(s) !== 0 ? '−' : ''}${s}×`
}

export const monthLabel = (ym: string, long = false) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}) })
}

export const dateLabel = (iso: string) =>
  new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export const reasonLabel = (r: string) =>
  ({ bad_input: 'Bad input', hallucination: 'Hallucination', timeout: 'Timeout', user_rejected: 'User rejected' } as Record<string, string>)[r] ?? r
