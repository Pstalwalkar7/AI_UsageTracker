import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi, type Spend as S } from '../api'
import { useApp } from '../App'
import { axisProps, gridProps, MODEL_COLORS, TipBox } from '../components/charts'
import { Callout, Card, ErrorBox, Explain, FlagBadge, Formula, LegendItem, Loading, PageHeader, Stat, Td, Th } from '../components/ui'
import { monthLabel, num, pct, roiX, signedPct, usd, usd4 } from '../format'

export default function Spend() {
  const { range, version, meta } = useApp()
  const { data, error } = useApi<S>(`/api/spend?range=${range}`, version)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const t = data.totals

  // Color follows the model (fixed order from /api/meta), never its rank in this window.
  const allModels = meta?.models ?? data.by_model.map(m => m.model)
  const colorOf = (model: string) => MODEL_COLORS[Math.max(0, allModels.indexOf(model)) % MODEL_COLORS.length]
  const shown = allModels.filter(md => data.by_model.some(b => b.model === md))
  const series = data.series.map(p => ({ ...p, label: monthLabel(p.month) + (p.partial ? '*' : ''), ...p.api_by_model }))
  const outpacing = data.growth.filter(g => g.outpacing)

  return (
    <>
      <PageHeader title="AI Spend" persona="Finance" question="What do we spend on AI, and what do we get for it?" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total AI cost" value={usd(t.total_cost, { compact: true })} sub={`returns ${usd(t.value, { compact: true })} of value`} />
        <Stat label="API / token spend" value={usd(t.api_cost, { compact: true })} sub={`${pct(t.api_cost / t.total_cost)} of total cost`} />
        <Stat label="Licenses + amortized build" value={usd(t.fixed_cost + t.build_cost, { compact: true })} sub={`${usd(t.fixed_cost, { compact: true })} licenses · ${usd(t.build_cost, { compact: true })} build`} />
        <Stat label="Cost per successful outcome" value={usd4(t.cost_per_success)} sub={`vs ${usd4(t.total_cost / t.runs)} per call`}
          explain={<Explain><Formula expr={`${usd(t.total_cost)} ÷ ${num(t.successful_runs)} accepted or edited runs`} result={usd4(t.cost_per_success)} /><div>Failed and rejected calls still cost money, so the honest unit price is per success, not per call.</div></Explain>} />
      </div>

      {outpacing.length > 0 && (
        <div className="mt-4">
          <Callout tone="warn">
            <b className="text-ink">Cost growing faster than value</b> ({monthLabel(data.growth_months[0])} → {monthLabel(data.growth_months[1])}):{' '}
            {outpacing.map((g, i) => (
              <span key={g.id}>{i > 0 && '; '}<Link to={`/tools/${g.id}`} className="font-medium text-ink hover:underline">{g.name}</Link> cost {signedPct(g.cost_growth)}, value {signedPct(g.value_growth)}</span>
            ))}.
          </Callout>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="API spend by model, per month"
          action={<div className="flex flex-wrap justify-end gap-3">{shown.map(md => <LegendItem key={md} color={colorOf(md)} label={md} />)}</div>}>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} tickFormatter={v => usd(v, { compact: true })} width={52} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as (typeof series)[number]
                  return <TipBox title={`${monthLabel(p.month, true)}${p.partial ? ` (${p.days} days)` : ''}`} rows={[
                    ...shown.filter(md => p.api_by_model[md]).map(md => ({ color: colorOf(md), label: md, value: usd(p.api_by_model[md]) })),
                    { label: 'Total API', value: usd(p.api_cost) },
                  ]} />
                }} />
                {shown.map((md, i) => (
                  <Bar isAnimationActive={false} key={md} dataKey={md} stackId="api" fill={colorOf(md)} maxBarSize={36}
                    stroke="var(--surface)" strokeWidth={1}
                    radius={i === shown.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-muted">* partial month. API cost only; licenses and build are fixed per day.</p>
        </Card>

        <Card className="lg:col-span-2" title="By model" subtitle="Cheap per call isn’t cheap per success">
          <table className="w-full border-collapse">
            <thead><tr><Th>Model</Th><Th className="text-right">Per call</Th><Th className="text-right">Success</Th><Th className="text-right">Per success</Th></tr></thead>
            <tbody>
              {data.by_model.map(md => (
                <tr key={md.model}>
                  <Td><LegendItem color={colorOf(md.model)} label={md.model} /></Td>
                  <Td className="text-right">{usd4(md.api_cost_per_run)}</Td>
                  <Td className="text-right">{pct(md.acceptance_rate)}</Td>
                  <Td className="text-right font-semibold">{usd4(md.api_cost_per_success)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="mt-4" title="Cost breakdown by tool" subtitle="Sorted by total cost">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead><tr><Th>Tool</Th><Th className="text-right">API</Th><Th className="text-right">Licenses</Th><Th className="text-right">Build (amort.)</Th><Th className="text-right">Total cost</Th><Th className="text-right">Per call</Th><Th className="text-right">Per success</Th><Th className="text-right">Value</Th><Th className="text-right">ROI</Th><Th /></tr></thead>
            <tbody>
              {data.by_tool.map(r => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <Td><Link to={`/tools/${r.id}`} className="font-medium hover:underline">{r.name}</Link></Td>
                  <Td className="text-right">{usd(r.api_cost)}</Td>
                  <Td className="text-right">{usd(r.fixed_cost)}</Td>
                  <Td className="text-right">{usd(r.build_cost)}</Td>
                  <Td className="text-right font-semibold">{usd(r.total_cost)}</Td>
                  <Td className="text-right">{usd4(r.cost_per_run)}</Td>
                  <Td className="text-right">{usd4(r.cost_per_success)}</Td>
                  <Td className="text-right">{usd(r.value)}</Td>
                  <Td className="text-right">{roiX(r.roi)}</Td>
                  <Td><FlagBadge flag={r.flag} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4" title="Is spend growing faster than value?" subtitle={`${monthLabel(data.growth_months[0], true)} vs ${monthLabel(data.growth_months[1], true)}, a full quarter of trend instead of one noisy month`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead><tr><Th>Tool</Th><Th className="text-right">Cost then → now</Th><Th className="text-right">Cost growth</Th><Th className="text-right">Value growth</Th><Th>Verdict</Th></tr></thead>
            <tbody>
              {data.growth.map(g => (
                <tr key={g.id}>
                  <Td>{g.name}</Td>
                  <Td className="text-right">{usd(g.prev_cost)} → {usd(g.cur_cost)}</Td>
                  <Td className="text-right">{signedPct(g.cost_growth)}</Td>
                  <Td className="text-right">{signedPct(g.value_growth)}</Td>
                  <Td className={g.outpacing ? 'font-semibold text-bad-text' : 'text-ink-2'}>{g.outpacing ? '⚠ Cost outpacing value' : 'OK'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3"><Explain><div>Flagged when cost grew and grew at least 10 percentage points faster than value. Tools launched after {monthLabel(data.growth_months[0])} are excluded.</div></Explain></div>
      </Card>
    </>
  )
}
