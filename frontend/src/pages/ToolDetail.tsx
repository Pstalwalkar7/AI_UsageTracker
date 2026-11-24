import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useApi, type Assumptions, type Flag, type Outcome, type ToolDetail as TD } from '../api'
import { useApp } from '../App'
import { axisProps, gridProps, TipBox } from '../components/charts'
import { Funnel } from '../components/viz'
import { Callout, Card, ErrorBox, Explain, FlagBadge, Formula, LegendItem, Loading, Stat, Td, Th } from '../components/ui'
import { dateLabel, monthLabel, num, pct, reasonLabel, roiX, usd, usd4 } from '../format'


export default function ToolDetail() {
  const { id } = useParams()
  const { range, version, bump } = useApp()
  const { data, error, setData } = useApi<TD>(`/api/tools/${id}?range=${range}`, version)
  const [change, setChange] = useState<{ before: { roi: number | null; flag: Flag }; after: { roi: number | null; flag: Flag } } | null>(null)

  useEffect(() => setChange(null), [id])

  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const m = data.metrics
  const a = data.assumptions

  const save = async (patch: Partial<Assumptions> & { clear_override?: boolean }) => {
    const before = { roi: m.roi, flag: data.flag }
    const updated = await api<TD>(`/api/tools/${data.id}?range=${range}`, { method: 'PATCH', body: JSON.stringify(patch) })
    setData(updated)
    setChange({ before, after: { roi: updated.metrics.roi, flag: updated.flag } })
    bump()
  }

  // Reconstruct the per-outcome math from the totals so the explanation uses real numbers.
  const avgHuman = (o: Outcome) => {
    const n = m.runs_by_outcome[o]
    if (!n) return 0
    const weight = o === 'accepted' ? 1 : 0.5
    const saved = m.value_by_outcome[o] / a.loaded_hourly_rate * 60 / weight
    return a.baseline_minutes_per_task - saved / n
  }
  const series = data.series.map(p => ({ ...p, label: monthLabel(p.month) + (p.partial ? '*' : '') }))
  const fullWeeks = data.weekly.filter(w => !w.partial)
  const weekly = (fullWeeks.length >= 3 ? fullWeeks : data.weekly).map(w => ({ ...w, label: new Date(w.week + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }))
  const reasons = Object.values(data.failure_reasons.reduce<Record<string, { reason: string; runs: number }>>((acc, r) => {
    acc[r.reason] = { reason: r.reason, runs: (acc[r.reason]?.runs ?? 0) + r.runs }
    return acc
  }, {})).sort((x, y) => y.runs - x.runs)

  return (
    <>
      <Link to="/tools" className="text-sm text-accent hover:underline">← Tool Portfolio</Link>
      <header className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">For the tool owner · {data.owner}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <p className="mt-1 text-[15px] text-ink-2">{data.description}</p>
          <p className="mt-1 text-sm text-muted">{data.department} · launched {dateLabel(data.launch_date)} ({data.days_live} days ago)</p>
        </div>
        <FlagBadge flag={data.flag} overridden={data.overridden} size="lg" />
      </header>

      {change && (
        <div className="mb-4">
          <Callout tone={change.before.flag !== change.after.flag ? 'warn' : 'info'}>
            <b className="text-ink">Recalculated.</b> ROI {roiX(change.before.roi)} → <b className="text-ink">{roiX(change.after.roi)}</b>
            {change.before.flag !== change.after.flag
              ? <>; flag {change.before.flag} → <b className="text-ink">{change.after.flag}</b>. Every page now reflects the new assumptions.</>
              : <>; flag stays {change.after.flag}.</>}
          </Callout>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Why this recommendation" subtitle="Rules are checked top to bottom. The first one that matches wins.">
          <p className="mb-3 text-sm text-ink">{data.reason}</p>
          <ol className="space-y-2">
            {data.checks.map((c, i) => {
              const fired = c.rule === data.auto_flag && c.passed && data.checks.slice(0, i).every(p => !p.passed)
              return (
                <li key={c.rule + i} className={`flex gap-3 rounded-lg p-2.5 text-sm ${fired ? 'bg-accent-wash' : ''}`}>
                  <span className={`mt-0.5 w-5 shrink-0 text-center font-semibold ${c.passed ? 'text-ink' : 'text-muted'}`} aria-label={c.passed ? 'true' : 'false'}>{c.passed ? '✓' : '✗'}</span>
                  <div className="min-w-0">
                    <div><b className="text-ink">{c.rule}</b> <span className="text-ink-2">if {c.test}</span>{fired && <span className="ml-2 text-xs font-semibold text-accent">← decided here</span>}</div>
                    <div className="text-xs text-muted tnum">Observed: {c.observed}</div>
                  </div>
                </li>
              )
            })}
            {data.auto_flag === 'FIX' && !data.checks.some(c => c.passed && c.rule === 'FIX') && (
              <li className="flex gap-3 rounded-lg bg-accent-wash p-2.5 text-sm">
                <span className="mt-0.5 w-5 shrink-0 text-center font-semibold">→</span>
                <div><b>FIX</b> <span className="text-ink-2">otherwise (no earlier rule matched)</span><span className="ml-2 text-xs font-semibold text-accent">← decided here</span></div>
              </li>
            )}
          </ol>
        </Card>

        <Card title="Override the flag" subtitle="The Director has the final say. The automatic flag stays visible.">
          <div className="grid grid-cols-2 gap-2">
            {(['SCALE', 'FIX', 'KILL', 'WATCH'] as Flag[]).map(f => (
              <button key={f} onClick={() => save({ status_override: f })}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${a.status_override === f ? 'border-accent bg-accent-wash' : 'border-line hover:bg-surface-2'}`}>
                {f}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-2">Automatic: <b className="text-ink">{data.auto_flag}</b>{a.status_override && <> · Override: <b className="text-ink">{a.status_override}</b></>}</p>
          {a.status_override && <button onClick={() => save({ clear_override: true })} className="mt-2 text-sm font-medium text-accent hover:underline">Clear override</button>}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Value created" value={usd(m.value, { compact: true })} sub={`${num(m.hours_saved)} hours returned`}
          explain={
            <Explain>
              {(['accepted', 'edited'] as Outcome[]).map(o => m.runs_by_outcome[o] > 0 && (
                <Formula key={o} label={o === 'accepted' ? 'Accepted' : 'Edited (50%)'}
                  expr={`${num(m.runs_by_outcome[o])} runs × (${a.baseline_minutes_per_task} − ${avgHuman(o).toFixed(1)} avg min)${o === 'edited' ? ' × 50%' : ''} ÷ 60 × $${a.loaded_hourly_rate}/hr`}
                  result={usd(m.value_by_outcome[o])} />
              ))}
              <div>Rejected and failed runs ({num(m.runs_by_outcome.rejected + m.runs_by_outcome.failed)}) add cost but no value.</div>
            </Explain>
          } />
        <Stat label="Total cost" value={usd(m.total_cost, { compact: true })} sub={`${usd4(m.cost_per_run)} per run`}
          explain={
            <Explain>
              <Formula label="API" expr={`${num(m.runs)} runs`} result={usd(m.api_cost)} />
              <Formula label="Licenses & hosting" expr={`$${num(a.monthly_fixed_cost)}/mo × ${m.active_days} days`} result={usd(m.fixed_cost)} />
              <Formula label="Build (amortized)" expr={`$${num(a.build_cost)} ÷ 365 days × days in window`} result={usd(m.build_cost)} />
            </Explain>
          } />
        <Stat label="Net ROI" value={roiX(m.roi)} sub={`${usd(m.net_value, { compact: true })} net`}
          explain={<Explain><Formula expr={`(${usd(m.value)} − ${usd(m.total_cost)}) ÷ ${usd(m.total_cost)}`} result={roiX(m.roi, 2)} /></Explain>} />
        <Stat label="Cost per successful run" value={usd4(m.cost_per_success)} sub={`${pct(m.acceptance_rate)} of runs succeed`}
          explain={
            <Explain>
              <Formula expr={`${usd(m.total_cost)} ÷ ${num(m.successful_runs)} accepted or edited runs`} result={usd4(m.cost_per_success)} />
              <div>A cheap call that usually fails is expensive per success. This is the number to compare tools on.</div>
            </Explain>
          } />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Value vs. cost by month" action={<div className="flex gap-3"><LegendItem color="var(--series-1)" label="Value" /><LegendItem color="var(--series-2)" label="Cost" /></div>}>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={series} barGap={2} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} tickFormatter={v => usd(v, { compact: true })} width={52} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as (typeof series)[number]
                  return <TipBox title={`${monthLabel(p.month, true)}${p.partial ? ` (${p.days} days)` : ''}`} rows={[
                    { color: 'var(--series-1)', label: 'Value', value: usd(p.value) },
                    { color: 'var(--series-2)', label: 'Cost', value: usd(p.total_cost) },
                    { label: 'ROI', value: roiX(p.roi) },
                    { label: 'Runs', value: num(p.runs) },
                  ]} />
                }} />
                <Bar isAnimationActive={false} dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar isAnimationActive={false} dataKey="total_cost" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-muted">* partial month</p>
        </Card>

        <Card title="Success rate by month" subtitle="Share of runs accepted or edited">
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} domain={[0, 1]} tickFormatter={v => pct(v)} width={44} />
                <Tooltip cursor={{ stroke: 'var(--axis)' }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as (typeof series)[number]
                  return <TipBox title={monthLabel(p.month, true)} rows={[
                    { color: 'var(--series-1)', label: 'Success rate', value: pct(p.acceptance_rate, 1) },
                    ...Object.entries(p.failures).map(([r, n]) => ({ label: reasonLabel(r), value: num(n) })),
                  ]} />
                }} />
                <Line isAnimationActive={false} type="monotone" dataKey="acceptance_rate" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="Adoption: who is using it, and how much"
        subtitle={`${num(data.active_users)} people ran it in this window, ${num(data.runs_per_user)} runs each on average. Weekly view below.`}
        action={<div className="flex gap-3"><LegendItem color="var(--series-1)" label="Active users / week" shape="line" /></div>}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_220px]">
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={weekly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axisProps} axisLine={false} allowDecimals={false} width={36} />
                <Tooltip cursor={{ stroke: 'var(--axis)' }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as (typeof weekly)[number]
                  return <TipBox title={`Week of ${p.label}${p.partial ? ' (partial)' : ''}`} rows={[
                    { color: 'var(--series-1)', label: 'Active users', value: num(p.active_users) },
                    { label: 'Runs', value: num(p.runs) },
                    { label: 'Runs per user', value: num(p.runs_per_user, 1) },
                    { label: 'Output used', value: pct(p.acceptance_rate) },
                  ]} />
                }} />
                <Line isAnimationActive={false} type="monotone" dataKey="active_users" stroke="var(--series-1)" strokeWidth={2} dot={weekly.length < 8 ? { r: 3 } : false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-3 self-start lg:grid-cols-1">
            <MiniStat label="Active users" value={num(data.active_users)} />
            <MiniStat label="Runs per user" value={num(data.runs_per_user)} />
            <MiniStat label="Value per user" value={usd(data.active_users ? m.value / data.active_users : 0, { compact: true })} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">Complete weeks only (the first and the current week are partial). A flat line means the same people keep using it; read it together with the funnel below.</p>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Run funnel" subtitle="What happens to every run, from start to an output someone used">
          <Funnel stages={data.funnel} valueAtEnd={`${usd(m.value)} from ${num(m.successful_runs)} used outputs`} />
          {m.wasted_human_minutes > 0 && (
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Not counted in ROI: people also spent {num(m.wasted_human_minutes / 60)} hours reviewing outputs that were thrown away or errored.
              Counting that would lower ROI further, so the reported number is conservative.
            </p>
          )}
        </Card>

        <Card title="Top failure reasons" subtitle="Where to look first">
          {reasons.length === 0 ? <p className="text-sm text-muted">No failures in this window.</p> : (
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={reasons.map(r => ({ ...r, label: reasonLabel(r.reason) }))} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="label" {...axisProps} axisLine={false} width={110} />
                  <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload as { label: string; runs: number }
                    return <TipBox title={p.label} rows={[{ label: 'Runs', value: num(p.runs) }, { label: 'Share of all runs', value: pct(p.runs / m.runs, 1) }]} />
                  }} />
                  <Bar isAnimationActive={false} dataKey="runs" fill="var(--series-2)" radius={[0, 4, 4, 0]} maxBarSize={20}
                    label={{ position: 'right', fill: 'var(--ink-2)', fontSize: 12, formatter: (v: number) => num(v) }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {data.models.length > 0 && (
            <>
              <div className="mb-1 mt-4 text-xs font-medium text-muted">Models used</div>
              <table className="w-full border-collapse">
                <thead><tr><Th>Model</Th><Th className="text-right">Runs</Th><Th className="text-right">Success</Th><Th className="text-right">API $/success</Th></tr></thead>
                <tbody>
                  {data.models.map(md => (
                    <tr key={md.model}><Td>{md.model}</Td><Td className="text-right">{num(md.runs)}</Td><Td className="text-right">{pct(md.acceptance_rate)}</Td><Td className="text-right">{usd4(md.api_cost_per_success)}</Td></tr>
                  ))}
                </tbody>
              </table>
              {data.models.length > 1 && <p className="mt-2 text-xs text-muted">The model changed during this window. Compare the success rates: did the pricier model actually help?</p>}
            </>
          )}
        </Card>
      </div>

      <AssumptionsEditor key={`${data.id}-${version}`} a={a} onSave={save} />

      <Card className="mt-4" title="Latest runs" subtitle="Per-run value = outcome weight × (baseline − human minutes) ÷ 60 × hourly rate">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead><tr><Th>When (UTC)</Th><Th>Outcome</Th><Th className="text-right">Human min</Th><Th className="text-right">Min saved</Th><Th className="text-right">Value</Th><Th className="text-right">API cost</Th><Th>Model</Th></tr></thead>
            <tbody>
              {data.recent_runs.map(r => (
                <tr key={r.id}>
                  <Td>{r.timestamp.replace('T', ' ').slice(0, 16)}</Td>
                  <Td>{r.outcome}{r.failure_reason && <span className="text-muted"> · {reasonLabel(r.failure_reason)}</span>}</Td>
                  <Td className="text-right">{r.human_minutes_with_ai.toFixed(1)}</Td>
                  <Td className="text-right">{r.minutes_saved.toFixed(1)}</Td>
                  <Td className="text-right">{usd(r.value, { cents: true })}</Td>
                  <Td className="text-right">{usd4(r.api_cost_usd)}</Td>
                  <Td className="text-ink-2">{r.model_name}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function AssumptionsEditor({ a, onSave }: { a: Assumptions; onSave: (p: Partial<Assumptions>) => Promise<void> }) {
  const [form, setForm] = useState({
    baseline_minutes_per_task: String(a.baseline_minutes_per_task),
    loaded_hourly_rate: String(a.loaded_hourly_rate),
    build_cost: String(a.build_cost),
    monthly_fixed_cost: String(a.monthly_fixed_cost),
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fields: { key: keyof typeof form; label: string; hint: string; prefix?: string }[] = [
    { key: 'baseline_minutes_per_task', label: 'Baseline minutes per task', hint: 'How long a person took before AI' },
    { key: 'loaded_hourly_rate', label: 'Loaded hourly rate', hint: 'Salary + benefits + overhead, per hour', prefix: '$' },
    { key: 'build_cost', label: 'One-time build cost', hint: 'Spread over the first 12 months', prefix: '$' },
    { key: 'monthly_fixed_cost', label: 'Monthly fixed cost', hint: 'Licenses, hosting', prefix: '$' },
  ]
  const dirty = fields.some(f => Number(form[f.key]) !== a[f.key])
  return (
    <Card className="mt-4" title="Baseline assumptions" subtitle="These drive every number above. Change one and save to recalculate ROI and the flag across the app.">
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={async e => {
          e.preventDefault()
          setSaving(true); setErr(null)
          try {
            await onSave(Object.fromEntries(fields.map(f => [f.key, Number(form[f.key])])) as Partial<Assumptions>)
          } catch (ex) { setErr((ex as Error).message) } finally { setSaving(false) }
        }}
      >
        {fields.map(f => (
          <label key={f.key} className="block">
            <span className="text-sm font-medium">{f.label}</span>
            <div className="mt-1 flex items-center rounded-lg border border-line bg-page px-3 focus-within:border-accent">
              {f.prefix && <span className="text-sm text-muted">{f.prefix}</span>}
              <input type="number" step="any" min="0" required value={form[f.key]}
                onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                className="w-full bg-transparent px-1 py-2 text-sm outline-none tnum" />
            </div>
            <span className="mt-1 block text-xs text-muted">{f.hint}</span>
          </label>
        ))}
        <div className="flex items-start pt-6">
          <button disabled={!dirty || saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" style={{ background: 'var(--series-1)' }}>
            {saving ? 'Saving…' : 'Save & recalculate'}
          </button>
        </div>
      </form>
      {err && <p className="mt-2 text-sm text-bad-text">{err}</p>}
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold tnum text-ink">{value}</div>
    </div>
  )
}
