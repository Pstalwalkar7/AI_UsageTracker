# AI Impact Tracker — Proof-of-Concept Spec

> Build brief for Claude Code. Goal: a working, deployable demo in ~3 hours that shows how an internal AI Operations team proves the ROI of every AI tool it ships.

## 1. The problem

Companies give employees AI tools and then track **adoption** (logins, seats, prompt counts). Adoption is not impact. Leadership can't answer:

- Which internal AI tools actually save time or money?
- Which ones are used a lot but deliver little ("usage without impact is waste")?
- Where is token/API spend going, and is it paying for itself?
- What should the AI Ops team build, fix, or kill next quarter?

The AI Impact Tracker answers these with one number per tool, **net ROI**, backed by run-level data.

## 2. Users and what each needs

| User | Core question | What they look at |
|---|---|---|
| **CEO / C-suite** | "Is our AI investment paying off?" | One-screen executive summary: total $ saved, total AI cost, net ROI, trend |
| **Director of AI Operations** | "Which tools do I scale, fix, or kill?" | Tool portfolio ranked by ROI, with the Scale / Fix / Kill flag |
| **AI Ops engineer (tool owner)** | "Is my tool working, and where does it fail?" | Tool detail page: runs, success rate, time saved, cost per run, failure reasons |
| **Department head** (Sales, Support, HR, Finance) | "What is AI doing for my team?" | Department view: hours returned to the team, top tools |
| **Finance** | "What do we spend on AI, and what do we get for it?" | Cost breakdown (API/token, licenses, build hours) against value created |

## 3. Business use cases (the heart of the demo)

### UC1 — Prove ROI per tool
Each tool has a **manual baseline**: how long the task took a human before AI, at a loaded hourly rate. Every AI run logs actual time and whether the output was accepted.

- Value per run = (baseline minutes − actual human minutes with AI) / 60 × loaded hourly rate, counted only for successful/accepted runs
- Cost per run = model/API cost + amortized build and maintenance cost
- **Net ROI = (total value − total cost) / total cost**

Example: the Support Ticket Summarizer saves 6 min/ticket × 4,000 tickets/month × $45/hr = **$18,000/month** in value against $600/month in cost, so ROI is ~29×.

### UC2 — Catch "usage without impact"
Flag tools with high usage but low impact: many runs, but a low acceptance rate or near-zero time saved. These waste tokens and attention.

- Rule: usage in the top 50% **and** ROI < 1× **or** acceptance rate < 50% → **FIX** flag
- Demo example: the "Marketing Copy Generator" runs 3,000 times/month, but only 22% of drafts are used, so its value is roughly break-even. Flag it and recommend a prompt rework.

### UC3 — Scale / Fix / Kill portfolio decisions
Every tool gets an automatic recommendation that the Director can override:

| Flag | Rule (PoC) | Action |
|---|---|---|
| **SCALE** | ROI ≥ 3× and acceptance ≥ 70% | Roll out to more teams |
| **FIX** | ROI 1–3×, or acceptance < 50%, or high-usage/low-impact | Improve prompts/workflow |
| **KILL** | ROI < 1× for 2+ consecutive months | Sunset; stop the spend |
| **WATCH** | < 30 days of data | Not enough evidence yet |

This turns the dashboard into a **decision tool**, not just a report.

### UC4 — Executive summary for the C-suite
One screen with: total hours returned, total $ value, total AI spend, net ROI, month-over-month trend, the top 3 wins, and the top flagged problem. It should be readable in 30 seconds and ready to paste into a leadership update.

### UC5 — AI spend control
Break spend down by tool and by model. Show cost per successful outcome, not just cost per call, because a cheap tool that fails often is expensive per success. Highlight tools whose cost is growing faster than their value.

### UC6 — Department impact view
Roll value up by department (Sales, Support, HR, Finance, Marketing, Engineering). This answers "What has AI done for my team this quarter?" and shows where to build next. Departments with heavy manual work and few tools are the **opportunity gap**.

### UC7 — Prioritize the build backlog (opportunity scoring)
The AI Ops team keeps a list of proposed tools. Score each idea before building:

- Estimated value = task frequency/month × minutes saved per task × hourly rate × expected adoption %
- Estimated cost = build hours × engineer rate + projected monthly API cost
- **Priority score = estimated annual value / estimated cost**

Rank the backlog by this score so the team builds the highest-ROI idea next. This shows the business-first thinking an AI Ops team needs.

### UC8 — Tool health and failure analysis
For each tool: success rate, top failure reasons (bad input, hallucination, timeout, user rejected), and a trend line. This lets the tool owner find what to fix first.

## 4. Data model (keep it simple — SQLite)

```
departments(id, name)

tools(
  id, name, description, owner, department_id,
  launch_date,
  baseline_minutes_per_task,   -- manual time before AI
  loaded_hourly_rate,          -- $/hr of the people doing the task
  build_cost,                  -- one-time, amortized over 12 months
  monthly_fixed_cost,          -- licenses, hosting
  status_override              -- nullable: SCALE/FIX/KILL/WATCH
)

runs(
  id, tool_id, timestamp, user_department_id,
  human_minutes_with_ai,       -- time a person still spent
  api_cost_usd,
  model_name,
  outcome,                     -- accepted | edited | rejected | failed
  failure_reason               -- nullable
)

ideas(
  id, name, department_id,
  tasks_per_month, minutes_saved_per_task, hourly_rate,
  expected_adoption_pct, build_hours, est_monthly_api_cost
)
```

Count value only for `accepted` runs (full value) and `edited` runs (50% value). `rejected` and `failed` runs count cost only.

## 5. Seed data (realistic, 6 months)

Generate about 6 months of runs for 6 tools so every flag appears:

| Tool | Dept | Baseline min | Monthly runs | Acceptance | Expected flag |
|---|---|---|---|---|---|
| Support Ticket Summarizer | Support | 8 | ~4,000 | 85% | SCALE |
| Sales Call Notes → CRM | Sales | 15 | ~1,500 | 78% | SCALE |
| PTO / HR Policy Bot | HR | 5 | ~800 | 72% | FIX (low $ value) |
| Marketing Copy Generator | Marketing | 20 | ~3,000 | 22% | FIX (usage w/o impact) |
| Invoice Data Extractor (OCR) | Finance | 10 | ~600 | 90% | SCALE |
| Contract Clause Checker | Legal | 30 | ~40 | 35% | KILL |

Add 4–5 backlog ideas with different priority scores. Add slight month-over-month growth and noise so the charts look real. Include a seed script that can be re-run.

## 6. Screens

1. **Executive Summary** (landing): KPI tiles (hours returned, $ value, AI spend, net ROI), monthly value-vs-cost line chart, top 3 wins, top flagged issue.
2. **Tool Portfolio**: a sortable table of tools with runs, acceptance %, value, cost, ROI, and a colored flag badge. Add a quadrant chart with usage on X and ROI on Y; the bottom-right quadrant is "usage without impact."
3. **Tool Detail**: per-tool trend, outcome breakdown, failure reasons, cost per successful run, and the baseline assumptions (editable).
4. **Departments**: value by department and the opportunity gap.
5. **Backlog Prioritizer**: idea list ranked by priority score, with a form to add an idea and see its score instantly.
6. **Log a Run** (API + simple form): shows how any internal tool would report into the tracker.

## 7. API (FastAPI)

```
POST /api/runs                 -- tools report each run (the integration point)
GET  /api/summary?range=6m     -- executive KPIs + trend
GET  /api/tools                -- portfolio with computed ROI + flag
GET  /api/tools/{id}           -- detail, outcomes, failures
GET  /api/departments          -- roll-up
GET  /api/ideas | POST /api/ideas  -- backlog with priority score
PATCH /api/tools/{id}          -- edit baseline assumptions / override flag
```

Put all ROI math in one module (`metrics.py`) with unit tests, because the numbers are the product.

## 8. Tech stack

- **Backend:** Python, FastAPI, SQLite, SQLAlchemy or plain sqlite3
- **Frontend:** React + TypeScript (Vite), Recharts for charts, Tailwind for styling
- **Run:** Docker Compose (one command), with Gunicorn/Uvicorn behind Nginx optional
- **Deploy:** any free host that gives a shareable link (Render, Railway, Fly.io, or Vercel for the frontend plus a hosted backend)

## 9. Out of scope for the PoC

- Authentication and roles (hard-code a single admin user)
- Real integrations with Salesforce/Slack/LLM providers (`POST /api/runs` plus seed data stands in)
- Multi-tenant support, exports, email reports

Mention these as "next steps" in the demo instead of building them.

## 10. Acceptance criteria

- [ ] `docker compose up` (or two commands) runs the app with seeded data
- [ ] The Executive Summary loads in under 2 seconds and shows correct totals
- [ ] All four flags (SCALE/FIX/KILL/WATCH) appear on seeded tools
- [ ] The usage-vs-ROI quadrant clearly isolates the Marketing Copy Generator
- [ ] Editing a tool's baseline recalculates its ROI and flag live
- [ ] Adding a backlog idea shows its priority score immediately
- [ ] `POST /api/runs` with a sample payload updates the dashboard
- [ ] Unit tests cover the ROI, value, and flag rules
- [ ] A README has a one-paragraph pitch, a screenshot, and run instructions

## 11. 2-minute demo script (for the interview)

1. **Hook (15 s):** "Most companies measure AI adoption. This measures AI impact: every tool, every run, in dollars."
2. **Executive Summary (30 s):** "Across 6 tools, AI returned X hours and $Y this quarter at Z× ROI."
3. **Quadrant (30 s):** "The Marketing Copy Generator is heavily used but only 22% of its output ships. That's usage without impact, so it gets a FIX flag. The Contract Checker is losing money, so the recommendation is KILL."
4. **Backlog (30 s):** "Before we build anything, we score it. Here's the next highest-ROI idea."
5. **Close (15 s):** "Any internal tool reports in through one API call. Next steps would be Salesforce and LLM-provider integrations and role-based access."