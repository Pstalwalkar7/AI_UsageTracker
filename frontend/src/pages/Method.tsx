import type { ReactNode } from 'react'
import { useApp } from '../App'
import { Card, FlagBadge, PageHeader } from '../components/ui'

function Eq({ children }: { children: ReactNode }) {
  return <div className="my-2 rounded-lg bg-surface-2 px-4 py-3 font-mono text-[13px] leading-relaxed text-ink">{children}</div>
}

export default function Method() {
  const { meta } = useApp()
  const r = meta?.rules
  return (
    <>
      <PageHeader title="How the math works" persona="anyone who asks “where does that number come from?”" question="Can I trust these numbers?" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="1. Value of a run">
          <p className="text-sm text-ink-2">Each tool has a <b className="text-ink">manual baseline</b>, the minutes the task took before AI, and the <b className="text-ink">loaded hourly rate</b> of the people doing it. Every run reports how many minutes a person still spent and what happened to the output.</p>
          <Eq>minutes saved = weight × (baseline − human minutes)<br />value = minutes saved ÷ 60 × hourly rate</Eq>
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(r?.value_weight ?? { accepted: 1, edited: 0.5, rejected: 0, failed: 0 }).map(([k, v]) => (
                <tr key={k} className="border-b border-line"><td className="py-1.5 capitalize">{k}</td><td className="py-1.5 text-right font-semibold tnum">{v * 100}% of value</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Example: Support Ticket Summarizer. 8 min baseline, 2 min with AI, $45/hr. An accepted run is worth 6 ÷ 60 × $45 = $4.50. If a person spent longer than the baseline, the run counts as negative value.</p>
        </Card>

        <Card title="2. Cost">
          <p className="text-sm text-ink-2">Every run costs money whether it worked or not. Fixed costs accrue each day the tool is live.</p>
          <Eq>cost = Σ API cost of all runs<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ monthly fixed × 12 ÷ 365 × days live<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ build cost ÷ 365 × days live (first year only)</Eq>
          <Eq>cost per success = cost ÷ (accepted + edited runs)</Eq>
          <p className="text-xs text-muted">Cost per success is the honest unit price. A $0.01 call that fails 9 times out of 10 costs $0.10 per useful answer.</p>
        </Card>

        <Card title="3. Net ROI">
          <Eq>net ROI = (value − cost) ÷ cost</Eq>
          <p className="text-sm text-ink-2">3.0× means $3 of net return on top of every $1 spent. 0× is break-even. −1× means the value created is zero.</p>
          <Eq>acceptance rate = (accepted + edited) ÷ all runs</Eq>
          <p className="text-xs text-muted">ROI is conservative: the time people spend reviewing rejected outputs is shown on each tool page but is not subtracted from value.</p>
        </Card>

        <Card title="4. Scale / Fix / Kill / Watch">
          <p className="mb-2 text-sm text-ink-2">Checked in order. The first rule that matches wins.</p>
          <ol className="space-y-2.5 text-sm">
            <li className="flex gap-3"><FlagBadge flag="WATCH" /><span>Live fewer than {r?.watch_min_days ?? 30} days. Not enough evidence yet.</span></li>
            <li className="flex gap-3"><FlagBadge flag="FIX" /><span><b>Usage without impact:</b> top {(r?.high_usage_top_fraction ?? 0.5) * 100}% by usage <i>and</i> (ROI &lt; {r?.kill_max_roi ?? 1}× <i>or</i> acceptance &lt; {(r?.low_acceptance ?? 0.5) * 100}%). Checked before KILL: heavy usage proves demand, so fix the quality instead of removing the tool.</span></li>
            <li className="flex gap-3"><FlagBadge flag="KILL" /><span>ROI &lt; {r?.kill_max_roi ?? 1}× in each of the last {r?.kill_consecutive_months ?? 2} complete calendar months.</span></li>
            <li className="flex gap-3"><FlagBadge flag="SCALE" /><span>ROI ≥ {r?.scale_min_roi ?? 3}× and acceptance ≥ {(r?.scale_min_acceptance ?? 0.7) * 100}%.</span></li>
            <li className="flex gap-3"><FlagBadge flag="FIX" /><span>Everything else: it pays for itself but misses the SCALE bar.</span></li>
          </ol>
          <p className="mt-3 text-xs text-muted">Flags use the date range selected at the top of the page, except KILL, which always looks at complete calendar months. The Director can override any flag; the automatic one stays visible.</p>
        </Card>

        <Card title="5. Backlog priority score">
          <Eq>est. annual value = tasks/mo × min saved ÷ 60 × $/hr × adoption % × 12<br />est. first-year cost = build hours × ${r?.engineer_hourly_rate ?? 100}/hr + 12 × API $/mo<br />priority score = annual value ÷ first-year cost</Eq>
          <p className="text-xs text-muted">A score of 5× means the idea should return five times its first-year cost in its first year. Payback = build cost ÷ (monthly value − monthly API cost).</p>
        </Card>

        <Card title="6. Adoption and the run funnel">
          <p className="text-sm text-ink-2">Adoption is the top of the funnel, impact is the bottom. The tracker shows both, so a tool can't look good just by being used.</p>
          <Eq>runs → completed (not failed) → output used (accepted + edited) → used as-is (accepted)</Eq>
          <Eq>adoption = distinct people with a run ÷ headcount<br />hours back per user = hours returned per month ÷ those people</Eq>
          <p className="text-xs text-muted">People are counted by an anonymous employee id the tool sends with each run. No names are stored.</p>
        </Card>

        <Card title="7. What's real and what's assumed">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            <li><b className="text-ink">Measured per run:</b> human minutes, API cost, model, outcome, failure reason, anonymous user id.</li>
            <li><b className="text-ink">Assumed per tool (editable):</b> baseline minutes, hourly rate, build cost, monthly fixed cost.</li>
            <li><b className="text-ink">Assumed per department:</b> monthly repetitive manual hours, used only for the opportunity gap.</li>
            <li><b className="text-ink">In this proof of concept:</b> all runs are generated by a seeded script (6 months, ~60k runs). In production they arrive through <code>POST /api/runs</code>.</li>
            <li><b className="text-ink">Next steps:</b> Salesforce/Slack and LLM-provider integrations that report runs automatically, SSO with role-based views, scheduled email reports.</li>
          </ul>
        </Card>
      </div>
    </>
  )
}
