import { useEffect, useState } from 'react'
import { api, useApi, type Idea, type IdeaInput, type IdeaScore } from '../api'
import { useApp } from '../App'
import { Card, ErrorBox, Explain, Formula, Loading, PageHeader, Td, Th } from '../components/ui'
import { num, usd } from '../format'

const EMPTY = {
  name: '', department_id: '', tasks_per_month: '500', minutes_saved_per_task: '10', hourly_rate: '50',
  expected_adoption_pct: '60', build_hours: '80', est_monthly_api_cost: '100',
}
type Form = typeof EMPTY

const toInput = (f: Form): IdeaInput => ({
  name: f.name, department_id: Number(f.department_id),
  tasks_per_month: Number(f.tasks_per_month), minutes_saved_per_task: Number(f.minutes_saved_per_task),
  hourly_rate: Number(f.hourly_rate), expected_adoption_pct: Number(f.expected_adoption_pct),
  build_hours: Number(f.build_hours), est_monthly_api_cost: Number(f.est_monthly_api_cost),
})

export default function Backlog() {
  const { meta, version, bump } = useApp()
  const { data, error, setData } = useApi<Idea[]>('/api/ideas', version)
  const [form, setForm] = useState<Form>(EMPTY)
  const [preview, setPreview] = useState<IdeaScore | null>(null)
  const [justAdded, setJustAdded] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const rate = meta?.rules.engineer_hourly_rate ?? 100

  // Live score: recompute on the server (single source of truth) as the form changes.
  useEffect(() => {
    const input = toInput({ ...form, name: form.name || 'preview', department_id: form.department_id || String(meta?.departments[0]?.id ?? 1) })
    const valid = [input.tasks_per_month, input.minutes_saved_per_task, input.hourly_rate, input.expected_adoption_pct].every(v => v > 0)
      && input.expected_adoption_pct <= 100 && input.build_hours >= 0 && input.est_monthly_api_cost >= 0
    if (!valid) { setPreview(null); return }
    const h = setTimeout(() => {
      api<IdeaScore>('/api/ideas/score', { method: 'POST', body: JSON.stringify(input) }).then(setPreview).catch(() => setPreview(null))
    }, 150)
    return () => clearTimeout(h)
  }, [form, meta])

  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const maxScore = Math.max(...data.map(i => i.priority_score ?? 0), preview?.priority_score ?? 0, 1)
  const previewRank = preview?.priority_score != null ? data.filter(i => (i.priority_score ?? 0) > preview.priority_score!).length + 1 : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    try {
      const r = await api<{ created: Idea; ideas: Idea[] }>('/api/ideas', { method: 'POST', body: JSON.stringify(toInput(form)) })
      setData(r.ideas)
      setJustAdded(r.created.id)
      setForm(EMPTY)
      bump()
    } catch (ex) { setErr((ex as Error).message) }
  }
  const remove = async (id: number) => {
    await api(`/api/ideas/${id}`, { method: 'DELETE' })
    setData(data.filter(i => i.id !== id))
  }

  const field = (key: keyof Form, label: string, opts: { prefix?: string; suffix?: string; hint?: string } = {}) => (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1 flex items-center rounded-lg border border-line bg-page px-3 focus-within:border-accent">
        {opts.prefix && <span className="text-sm text-muted">{opts.prefix}</span>}
        <input type="number" step="any" min="0" required value={form[key]} onChange={e => setForm(s => ({ ...s, [key]: e.target.value }))}
          className="w-full bg-transparent px-1 py-2 text-sm outline-none tnum" />
        {opts.suffix && <span className="whitespace-nowrap text-sm text-muted">{opts.suffix}</span>}
      </div>
      {opts.hint && <span className="mt-1 block text-xs text-muted">{opts.hint}</span>}
    </label>
  )

  return (
    <>
      <PageHeader title="Backlog Prioritizer" persona="the AI Ops team" question="What should we build next?" />

      <Card title="Proposed tools, ranked by priority score" subtitle="Score = estimated annual value ÷ estimated first-year cost. Build the top one next.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead><tr><Th>#</Th><Th>Idea</Th><Th className="text-right">Hours / mo</Th><Th className="text-right">Annual value</Th><Th className="text-right">First-year cost</Th><Th className="text-right">Payback</Th><Th className="w-56">Priority score</Th><Th /></tr></thead>
            <tbody>
              {data.map(i => (
                <tr key={i.id} className={`align-top ${i.id === justAdded ? 'bg-accent-wash' : ''}`}>
                  <Td className="font-semibold">{i.rank}</Td>
                  <Td>
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-muted">{i.department} · {num(i.tasks_per_month)} tasks/mo × {num(i.minutes_saved_per_task)} min × {num(i.expected_adoption_pct)}% adoption</div>
                    <Explain label="Show the math">
                      <Formula label="Annual value" expr={`${num(i.tasks_per_month)} × ${num(i.minutes_saved_per_task)} min ÷ 60 × $${num(i.hourly_rate)}/hr × ${num(i.expected_adoption_pct)}% × 12`} result={usd(i.est_annual_value)} />
                      <Formula label="First-year cost" expr={`${num(i.build_hours)} build h × $${rate}/hr + 12 × $${num(i.est_monthly_api_cost)} API`} result={usd(i.est_first_year_cost)} />
                      <Formula label="Score" expr={`${usd(i.est_annual_value)} ÷ ${usd(i.est_first_year_cost)}`} result={i.priority_score?.toFixed(2)} />
                    </Explain>
                  </Td>
                  <Td className="text-right">{num(i.est_monthly_hours_saved)}</Td>
                  <Td className="text-right">{usd(i.est_annual_value)}</Td>
                  <Td className="text-right">{usd(i.est_first_year_cost)}</Td>
                  <Td className="text-right">{i.payback_months == null ? 'never' : `${i.payback_months.toFixed(1)} mo`}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-surface-2">
                        <div className="h-2 rounded-full" style={{ width: `${((i.priority_score ?? 0) / maxScore) * 100}%`, background: 'var(--series-1)' }} />
                      </div>
                      <span className="w-12 text-right font-semibold tnum">{i.priority_score?.toFixed(1)}×</span>
                    </div>
                  </Td>
                  <Td><button onClick={() => remove(i.id)} className="text-xs text-muted hover:text-bad-text" aria-label={`Remove ${i.name}`}>Remove</button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4" title="Score a new idea" subtitle="The score updates as you type, before you build anything">
        <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">Idea name</span>
              <input required value={form.name} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} placeholder="e.g. Vendor onboarding form filler"
                className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-accent" />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">Department</span>
              <select required value={form.department_id} onChange={e => setForm(s => ({ ...s, department_id: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-accent">
                <option value="">Choose…</option>
                {meta?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            {field('tasks_per_month', 'Task frequency', { suffix: '/ month' })}
            {field('minutes_saved_per_task', 'Minutes saved per task', { suffix: 'min' })}
            {field('hourly_rate', 'Hourly rate of those people', { prefix: '$', suffix: '/ hr' })}
            {field('expected_adoption_pct', 'Expected adoption', { suffix: '%', hint: 'Share of tasks that will actually go through the tool' })}
            {field('build_hours', 'Build effort', { suffix: 'hours', hint: `Costed at $${rate}/hr engineer rate` })}
            {field('est_monthly_api_cost', 'Projected API cost', { prefix: '$', suffix: '/ month' })}
          </div>

          <div className="rounded-xl bg-surface-2 p-5">
            <div className="text-sm font-medium text-ink-2">Priority score</div>
            <div className="mt-1 text-[40px] font-semibold leading-none tracking-tight">{preview?.priority_score != null ? `${preview.priority_score.toFixed(1)}×` : '—'}</div>
            {previewRank && <div className="mt-1 text-sm text-ink-2">Would rank <b className="text-ink">#{previewRank}</b> of {data.length + 1}</div>}
            {preview && (
              <div className="mt-4 space-y-1.5 text-sm tnum">
                <Row k="Hours saved / month" v={num(preview.est_monthly_hours_saved)} />
                <Row k="Value / month" v={usd(preview.est_monthly_value)} />
                <Row k="Value / year" v={usd(preview.est_annual_value)} />
                <Row k="Build cost" v={usd(preview.est_build_cost)} />
                <Row k="First-year cost" v={usd(preview.est_first_year_cost)} />
                <Row k="Payback" v={preview.payback_months == null ? 'never' : `${preview.payback_months.toFixed(1)} months`} />
              </div>
            )}
            <button className="mt-5 w-full rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: 'var(--series-1)' }}>Add to backlog</button>
            {err && <p className="mt-2 text-sm text-bad-text">{err}</p>}
          </div>
        </form>
      </Card>
    </>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4"><span className="text-ink-2">{k}</span><span className="font-medium">{v}</span></div>
}
