import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { useApi, type Department } from '../api'
import { useApp } from '../App'
import { axisProps, labelSides, TipBox } from '../components/charts'
import { Callout, Card, ErrorBox, Explain, LegendItem, Loading, PageHeader, Td, Th } from '../components/ui'
import { UsageFlow, type FlowData } from '../components/viz'
import { num, pct, roiX, usd } from '../format'

const IMPACT_BAR = 2 // hours returned per active user per month that counts as "meaningful" (~30 min a week)

export default function Departments() {
  const { range, version } = useApp()
  const { data, error } = useApi<{ departments: Department[]; flow: FlowData }>(`/api/departments?range=${range}`, version)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const depts = [...data.departments].sort((a, b) => b.value - a.value)
  const gap = [...data.departments].sort((a, b) => b.gap_hours_per_month - a.gap_hours_per_month)
  const biggest = gap[0]
  const chart = [...data.departments].sort((a, b) => b.manual_hours_per_month - a.manual_hours_per_month)
    .map(d => ({ name: d.name, returned: d.hours_saved_per_month, remaining: d.gap_hours_per_month, d }))

  const points = data.departments.filter(d => d.active_users > 0).map(d => ({
    name: d.name, x: (d.adoption ?? 0) * 100, y: d.hours_per_active_user_per_month ?? 0, d,
  }))
  const yMax = Math.max(8, Math.ceil(Math.max(...points.map(p => p.y)) + 1))
  const sides = labelSides(points, p => p.x, p => p.y, { closeX: 8, closeY: yMax * 0.08, rightEdge: 90 })
  const adoptedNoImpact = points.filter(p => p.x >= 50 && p.y < IMPACT_BAR).sort((a, b) => b.x - a.x)

  return (
    <>
      <PageHeader title="Departments" persona="department heads" question="What is AI doing for my team, and where should we build next?" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Adoption vs. impact"
          subtitle="Across: share of the department that used any AI tool. Up: hours each of those people got back per month.">
          <div className="h-[340px]">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 12, right: 56, bottom: 28, left: 4 }}>
                <ReferenceArea x1={50} x2={100} y1={0} y2={IMPACT_BAR} fill="var(--warning)" fillOpacity={0.12}
                  label={{ value: 'Adopted, little impact', position: 'insideTopLeft', fill: 'var(--ink-2)', fontSize: 12, fontWeight: 600 }} />
                <ReferenceArea x1={50} x2={100} y1={IMPACT_BAR} y2={yMax} fill="var(--good)" fillOpacity={0.06}
                  label={{ value: 'Adopted and paying off', position: 'insideTopLeft', fill: 'var(--ink-2)', fontSize: 12 }} />
                <CartesianGrid stroke="var(--grid)" />
                <XAxis type="number" dataKey="x" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v}%`} {...axisProps}
                  label={{ value: 'Adoption: % of headcount using AI', position: 'bottom', offset: 10, fill: 'var(--muted)', fontSize: 12 }} />
                <YAxis type="number" dataKey="y" domain={[0, yMax]} tickFormatter={v => `${v} h`} {...axisProps} width={44}
                  label={{ value: 'Hours back per user / month', angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 12, dy: 70 }} />
                <ZAxis range={[100, 100]} />
                <ReferenceLine y={IMPACT_BAR} stroke="var(--axis)" />
                <ReferenceLine x={50} stroke="var(--axis)" />
                <Tooltip cursor={false} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = (payload[0].payload as (typeof points)[number]).d
                  return <TipBox title={d.name} rows={[
                    { label: 'People using AI', value: `${num(d.active_users)} of ${num(d.headcount)} (${pct(d.adoption)})` },
                    { label: 'Hours back / user / month', value: num(d.hours_per_active_user_per_month, 1) },
                    { label: 'Hours back / month (dept)', value: num(d.hours_saved_per_month) },
                    { label: 'Tools owned', value: num(d.tools_owned) },
                  ]} />
                }} />
                <Scatter isAnimationActive={false} data={points} shape={(props: { cx?: number; cy?: number; payload?: (typeof points)[number] }) => {
                  const { cx = 0, cy = 0, payload } = props
                  if (!payload) return <g />
                  const left = sides.get(payload) === 'left'
                  return (
                    <g>
                      <circle cx={cx} cy={cy} r={6} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
                      <text x={left ? cx - 10 : cx + 10} y={cy + 4} fontSize={12} fill="var(--ink)" textAnchor={left ? 'end' : 'start'}>{payload.name}</text>
                    </g>
                  )
                }} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-2" title="What this shows">
          <div className="space-y-3 text-sm leading-relaxed text-ink-2">
            <p>A usage dashboard would call every department here a success: most of each team has used AI.</p>
            {adoptedNoImpact.length > 0 && (
              <p>
                But <b className="text-ink">{adoptedNoImpact.map(p => p.name).join(', ')}</b> get less than {IMPACT_BAR} hours a month back per person.
                Their AI use is mostly the company-wide HR bot: lots of quick questions, little time saved, and no tool built for their own work.
              </p>
            )}
            <p>Departments in the top right have a tool designed around their core task. That's the pattern to copy.</p>
            {biggest && (
              <Callout tone="warn">
                <b className="text-ink">Build next for {biggest.name}.</b> About {num(biggest.manual_hours_per_month)} hours/month of repetitive work, AI covers {pct(biggest.coverage, 1)}.
                {biggest.backlog_ideas[0] && <> Top idea: {biggest.backlog_ideas[0].name} (score {biggest.backlog_ideas[0].priority_score?.toFixed(1)}×). <Link to="/backlog" className="font-medium text-accent hover:underline">Backlog →</Link></>}
              </Callout>
            )}
          </div>
          <div className="mt-3">
            <Explain>
              <div><b className="text-ink">Adoption</b> = distinct people with at least one run in the window ÷ department headcount.</div>
              <div><b className="text-ink">Hours back per user</b> = hours returned per month ÷ those people. Value goes to the department of the person who ran the tool.</div>
              <div>The {IMPACT_BAR} h line is about 30 minutes a week: a rough bar for “this changed how I work”.</div>
            </Explain>
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="Who uses what, and where the output ends up"
        subtitle="Band width is the number of runs. Left: the department of the person running it. Middle: the tool. Right: what happened to the output."
        action={<div className="flex flex-wrap gap-3"><LegendItem color="var(--series-1)" label="Used as-is" /><LegendItem color="var(--series-3)" label="Used after edits" /><LegendItem color="var(--series-2)" label="Discarded" /></div>}>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]"><UsageFlow data={data.flow} /></div>
        </div>
        <p className="mt-2 text-xs text-muted">Hover a band for its run count. Follow the Marketing Copy Generator: most of its band flows into “Discarded”.</p>
      </Card>

      <Card className="mt-4" title="Hours returned per month vs. repetitive manual work"
        subtitle="Each bar is the department's estimated monthly manual workload. The blue part is what AI already handles."
        action={<div className="flex gap-3"><LegendItem color="var(--series-1)" label="Returned by AI" /><LegendItem color="var(--surface-2)" label="Still manual" /></div>}>
        <div className="h-80">
          <ResponsiveContainer>
            <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }} barCategoryGap={8}>
              <CartesianGrid stroke="var(--grid)" horizontal={false} />
              <XAxis type="number" {...axisProps} tickFormatter={v => `${num(v)} h`} />
              <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={96} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = (payload[0].payload as (typeof chart)[number]).d
                return <TipBox title={d.name} rows={[
                  { color: 'var(--series-1)', label: 'Returned / mo', value: `${num(d.hours_saved_per_month)} h` },
                  { label: 'Manual work / mo', value: `${num(d.manual_hours_per_month)} h` },
                  { label: 'Coverage', value: pct(d.coverage, 1) },
                ]} />
              }} />
              <Bar isAnimationActive={false} dataKey="returned" stackId="a" fill="var(--series-1)" />
              <Bar isAnimationActive={false} dataKey="remaining" stackId="a" fill="var(--surface-2)" stroke="var(--line)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3">
          <Explain>
            <div><b className="text-ink">Manual work / month</b> is an estimate each department head supplies of repetitive, automatable work. It's an assumption, not measured.</div>
            <div>Fixed and build costs are split by each department's share of a tool's runs, so department totals add up exactly to the company total.</div>
          </Explain>
        </div>
      </Card>

      <Card className="mt-4" title="Impact by department" subtitle="Sorted by value created">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse">
            <thead><tr><Th>Department</Th><Th className="text-right">Adoption</Th><Th className="text-right">Hours back</Th><Th className="text-right">Value</Th><Th className="text-right">Cost</Th><Th className="text-right">ROI</Th><Th className="text-right">Coverage</Th><Th>Top tools used</Th></tr></thead>
            <tbody>
              {depts.map(d => (
                <tr key={d.id} className="align-top">
                  <Td><div className="font-medium">{d.name}</div><div className="text-xs text-muted">{d.headcount} people · {d.tools_owned} tool{d.tools_owned === 1 ? '' : 's'} owned</div></Td>
                  <Td className="text-right">{pct(d.adoption)}<div className="text-xs text-muted">{d.active_users} people</div></Td>
                  <Td className="text-right">{num(d.hours_saved)}<div className="text-xs text-muted">{num(d.hours_per_active_user_per_month, 1)} h/user/mo</div></Td>
                  <Td className="text-right">{usd(d.value)}</Td>
                  <Td className="text-right">{usd(d.total_cost)}</Td>
                  <Td className="text-right">{roiX(d.roi)}</Td>
                  <Td className="text-right">{pct(d.coverage, 1)}</Td>
                  <Td>
                    {d.tools_used.length === 0 ? <span className="text-muted">None</span> : d.tools_used.slice(0, 3).map(u => (
                      <div key={u.id} className="text-xs"><Link to={`/tools/${u.id}`} className="hover:underline">{u.name}</Link> <span className="text-muted">{usd(u.value, { compact: true })}{!u.owned && ' · shared'}</span></div>
                    ))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
