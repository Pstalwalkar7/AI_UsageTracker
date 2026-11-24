import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { scaleLog, scaleSymlog } from 'd3-scale'
import { CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { useApi, type Portfolio as P, type Tool } from '../api'
import { useApp } from '../App'
import { axisProps, TipBox } from '../components/charts'
import { FunnelStrips } from '../components/viz'
import { Card, ErrorBox, Explain, FlagBadge, flagColor, Formula, LegendItem, Loading, PageHeader, Td, Th } from '../components/ui'
import { num, pct, roiX, usd } from '../format'

type SortKey = 'name' | 'monthly_run_rate' | 'acceptance_rate' | 'value' | 'total_cost' | 'net_value' | 'roi'

const Y_TICKS = [-1, 0, 1, 3, 10, 30]
const X_TICKS = [10, 30, 100, 300, 1000, 3000, 10000]

export default function Portfolio() {
  const { range, version } = useApp()
  const { data, error } = useApi<P>(`/api/tools?range=${range}`, version)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'roi', dir: 'desc' })
  const navigate = useNavigate()

  const rows = useMemo(() => {
    if (!data) return []
    const get = (t: Tool) => (sort.key === 'name' ? t.name : (t.metrics[sort.key] ?? -Infinity))
    return [...data.tools].sort((a, b) => {
      const va = get(a), vb = get(b)
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return sort.dir === 'asc' ? c : -c
    })
  }, [data, sort])

  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />

  // Usage cutoff sits between the least-used "high usage" tool and the most-used other tool.
  const hi = data.tools.filter(t => t.high_usage).map(t => t.metrics.monthly_run_rate)
  const lo = data.tools.filter(t => !t.high_usage && t.metrics.runs).map(t => t.metrics.monthly_run_rate)
  const cutoff = hi.length && lo.length ? Math.sqrt(Math.min(...hi) * Math.max(...lo)) : data.high_usage_threshold
  const maxRoi = Math.max(...data.tools.map(t => t.metrics.roi ?? 0))
  const yMax = maxRoi > 10 ? 30 : 10
  const points = data.tools.filter(t => t.metrics.runs > 0).map(t => ({
    id: t.id, name: t.name, flag: t.flag, x: Math.max(10, t.metrics.monthly_run_rate), y: Math.max(-1, Math.min(yMax, t.metrics.roi ?? 0)), t,
  }))

  const th = (key: SortKey, label: string, right = true) => (
    <Th className={right ? 'text-right' : ''} active={sort.key === key ? sort.dir : null}
      onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>{label}</Th>
  )

  return (
    <>
      <PageHeader title="Tool Portfolio" persona="the Director of AI Operations" question="Which tools do I scale, fix, or kill?" />

      <Card
        title="Usage vs. ROI"
        subtitle="Each dot is a tool. Bottom-right is usage without impact: lots of runs, little return."
        action={<div className="flex flex-wrap gap-3">{(['SCALE', 'FIX', 'KILL', 'WATCH'] as const).map(f => <LegendItem key={f} color={flagColor(f)} label={f} shape="dot" />)}</div>}
      >
        <div className="h-[380px]">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 8 }}>
              <ReferenceArea x1={cutoff} x2={10000} y1={-1} y2={1} fill="var(--warning)" fillOpacity={0.12} ifOverflow="hidden"
                label={{ value: 'Usage without impact', position: 'insideBottomRight', fill: 'var(--ink-2)', fontSize: 12, fontWeight: 600 }} />
              <ReferenceArea x1={10} x2={cutoff} y1={-1} y2={1} fill="var(--critical)" fillOpacity={0.06} ifOverflow="hidden"
                label={{ value: 'Kill zone', position: 'insideBottomLeft', fill: 'var(--ink-2)', fontSize: 12 }} />
              <ReferenceArea x1={cutoff} x2={10000} y1={3} y2={yMax} fill="var(--good)" fillOpacity={0.06} ifOverflow="hidden"
                label={{ value: 'Scale candidates', position: 'insideTopRight', fill: 'var(--ink-2)', fontSize: 12 }} />
              <CartesianGrid stroke="var(--grid)" />
              <XAxis type="number" dataKey="x" name="Runs / month" scale={scaleLog()} domain={[10, 10000]} ticks={X_TICKS}
                tickFormatter={v => num(v)} {...axisProps}
                label={{ value: 'Usage: runs per month (log scale)', position: 'bottom', offset: 10, fill: 'var(--muted)', fontSize: 12 }} />
              <YAxis type="number" dataKey="y" name="ROI" scale={scaleSymlog()} domain={[-1, yMax]} ticks={Y_TICKS.filter(v => v <= yMax)}
                tickFormatter={v => `${v}×`} {...axisProps} width={44}
                label={{ value: 'Net ROI', angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 12 }} />
              <ZAxis range={[110, 110]} />
              <ReferenceLine y={1} stroke="var(--axis)" label={{ value: '1×', position: 'right', fill: 'var(--muted)', fontSize: 11 }} />
              <ReferenceLine y={3} stroke="var(--axis)" label={{ value: '3× SCALE bar', position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 11 }} />
              <ReferenceLine x={cutoff} stroke="var(--axis)" label={{ value: 'top 50% usage →', position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 11 }} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              <Tooltip
                cursor={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const t = (payload[0].payload as (typeof points)[number]).t
                  return <TipBox title={t.name} rows={[
                    { color: flagColor(t.flag), label: 'Flag', value: t.flag },
                    { label: 'Runs / month', value: num(t.metrics.monthly_run_rate) },
                    { label: 'Acceptance', value: pct(t.metrics.acceptance_rate) },
                    { label: 'ROI', value: roiX(t.metrics.roi) },
                    { label: 'Net value', value: usd(t.metrics.net_value) },
                  ]} />
                }}
              />
              <Scatter
                data={points}
                onClick={(p: { id?: number }) => p.id && navigate(`/tools/${p.id}`)}
                shape={(props: { cx?: number; cy?: number; payload?: (typeof points)[number] }) => {
                  const { cx = 0, cy = 0, payload } = props
                  if (!payload) return <g />
                  const right = payload.x < 2500
                  return (
                    <g style={{ cursor: 'pointer' }}>
                      <circle cx={cx} cy={cy} r={7} fill={flagColor(payload.flag)} stroke="var(--surface)" strokeWidth={2} />
                      <text x={right ? cx + 11 : cx - 11} y={cy + 4} fontSize={12} fill="var(--ink)" textAnchor={right ? 'start' : 'end'}>{payload.name}</text>
                    </g>
                  )
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <Explain label="How to read this chart">
          <div><b className="text-ink">X:</b> monthly run rate (runs ÷ days live × 30.4). Log scale, because volumes range from ~40 to ~4,000 a month.</div>
          <div><b className="text-ink">Y:</b> net ROI = (value − cost) ÷ cost, on a symmetric log scale so that −1× to 1× stays readable next to 20×.</div>
          <div>The vertical line splits the top 50% of tools by usage from the rest. ROIs above {yMax}× are drawn at the top edge.</div>
        </Explain>
      </Card>

      <Card className="mt-4" title="From usage to impact, per tool"
        subtitle="The run funnel for each tool, drawn as nested bars: every run, the ones that completed, the ones whose output was used, and the ones used as-is. Same scale for every tool.">
        <FunnelStrips
          onSelect={id => navigate(`/tools/${id}`)}
          rows={[...data.tools].filter(t => t.metrics.runs > 0)
            .sort((a, b) => (b.funnel[2].share_of_runs ?? 0) - (a.funnel[2].share_of_runs ?? 0))
            .map(t => ({ id: t.id, name: t.name, stages: t.funnel, note: `${num(t.metrics.runs)} runs · ${num(t.active_users)} users` }))}
        />
        <p className="mt-3 text-xs leading-relaxed text-muted">
          A long light bar with a short dark one is usage without impact: people keep running the tool but rarely use what it produces.
          The Marketing Copy Generator has the second-highest run count but the shortest “used” bar.
        </p>
      </Card>

      <Card className="mt-4" title="All tools" subtitle="Click a column to sort, click a tool for its detail page">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse">
            <thead>
              <tr>
                {th('name', 'Tool', false)}
                {th('monthly_run_rate', 'Runs / mo')}
                <Th className="text-right">Users</Th>
                {th('acceptance_rate', 'Acceptance')}
                {th('value', 'Value')}
                {th('total_cost', 'Cost')}
                {th('net_value', 'Net')}
                {th('roi', 'ROI')}
                <Th>Recommendation and why</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} className="align-top hover:bg-surface-2">
                  <Td className="max-w-[220px]">
                    <Link to={`/tools/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                    <div className="text-xs text-muted">{t.department} · {t.days_live} days live</div>
                  </Td>
                  <Td className="text-right">{num(t.metrics.monthly_run_rate)}{t.high_usage && <div className="text-xs text-muted">top 50%</div>}</Td>
                  <Td className="text-right">{num(t.active_users)}<div className="text-xs text-muted">{num(t.runs_per_user)} runs each</div></Td>
                  <Td className="text-right">{pct(t.metrics.acceptance_rate)}</Td>
                  <Td className="text-right">{usd(t.metrics.value)}</Td>
                  <Td className="text-right">{usd(t.metrics.total_cost)}</Td>
                  <Td className={`text-right ${t.metrics.net_value < 0 ? 'text-bad-text' : ''}`}>{usd(t.metrics.net_value)}</Td>
                  <Td className="text-right font-semibold">{roiX(t.metrics.roi)}</Td>
                  <Td className="max-w-[340px]">
                    <FlagBadge flag={t.flag} overridden={t.overridden} />
                    <div className="mt-1 text-xs leading-relaxed text-ink-2">{t.overridden ? `Auto: ${t.auto_flag}. ` : ''}{t.reason}</div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Explain label="How flags are decided (first matching rule wins)">
            <Formula label="1. WATCH" expr="live fewer than 30 days: not enough evidence yet" />
            <Formula label="2. FIX" expr="usage without impact: top-50% usage AND (ROI < 1× OR acceptance < 50%)" />
            <div className="pl-4 text-xs">Checked before KILL on purpose. Heavy usage proves demand, so fix the quality instead of taking the tool away.</div>
            <Formula label="3. KILL" expr="ROI < 1× in each of the last 2 complete months" />
            <Formula label="4. SCALE" expr="ROI ≥ 3× AND acceptance ≥ 70%" />
            <Formula label="5. FIX" expr="everything else (pays for itself but misses the SCALE bar)" />
            <div>The Director can override any flag on the tool's detail page. The automatic flag stays visible next to the override.</div>
          </Explain>
        </div>
      </Card>
    </>
  )
}
