/**
 * Visual forms for usage data:
 *  - Funnel:        runs → completed → used → used as-is (the "sales pipeline" of AI usage)
 *  - FunnelStrips:  the same funnel for many tools as overlapping (nested) bars, so shapes compare at a glance
 *  - Waterfall:     how each tool adds to (or subtracts from) the portfolio's net return
 *  - UsageFlow:     Sankey from department → tool → what happened to the output
 */
import { Fragment, useState } from 'react'
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Sankey, Text, Tooltip, XAxis, YAxis } from 'recharts'
import type { FunnelStage } from '../api'
import { num, pct, usd } from '../format'
import { axisProps, TipBox } from './charts'

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------
const DROP_LABEL: Record<string, string> = {
  completed: 'failed (error, timeout, bad input)',
  used: 'rejected by the user',
  as_is: 'needed edits before use',
}
const STAGE_OPACITY = [0.3, 0.5, 0.75, 1]

export function Funnel({ stages, valueAtEnd }: { stages: FunnelStage[]; valueAtEnd?: string }) {
  const top = stages[0]?.count || 1
  return (
    <div className="space-y-0.5" role="list" aria-label="Run funnel">
      {stages.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && (
            <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted tnum">
              <span aria-hidden>↓</span>
              <span><b className="font-semibold text-ink-2">{pct(s.conversion)}</b> continue · {num(s.drop)} {DROP_LABEL[s.key]}</span>
            </div>
          )}
          <div className="grid grid-cols-[150px_1fr_92px] items-center gap-3 sm:grid-cols-[180px_1fr_110px]" role="listitem">
            <div className="text-sm font-medium text-ink">{s.label}</div>
            <div className="flex justify-center">
              <div
                className="h-9 rounded-md"
                style={{ width: `${Math.max(2, (s.count / top) * 100)}%`, background: 'var(--series-1)', opacity: STAGE_OPACITY[i] ?? 1 }}
                title={`${s.label}: ${num(s.count)}`}
              />
            </div>
            <div className="text-right tnum">
              <div className="text-sm font-semibold text-ink">{num(s.count)}</div>
              <div className="text-xs text-muted">{pct(s.share_of_runs)} of runs</div>
            </div>
          </div>
        </Fragment>
      ))}
      {valueAtEnd && (
        <div className="pt-2 text-center text-sm text-ink-2">
          <span aria-hidden>↓</span> only these runs create value: <b className="text-ink">{valueAtEnd}</b>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Funnel strips: one row per tool, the four stages drawn on top of each other
// ---------------------------------------------------------------------------
export interface StripRow { id: number; name: string; stages: FunnelStage[]; note?: string }

export function FunnelStrips({ rows, onSelect }: { rows: StripRow[]; onSelect?: (id: number) => void }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {['Runs started', 'Completed', 'Output used', 'Used as-is'].map((l, i) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-3.5 rounded-sm" style={i === 0 ? { background: 'var(--surface-2)', outline: '1px solid var(--line)' } : { background: 'var(--series-1)', opacity: STAGE_OPACITY[i] }} />
            {l}
          </span>
        ))}
      </div>
      <div className="space-y-2.5">
        {rows.map(r => {
          const used = r.stages[2]?.share_of_runs ?? 0
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect?.(r.id)}
              className="grid w-full grid-cols-1 items-center gap-1 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2 sm:grid-cols-[220px_1fr_170px] sm:gap-4"
            >
              <span className="truncate text-sm font-medium text-ink">{r.name}</span>
              <span className="relative block h-5 rounded-md" style={{ background: 'var(--surface-2)' }}
                title={r.stages.map(s => `${s.label}: ${pct(s.share_of_runs)}`).join(' · ')}>
                {r.stages.slice(1).map((s, i) => (
                  <span key={s.key} className="absolute inset-y-0 left-0 rounded-md"
                    style={{ width: `${(s.share_of_runs ?? 0) * 100}%`, background: 'var(--series-1)', opacity: STAGE_OPACITY[i + 1] }} />
                ))}
              </span>
              <span className="text-sm tnum sm:text-right">
                <b className="text-ink">{pct(used)}</b> <span className="text-ink-2">used</span>
                {r.note && <span className="block text-xs text-muted">{r.note}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Waterfall: net value by tool, then the total
// ---------------------------------------------------------------------------
export interface WaterfallItem { id: number; name: string; value: number }

function WrappedTick(props: { x?: number; y?: number; payload?: { value: string } }) {
  return (
    <Text x={props.x} y={(props.y ?? 0) + 6} width={104} textAnchor="middle" verticalAnchor="start" fontSize={11} fill="var(--ink-2)">
      {props.payload?.value ?? ''}
    </Text>
  )
}

export function Waterfall({ items, totalLabel = 'Net return', onSelect }: { items: WaterfallItem[]; totalLabel?: string; onSelect?: (id: number) => void }) {
  let cum = 0
  const data = items.map(it => {
    const base = it.value >= 0 ? cum : cum + it.value
    cum += it.value
    return { ...it, base, delta: Math.abs(it.value), signed: it.value, kind: it.value >= 0 ? 'up' : 'down', end: cum }
  })
  data.push({ id: -1, name: totalLabel, value: cum, base: 0, delta: Math.abs(cum), signed: cum, kind: 'total', end: cum })
  const color = (k: string) => (k === 'up' ? 'var(--series-1)' : k === 'down' ? 'var(--negative)' : 'var(--ink-2)')
  return (
    <div className="h-80">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 24, right: 8, left: 0, bottom: 8 }} barCategoryGap="18%">
          <XAxis dataKey="name" {...axisProps} interval={0} height={56} tick={<WrappedTick />} />
          <YAxis {...axisProps} axisLine={false} tickFormatter={v => usd(v, { compact: true })} width={56} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as (typeof data)[number]
            return <TipBox title={p.name} rows={p.kind === 'total'
              ? [{ label: 'Sum of all tools', value: usd(p.value) }]
              : [{ color: color(p.kind), label: 'Net value (value − cost)', value: usd(p.signed) }, { label: 'Running total', value: usd(p.end) }]} />
          }} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="delta" stackId="w" isAnimationActive={false} radius={[4, 4, 4, 4]}
            onClick={(d: { id?: number }) => d.id && d.id > 0 && onSelect?.(d.id)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
            {data.map(d => <Cell key={d.id} fill={color(d.kind)} />)}
            <LabelList dataKey="signed" position="top" fontSize={11} fill="var(--ink-2)"
              formatter={(v: number) => `${v > 0 ? '+' : ''}${usd(v, { compact: true })}`} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Usage flow (Sankey): department → tool → outcome
// ---------------------------------------------------------------------------
export interface FlowData {
  nodes: { name: string; kind: 'department' | 'tool' | 'outcome' }[]
  links: { source: number; target: number; value: number; kind: string }[]
}
const OUTCOME_FILL: Record<string, string> = {
  'Used as-is': 'var(--series-1)', 'Used after edits': 'var(--series-3)', Discarded: 'var(--series-2)',
}

export function UsageFlow({ data, height = 560 }: { data: FlowData; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const nodeFill = (n: FlowData['nodes'][number]) => n.kind === 'outcome' ? OUTCOME_FILL[n.name] : n.kind === 'tool' ? 'var(--ink-2)' : 'var(--muted)'

  return (
    <div style={{ height }} onMouseLeave={() => setHover(null)}>
      <ResponsiveContainer>
        <Sankey
          data={data}
          nodeWidth={10}
          nodePadding={18}
          iterations={64}
          margin={{ top: 8, right: 170, bottom: 8, left: 150 }}
          link={(props: {
            sourceX: number; targetX: number; sourceY: number; targetY: number
            sourceControlX: number; targetControlX: number; linkWidth: number; index: number
            payload: { target: { name: string; kind: string }; source: { name: string }; value: number }
          }) => {
            const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index, payload } = props
            const toOutcome = payload.target.kind === 'outcome'
            const fill = toOutcome ? OUTCOME_FILL[payload.target.name] : 'var(--muted)'
            const dim = hover != null && hover !== index
            return (
              <path
                d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                fill="none" stroke={fill} strokeWidth={Math.max(1, linkWidth)}
                strokeOpacity={dim ? 0.08 : toOutcome ? 0.45 : 0.22}
                onMouseEnter={() => setHover(index)}
              >
                <title>{`${payload.source.name} → ${payload.target.name}: ${num(payload.value)} runs`}</title>
              </path>
            )
          }}
          node={(props: { x: number; y: number; width: number; height: number; payload: FlowData['nodes'][number] & { value: number } }) => {
            const { x, y, width, height: h, payload } = props
            const left = payload.kind === 'department'
            const right = payload.kind === 'outcome'
            return (
              <g>
                <rect x={x} y={y} width={width} height={Math.max(2, h)} rx={2} fill={nodeFill(payload)} />
                <text
                  x={left ? x - 8 : x + width + 8} y={y + h / 2} dy={4}
                  textAnchor={left ? 'end' : 'start'} fontSize={12}
                  fill="var(--ink)" fontWeight={right ? 600 : 400}
                  stroke="var(--surface)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke"
                >
                  {payload.name}
                  <tspan fill="var(--muted)" fontWeight={400}> {num(payload.value)}</tspan>
                </text>
              </g>
            )
          }}
        >
          <Tooltip content={() => null} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  )
}
