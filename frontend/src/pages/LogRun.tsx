import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, useApi, type Outcome, type Portfolio, type RunPrice, type Tool } from '../api'
import { useApp } from '../App'
import { Card, PageHeader } from '../components/ui'
import { num, reasonLabel, roiX, usd } from '../format'

const OUTCOMES: { key: Outcome; title: string; meaning: string; credit: string }[] = [
  { key: 'accepted', title: 'Used as-is', meaning: 'The person used the output without changes', credit: '100% credit' },
  { key: 'edited', title: 'Used after edits', meaning: 'Useful, but the person had to fix it up', credit: '50% credit' },
  { key: 'rejected', title: 'Thrown away', meaning: 'The person looked at it and did the task by hand', credit: 'No credit' },
  { key: 'failed', title: 'Errored', meaning: 'Timeout, bad input or crash: no output at all', credit: 'No credit' },
]

const SCENARIOS: { label: string; outcome: Outcome; share: number; hint: string }[] = [
  { label: 'A great run', outcome: 'accepted', share: 0.25, hint: 'Used as-is, person spent a quarter of the usual time' },
  { label: 'Needed edits', outcome: 'edited', share: 0.5, hint: 'Used after fixing, half the usual time' },
  { label: 'Thrown away', outcome: 'rejected', share: 0.4, hint: 'Reviewed, then done by hand' },
  { label: 'AI made it slower', outcome: 'accepted', share: 1.25, hint: 'Used, but took longer than doing it manually' },
  { label: 'Errored', outcome: 'failed', share: 0.05, hint: 'Call failed; the person barely touched it' },
]

const round05 = (n: number) => Math.round(n * 2) / 2

interface Form { tool_id: number; outcome: Outcome; human: number; api_cost: string; model: string; dept: string; reason: string }
interface Sent { price: RunPrice & { id: number; timestamp: string }; before: Tool; after: Tool }

export default function LogRun() {
  const { meta, range, version, bump } = useApp()
  const { data: portfolio } = useApi<Portfolio>(`/api/tools?range=${range}`, version)
  const tools = useMemo(() => [...(portfolio?.tools ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [portfolio])
  const [form, setForm] = useState<Form | null>(null)
  const [price, setPrice] = useState<RunPrice | null>(null)
  const [sent, setSent] = useState<Sent | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const tool = tools.find(t => t.id === form?.tool_id)
  const baseline = tool?.assumptions.baseline_minutes_per_task ?? 10
  const typicalCost = (t: Tool) => (t.metrics.runs ? t.metrics.api_cost / t.metrics.runs : 0.05)

  const pickTool = (t: Tool, outcome: Outcome = 'accepted', share = 0.25) => setForm(f => ({
    tool_id: t.id, outcome, human: round05(t.assumptions.baseline_minutes_per_task * share),
    api_cost: typicalCost(t).toFixed(t.metrics.api_cost / Math.max(1, t.metrics.runs) < 0.1 ? 3 : 2),
    model: f?.model || meta?.models.find(m => m.includes('haiku')) || meta?.models[0] || 'claude-haiku-5-5',
    dept: '', reason: '',
  }))

  // Default to the Support Ticket Summarizer: the easiest run to explain.
  useEffect(() => {
    if (!form && tools.length) pickTool(tools.find(t => t.name.startsWith('Support')) ?? tools[0])
  }, [tools]) // eslint-disable-line react-hooks/exhaustive-deps

  const payload = useMemo(() => {
    if (!form) return null
    const p: Record<string, unknown> = {
      tool_id: form.tool_id, outcome: form.outcome, human_minutes_with_ai: form.human,
      api_cost_usd: Number(form.api_cost) || 0, model_name: form.model,
    }
    if (form.dept) p.user_department_id = Number(form.dept)
    if (form.reason && (form.outcome === 'rejected' || form.outcome === 'failed')) p.failure_reason = form.reason
    return p
  }, [form])

  // Live receipt: priced by the same server-side formula that prices stored runs.
  useEffect(() => {
    if (!payload) return
    const h = setTimeout(() => {
      api<RunPrice>('/api/runs/preview', { method: 'POST', body: JSON.stringify(payload) }).then(setPrice).catch(() => setPrice(null))
    }, 100)
    return () => clearTimeout(h)
  }, [payload])

  const send = async () => {
    if (!payload || !tool) return
    setBusy(true); setErr(null)
    try {
      const res = await api<RunPrice & { id: number; timestamp: string }>('/api/runs', { method: 'POST', body: JSON.stringify(payload) })
      const after = (await api<Portfolio>(`/api/tools?range=${range}`)).tools.find(t => t.id === tool.id)!
      setSent({ price: res, before: tool, after })
      bump()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const set = (patch: Partial<Form>) => { setForm(f => (f ? { ...f, ...patch } : f)); setSent(null) }
  const input = 'w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-accent'
  const sliderMax = Math.max(1, Math.ceil(baseline * 1.5))

  return (
    <>
      <PageHeader title="Log a Run" persona="AI Ops engineers and tool owners" question="How does a tool report in, and what is one run worth?" />

      {/* How it works: three steps */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Step n={1} title="A tool does a task">
          An agent clicks “Summarize” on a support ticket. The AI drafts a summary and the agent uses it, edits it, or throws it away.
        </Step>
        <Step n={2} title="It sends four facts">
          <span className="font-medium text-ink">What happened</span> to the output, <span className="font-medium text-ink">how long</span> the person still spent,
          the <span className="font-medium text-ink">API cost</span>, and the <span className="font-medium text-ink">model</span>. One API call, nothing else.
        </Step>
        <Step n={3} title="The tracker prices it">
          It already knows how long the task took <i>before</i> AI and what those people's time costs. The difference, in dollars, is the run's value.
        </Step>
      </div>

      {form && tool ? (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* LEFT: describe the run */}
          <Card title="Describe a run" subtitle="Pick a scenario or set each fact yourself">
            <div className="space-y-6">
              <Field label="Which tool?">
                <select className={input} value={form.tool_id} onChange={e => { const t = tools.find(x => x.id === Number(e.target.value)); if (t) { pickTool(t); setSent(null) } }}>
                  {tools.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
                  <b className="text-ink">The tracker already knows:</b> before AI this task took <b className="text-ink tnum">{num(baseline, baseline % 1 ? 1 : 0)} min</b>,
                  and the people doing it cost <b className="text-ink tnum">${num(tool.assumptions.loaded_hourly_rate)}/hr</b>.{' '}
                  <Link to={`/tools/${tool.id}`} className="font-medium text-accent hover:underline">Change on the tool page</Link>
                </div>
              </Field>

              <Field label="Quick scenarios">
                <div className="flex flex-wrap gap-2">
                  {SCENARIOS.map(s => {
                    const active = form.outcome === s.outcome && form.human === round05(baseline * s.share)
                    return (
                      <button key={s.label} type="button" title={s.hint}
                        onClick={() => set({ outcome: s.outcome, human: round05(baseline * s.share) })}
                        className={`rounded-full border px-3 py-1.5 text-sm ${active ? 'border-accent bg-accent-wash font-medium text-ink' : 'border-line text-ink-2 hover:bg-surface-2 hover:text-ink'}`}>
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label="① What did the person do with the output?">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
                  {OUTCOMES.map(o => (
                    <button key={o.key} type="button" role="radio" aria-checked={form.outcome === o.key} onClick={() => set({ outcome: o.key })}
                      className={`rounded-lg border p-3 text-left ${form.outcome === o.key ? 'border-accent bg-accent-wash' : 'border-line hover:bg-surface-2'}`}>
                      <div className="text-sm font-semibold text-ink">{o.title}</div>
                      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: o.key === 'accepted' || o.key === 'edited' ? 'var(--good-text)' : 'var(--muted)' }}>{o.credit}</div>
                      <div className="mt-0.5 text-xs leading-snug text-ink-2">{o.meaning}</div>
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="② How many minutes did the person still spend?" hint="Reading, checking and fixing the output. Tools measure this or estimate it from time in the UI.">
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={sliderMax} step={0.5} value={Math.min(form.human, sliderMax)}
                    onChange={e => set({ human: Number(e.target.value) })} className="flex-1 accent-[var(--series-1)]" aria-label="Minutes spent with AI" />
                  <div className="flex w-28 items-center rounded-lg border border-line bg-page px-2 focus-within:border-accent">
                    <input type="number" min={0} step={0.5} value={form.human} onChange={e => set({ human: Math.max(0, Number(e.target.value)) })}
                      className="w-full bg-transparent py-1.5 text-right text-sm outline-none tnum" aria-label="Minutes" />
                    <span className="pl-1 text-xs text-muted">min</span>
                  </div>
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted tnum"><span>0</span><span>baseline {num(baseline)} min</span><span>{sliderMax}</span></div>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="③ API cost of the call" hint={`This tool averages $${typicalCost(tool).toFixed(3)} a run`}>
                  <div className="flex items-center rounded-lg border border-line bg-page px-3 focus-within:border-accent">
                    <span className="text-sm text-muted">$</span>
                    <input type="number" min={0} step="any" value={form.api_cost} onChange={e => set({ api_cost: e.target.value })} className="w-full bg-transparent px-1 py-2 text-sm outline-none tnum" />
                  </div>
                </Field>
                <Field label="④ Model">
                  <input list="models" className={input} value={form.model} onChange={e => set({ model: e.target.value })} />
                  <datalist id="models">{meta?.models.map(m => <option key={m} value={m} />)}</datalist>
                </Field>
              </div>

              <details className="group text-sm">
                <summary className="cursor-pointer select-none text-xs font-medium text-accent">Optional fields</summary>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="User's department" hint="Defaults to the tool owner's department">
                    <select className={input} value={form.dept} onChange={e => set({ dept: e.target.value })}>
                      <option value="">Same as tool owner</option>
                      {meta?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </Field>
                  {(form.outcome === 'rejected' || form.outcome === 'failed') && (
                    <Field label="Failure reason">
                      <select className={input} value={form.reason} onChange={e => set({ reason: e.target.value })}>
                        <option value="">Default</option>
                        {meta?.rules.failure_reasons.map(r => <option key={r} value={r}>{reasonLabel(r)}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
              </details>
            </div>
          </Card>

          {/* RIGHT: the receipt */}
          <div className="min-w-0 space-y-4">
            <Card title="What this run is worth" subtitle="Updates as you change the run">
              {price ? <Receipt p={price} outcomeTitle={OUTCOMES.find(o => o.key === price.outcome)!.title} toolName={tool.name} /> : <div className="py-10 text-center text-sm text-muted">Pricing…</div>}
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <button onClick={send} disabled={busy || !price} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--series-1)' }}>
                  {busy ? 'Sending…' : 'Send this run to the tracker'}
                </button>
                <span className="text-xs text-muted">Same as the tool calling <code className="text-ink-2">POST /api/runs</code></span>
              </div>
              {err && <p className="mt-2 text-sm text-bad-text">{err}</p>}
            </Card>

            {sent && (
              <Card title="Recorded" subtitle={`Run #${sent.price.id} is now part of ${sent.after.name}'s numbers`}>
                <div className="grid grid-cols-3 gap-3 text-sm tnum">
                  <BeforeAfter label="Runs" before={num(sent.before.metrics.runs)} after={num(sent.after.metrics.runs)} />
                  <BeforeAfter label="Value" before={usd(sent.before.metrics.value)} after={usd(sent.after.metrics.value)} />
                  <BeforeAfter label="ROI" before={roiX(sent.before.metrics.roi, 2)} after={roiX(sent.after.metrics.roi, 2)} />
                </div>
                <p className="mt-3 text-xs text-muted">One run barely moves a tool with thousands of runs, which is the point: the tracker adds up every run, every day.</p>
                <Link to={`/tools/${sent.after.id}`} className="mt-2 inline-block text-sm font-medium text-accent hover:underline">Open the tool page →</Link>
              </Card>
            )}

            <Card title="For developers" subtitle="The exact call a tool makes">
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-ink"><code>{`curl -X POST ${location.origin}/api/runs \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(payload)}'`}</code></pre>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Optional: <code>user_id</code> (anonymous employee id, powers adoption metrics), <code>user_department_id</code>, <code>failure_reason</code>, <code>timestamp</code>.
                The response returns the same breakdown shown above.
              </p>
            </Card>
          </div>
        </div>
      ) : (
        <div className="py-24 text-center text-sm text-muted">Loading…</div>
      )}
    </>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="grid grid-cols-1 h-6 w-6 place-items-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--series-1)' }}>{n}</span>
        <span className="text-sm font-semibold text-ink">{title}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-ink">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

function BeforeAfter({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-ink-2">{before}</div>
      <div className="font-semibold text-ink">→ {after}</div>
    </div>
  )
}

/** The per-run formula as an itemized receipt, with the time saving drawn to scale. */
function Receipt({ p, outcomeTitle, toolName }: { p: RunPrice; outcomeTitle: string; toolName: string }) {
  const scale = Math.max(p.baseline_minutes, p.human_minutes, 0.1)
  const slower = p.raw_minutes_saved < 0
  const m = (v: number) => `${num(v, Number.isInteger(v) ? 0 : 1)} min`
  const creditPct = `${p.credit * 100}%`

  const sentence = p.credit === 0
    ? `The output was ${p.outcome === 'failed' ? 'never produced' : 'thrown away'}, so the run earns nothing. The ${usd(p.api_cost, { cents: true })} API call is pure cost. (The ${m(p.human_minutes)} the person spent is not charged to the tool, which keeps ROI conservative.)`
    : slower
      ? `The person spent ${m(p.human_minutes)} on a task that used to take ${m(p.baseline_minutes)}. AI made it ${m(-p.raw_minutes_saved)} slower, so this run has negative value.`
      : `Without AI this would have taken ${m(p.baseline_minutes)}. With AI it took ${m(p.human_minutes)}. The output was ${outcomeTitle.toLowerCase()}, so we count ${creditPct} of the ${m(p.raw_minutes_saved)} saved, at $${num(p.hourly_rate)}/hr.`

  return (
    <div>
      {/* time to scale */}
      <div className="space-y-2">
        <TimeBar label="Before AI" minutes={p.baseline_minutes} scale={scale} color="var(--muted)" m={m} />
        <TimeBar label="With AI" minutes={p.human_minutes} scale={scale} color="var(--series-1)" m={m} />
        <div className="grid grid-cols-[84px_1fr] gap-3 text-xs">
          <span />
          <span className={`font-medium ${slower ? 'text-bad-text' : 'text-good-text'}`}>
            {slower ? `${m(-p.raw_minutes_saved)} slower than doing it by hand` : `${m(p.raw_minutes_saved)} saved`}
          </span>
        </div>
      </div>

      {/* itemized */}
      <ol className="mt-5 divide-y divide-[var(--line)] rounded-lg border border-line text-sm tnum">
        <Line n={1} label="Time saved" math={`${m(p.baseline_minutes)} − ${m(p.human_minutes)}`} result={m(p.raw_minutes_saved)} />
        <Line n={2} label={`Credit for “${outcomeTitle}”`} math={`× ${creditPct}`} result={m(p.minutes_saved)} dim={p.credit === 0} />
        <Line n={3} label="In dollars" math={`${m(p.minutes_saved)} ÷ 60 × $${num(p.hourly_rate)}/hr`} result={usd(p.value, { cents: true })} />
        <Line n={4} label="Minus the API call" math="" result={`− ${usd(p.api_cost, { cents: true })}`} />
        <li className="flex items-center justify-between gap-4 rounded-b-lg bg-surface-2 px-4 py-3">
          <span className="font-semibold text-ink">Net value of this run</span>
          <span className={`text-2xl font-semibold ${p.net < 0 ? 'text-bad-text' : 'text-ink'}`}>{usd(p.net, { cents: true })}</span>
        </li>
      </ol>

      <p className="mt-4 text-sm leading-relaxed text-ink-2">{sentence}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Licenses and build cost aren't charged per run. They're added once per day at the tool level, which is why {toolName}'s ROI on its tool page is lower than one run's net value suggests.
      </p>
    </div>
  )
}

function TimeBar({ label, minutes, scale, color, m }: { label: string; minutes: number; scale: number; color: string; m: (v: number) => string }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-center gap-3">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      <div className="flex items-center gap-2">
        <div className="h-6 rounded-md transition-[width] duration-300" style={{ width: `${Math.max(1.5, (minutes / scale) * 85)}%`, background: color }} />
        <span className="whitespace-nowrap text-xs font-semibold text-ink tnum">{m(minutes)}</span>
      </div>
    </div>
  )
}

function Line({ n, label, math, result, dim }: { n: number; label: string; math: string; result: string; dim?: boolean }) {
  return (
    <li className="grid grid-cols-[24px_1fr_auto] items-baseline gap-x-3 px-4 py-2.5">
      <span className="text-xs font-semibold text-muted">{n}</span>
      <span>
        <span className="text-ink">{label}</span>
        {math && <span className="block text-xs text-muted">{math}</span>}
      </span>
      <span className={`font-semibold ${dim ? 'text-bad-text' : 'text-ink'}`}>{result}</span>
    </li>
  )
}
