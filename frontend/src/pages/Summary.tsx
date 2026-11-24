import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi, type Summary as S } from '../api'
import { useApp } from '../App'
import { axisProps, gridProps, TipBox } from '../components/charts'
import { Card, Delta, ErrorBox, Explain, FlagBadge, Formula, LegendItem, Loading, PageHeader, Stat, Td, Th } from '../components/ui'
import { NetValueBars } from '../components/viz'
import { dateLabel, monthLabel, num, pct, roiX, usd } from '../format'

const RANGE_WORDS = { '1m': 'the last 30 days', '3m': 'the last 90 days', '6m': 'the last 6 months' }

export default function Summary() {
  const { range, version } = useApp()
  const { data, error } = useApi<S>(`/api/summary?range=${range}`, version)
  const navigate = useNavigate()
  const [showTable, setShowTable] = useState(false)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const t = data.totals
  const n = data.by_tool.length
  const fc = data.flag_counts
  const funnel = t.funnel ?? []
  const used = funnel.find(s => s.key === 'used')

  const complete = data.series.filter(p => !p.partial)
  const chartData = (complete.length >= 2 ? complete : data.series).map(p => ({ ...p, label: monthLabel(p.month) + (p.partial ? '*' : '') }))
  const partials = data.series.filter(p => p.partial)
  const lastPoint = chartData[chartData.length - 1]

  const pitch =
    `Over ${RANGE_WORDS[range]}, our ${n} internal AI tools returned ${num(t.hours_saved)} hours of work worth ${usd(t.value, { compact: true })}, ` +
    `against ${usd(t.total_cost, { compact: true })} of total AI cost (API, licenses and amortized build): a net ROI of ${roiX(t.roi)} ` +
    `(${usd(t.net_value, { compact: true })} net). ` +
    `Biggest wins: ${data.top_wins.map(w => `${w.name} (${usd(w.net_value, { compact: true })} net, ${roiX(w.roi)})`).join('; ')}. ` +
    (data.top_issue ? `Top issue: ${data.top_issue.name} is flagged ${data.top_issue.flag}. ${data.top_issue.reason}` : '')

  return (
    <>
      <PageHeader title="Executive Summary" persona="the CEO and C-suite" question="Is our AI investment paying off?" />

      {/* Bottom line up front */}
      <div className="mb-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
        <p className="text-lg leading-snug text-ink sm:text-xl">
          AI returned <b>{usd(t.net_value, { compact: true })} net</b> in {RANGE_WORDS[range]}: <b>{roiX(t.roi)}</b> on every dollar spent.
          {' '}<span className="text-ink-2">Recommendation: scale {fc.SCALE}, fix {fc.FIX}, kill {fc.KILL}{fc.WATCH ? `, keep watching ${fc.WATCH}` : ''}.</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Hours returned to teams" value={num(t.hours_saved)}
          sub={<>≈ {num(t.hours_saved / 160 / windowMonths(data.start, data.end), 1)} full-time people · <Delta value={data.mom.hours_saved.change} /> MoM</>}
          explain={<Explain>
            <Formula expr="Σ runs of (baseline minutes − minutes a person still spent) × outcome credit ÷ 60" />
            <div>Credit: used as-is 100%, used after edits 50%, thrown away or errored 0%.</div>
            <div>FTE = hours ÷ 160 working hours per month ÷ months in the window.</div>
          </Explain>} />
        <Stat label="Value created" value={usd(t.value, { compact: true })}
          sub={<><Delta value={data.mom.value.change} /> {monthLabel(data.mom.current_month)} vs {monthLabel(data.mom.previous_month)}</>}
          explain={<Explain>
            <Formula expr="Σ per tool of hours saved × that tool's loaded hourly rate" />
            <div>Each tool's rate is the fully-loaded $/hr of the people whose work it replaces (Support $45, Legal $150…).</div>
          </Explain>} />
        <Stat label="Total AI cost" value={usd(t.total_cost, { compact: true })}
          sub={<><Delta value={data.mom.total_cost.change} goodWhenUp={false} /> {monthLabel(data.mom.current_month)} vs {monthLabel(data.mom.previous_month)}</>}
          explain={<Explain>
            <Formula label="API / tokens" expr={usd(t.api_cost)} />
            <Formula label="Licenses & hosting" expr={usd(t.fixed_cost)} />
            <Formula label="Build (amortized over 12 months)" expr={usd(t.build_cost)} />
            <Formula label="Total" expr={`${usd(t.api_cost)} + ${usd(t.fixed_cost)} + ${usd(t.build_cost)}`} result={usd(t.total_cost)} />
          </Explain>} />
        <Stat label="Net ROI" value={roiX(t.roi)}
          sub={<>{monthLabel(data.mom.previous_month)} {roiX(data.mom.roi.prev)} → {monthLabel(data.mom.current_month)} {roiX(data.mom.roi.cur)}</>}
          explain={<Explain>
            <Formula expr={`(${usd(t.value)} − ${usd(t.total_cost)}) ÷ ${usd(t.total_cost)}`} result={roiX(t.roi, 2)} />
            <div>Read it as “${(t.roi ?? 0).toFixed(2)} back on top of every $1 spent”.</div>
          </Explain>} />
      </div>

      {/* Adoption → impact chain */}
      {t.active_users != null && used && (
        <Card className="mt-4" title="From adoption to impact" subtitle="Most companies stop measuring at the first step. Each step here is a filter on the one before.">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
            <ChainStep label="People using AI" value={num(t.active_users)} sub={`${pct((t.active_users ?? 0) / (t.headcount || 1))} of ${num(t.headcount)} employees`} tone="muted" />
            <Arrow />
            <ChainStep label="Runs" value={num(t.runs)} sub={`${num(t.runs / Math.max(1, t.active_users ?? 1))} per person`} tone="muted" />
            <Arrow />
            <ChainStep label="Outputs actually used" value={num(used.count)} sub={`${pct(used.share_of_runs)} of runs`} tone="mid" />
            <Arrow />
            <ChainStep label="Value created" value={usd(t.value, { compact: true })} sub={`${num(t.hours_saved)} hours returned`} tone="strong" />
          </div>
          <p className="mt-3 text-xs text-muted">
            Adoption (left) is what most AI dashboards report. Impact (right) only comes from the {pct(used.share_of_runs)} of runs whose output someone used.{' '}
            <Link to="/tools" className="font-medium text-accent hover:underline">See the run funnel per tool →</Link>
          </p>
        </Card>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Value vs. cost by month" subtitle="The gap between the lines is the net return"
          action={<div className="flex gap-3"><LegendItem color="var(--series-1)" label="Value" shape="line" /><LegendItem color="var(--series-2)" label="Cost" shape="line" /></div>}>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 56, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} tickFormatter={v => usd(v, { compact: true })} width={56} />
                <Tooltip cursor={{ stroke: 'var(--axis)' }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as (typeof chartData)[number]
                  return <TipBox title={`${monthLabel(p.month, true)}${p.partial ? ` (${p.days} days)` : ''}`} rows={[
                    { color: 'var(--series-1)', label: 'Value', value: usd(p.value) },
                    { color: 'var(--series-2)', label: 'Cost', value: usd(p.total_cost) },
                    { label: 'Net', value: usd(p.net_value) },
                    { label: 'ROI', value: roiX(p.roi) },
                  ]} />
                }} />
                <Line isAnimationActive={false} type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }}
                  label={(pr: { x?: number; y?: number; index?: number }) => pr.index === chartData.length - 1
                    ? <text x={(pr.x ?? 0) + 8} y={(pr.y ?? 0) + 4} fontSize={12} fill="var(--ink-2)">{usd(lastPoint.value, { compact: true })}</text> : <g />} />
                <Line isAnimationActive={false} type="monotone" dataKey="total_cost" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }}
                  label={(pr: { x?: number; y?: number; index?: number }) => pr.index === chartData.length - 1
                    ? <text x={(pr.x ?? 0) + 8} y={(pr.y ?? 0) + 4} fontSize={12} fill="var(--ink-2)">{usd(lastPoint.total_cost, { compact: true })}</text> : <g />} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {complete.length >= 2 && partials.length > 0 && (
            <p className="mt-2 text-xs text-muted">Complete months only. Partial months ({partials.map(p => `${monthLabel(p.month)}: ${p.days} days`).join(', ')}) count in the totals but are left off the line so they don’t look like a drop.</p>
          )}
        </Card>

        <Card title="Ready for the leadership update" subtitle="Generated from the numbers on this page">
          <PasteBlock text={pitch} />
        </Card>
      </div>

      <Card className="mt-4" title="Where the net return comes from"
        subtitle="Net value (value − cost) per tool, best first. Red bars cost more than they return."
        action={<button onClick={() => setShowTable(s => !s)} className="whitespace-nowrap text-sm font-medium text-accent hover:underline">{showTable ? 'Show chart' : 'Show as table'}</button>}>
        {showTable ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead><tr><Th>Tool</Th><Th className="text-right">Hours</Th><Th className="text-right">Value</Th><Th className="text-right">Cost</Th><Th className="text-right">Net</Th><Th className="text-right">ROI</Th><Th>Flag</Th></tr></thead>
              <tbody>
                {[...data.by_tool].sort((a, b) => b.net_value - a.net_value).map(r => (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <Td><Link to={`/tools/${r.id}`} className="font-medium hover:underline">{r.name}</Link></Td>
                    <Td className="text-right">{num(r.hours_saved)}</Td><Td className="text-right">{usd(r.value)}</Td><Td className="text-right">{usd(r.total_cost)}</Td>
                    <Td className={`text-right ${r.net_value < 0 ? 'text-bad-text' : ''}`}>{usd(r.net_value)}</Td><Td className="text-right">{roiX(r.roi)}</Td><Td><FlagBadge flag={r.flag} /></Td>
                  </tr>
                ))}
                <tr className="font-semibold"><Td>Total</Td><Td className="text-right">{num(t.hours_saved)}</Td><Td className="text-right">{usd(t.value)}</Td><Td className="text-right">{usd(t.total_cost)}</Td><Td className="text-right">{usd(t.net_value)}</Td><Td className="text-right">{roiX(t.roi)}</Td><Td /></tr>
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <NetValueBars
              items={data.by_tool.map(r => ({ id: r.id, name: r.name, value: r.net_value, gross: r.value, cost: r.total_cost, roi: r.roi }))}
              onSelect={id => navigate(`/tools/${id}`)}
            />
            <div className="mt-2 flex items-baseline justify-between border-t border-line px-2 pt-3">
              <span className="text-sm font-medium text-ink-2">Net return, all tools</span>
              <span className="text-lg font-semibold tnum">{t.net_value > 0 ? '+' : ''}{usd(t.net_value, { compact: true })}</span>
            </div>
          </>
        )}
        <p className="mt-2 text-xs text-muted">Covers {dateLabel(data.start)} to {dateLabel(data.end)}. Click a row to open that tool.</p>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Top 3 wins" subtitle="Ranked by net value">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.top_wins.map((w, i) => (
              <Link key={w.id} to={`/tools/${w.id}`} className="rounded-lg border border-line p-4 transition-colors hover:bg-surface-2">
                <div className="text-xs font-medium text-muted">#{i + 1} · {w.department}</div>
                <div className="mt-1 font-semibold leading-snug">{w.name}</div>
                <div className="mt-3 text-2xl font-semibold tracking-tight">{usd(w.net_value, { compact: true })}</div>
                <div className="text-sm text-ink-2">net · {roiX(w.roi)} ROI · {num(w.hours_saved)} h</div>
              </Link>
            ))}
          </div>
        </Card>

        {data.top_issue && (
          <Card title="Top flagged problem" subtitle="The flagged tool with the most spend at stake">
            <Link to={`/tools/${data.top_issue.id}`} className="block rounded-lg p-4 hover:opacity-90" style={{ background: 'var(--warning-wash)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{data.top_issue.name}</div>
                <FlagBadge flag={data.top_issue.flag} />
              </div>
              <div className="mt-2 text-sm text-ink-2">{data.top_issue.reason}</div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm tnum">
                <div><div className="text-xs text-muted">Runs</div>{num(data.top_issue.runs)}</div>
                <div><div className="text-xs text-muted">Used</div>{pct(data.top_issue.acceptance_rate)}</div>
                <div><div className="text-xs text-muted">Cost</div>{usd(data.top_issue.total_cost, { compact: true })}</div>
              </div>
            </Link>
            {data.other_issues.length > 0 && (
              <div className="mt-3 space-y-1.5 text-sm">
                <div className="text-xs font-medium text-muted">Also flagged</div>
                {data.other_issues.map(o => (
                  <Link key={o.id} to={`/tools/${o.id}`} className="flex items-center justify-between gap-2 hover:underline">
                    <span className="truncate">{o.name}</span><FlagBadge flag={o.flag} />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  )
}

function windowMonths(start: string, end: string) {
  const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1
  return Math.max(1, days / 30.4)
}

function ChainStep({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'muted' | 'mid' | 'strong' }) {
  const bg = tone === 'strong' ? 'var(--series-1)' : tone === 'mid' ? 'var(--accent-wash)' : 'var(--surface-2)'
  const strong = tone === 'strong'
  return (
    <div className="rounded-lg p-4" style={{ background: bg }}>
      <div className={`text-xs font-medium ${strong ? 'text-white/85' : 'text-ink-2'}`}>{label}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight tnum ${strong ? 'text-white' : 'text-ink'}`}>{value}</div>
      <div className={`text-xs ${strong ? 'text-white/85' : 'text-muted'}`}>{sub}</div>
    </div>
  )
}

function Arrow(): ReactNode {
  return <div className="hidden items-center justify-center text-lg text-muted lg:flex" aria-hidden>→</div>
}

function PasteBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <p className="text-sm leading-relaxed text-ink">{text}</p>
      <button className="mt-3 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
        onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ } }}>
        {copied ? 'Copied ✓' : 'Copy text'}
      </button>
    </div>
  )
}
