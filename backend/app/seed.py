"""
Re-runnable seed: wipes the database and generates ~6 months of realistic runs.

    python -m app.seed            # from backend/

Each tool profile below is chosen so that every flag (SCALE / FIX / KILL / WATCH)
shows up for a business reason you can explain in one sentence. The random
generator is seeded, so the same day always produces the same data.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from . import db

SEED_DAYS = 182  # ~6 months

DEPARTMENTS = [
    # name, headcount, est. repetitive manual hours / month (assumption from dept heads)
    ("Support", 60, 3800),
    ("Sales", 45, 2800),
    ("Marketing", 20, 1200),
    ("HR", 12, 900),
    ("Finance", 15, 1400),
    ("Legal", 6, 500),
    ("Engineering", 80, 2000),
    ("Operations", 35, 4200),  # no AI tools yet: the opportunity gap
]


@dataclass
class Profile:
    name: str
    description: str
    owner: str
    dept: str
    days_since_launch: int
    baseline_minutes: float
    hourly_rate: float
    build_cost: float
    monthly_fixed_cost: float
    monthly_runs_start: float          # runs/month at the start of the seed window
    monthly_runs_end: float            # runs/month at the end (growth)
    # outcome mix: accepted, edited, rejected, failed (must sum to 1)
    mix: Tuple[float, float, float, float]
    # mean human minutes with AI by outcome
    human_minutes: Dict[str, float]
    # (model_name, mean API $/run, share of runs) — may change over time, see model_schedule
    models: List[Tuple[str, float, float]]
    user_depts: Dict[str, float]       # who uses it
    reject_reasons: Dict[str, float]
    fail_reasons: Dict[str, float]
    model_schedule: Optional[List[Tuple[float, List[Tuple[str, float, float]]]]] = None  # (from progress 0..1, models)
    story: str = ""
    # share of each user-department's headcount that uses the tool (default: 0.85 of the owning dept)
    reach: Optional[Dict[str, float]] = None
    ramp_days: int = 0                 # users start using it gradually over this many days after launch


ALL_DEPTS_BY_HEADCOUNT = {d[0]: float(d[1]) for d in DEPARTMENTS}

PROFILES: List[Profile] = [
    Profile(
        name="Support Ticket Summarizer",
        description="Summarizes long ticket threads and drafts the next reply for the agent.",
        owner="Priya N. (AI Ops)",
        dept="Support",
        days_since_launch=300,
        baseline_minutes=8, hourly_rate=45, build_cost=4800, monthly_fixed_cost=100,
        monthly_runs_start=3500, monthly_runs_end=4400,
        mix=(0.75, 0.10, 0.11, 0.04),
        human_minutes={"accepted": 2.0, "edited": 4.0, "rejected": 2.5, "failed": 1.0},
        models=[("claude-haiku-5-5", 0.03, 1.0)],
        user_depts={"Support": 1.0},
        reject_reasons={"user_rejected": 0.7, "hallucination": 0.3},
        fail_reasons={"timeout": 0.6, "bad_input": 0.4},
        story="High volume, cheap model, high acceptance: the clearest win.",
        reach={"Support": 0.92},
    ),
    Profile(
        name="Sales Call Notes → CRM",
        description="Turns call transcripts into structured CRM notes, next steps and deal fields.",
        owner="Marcus T. (AI Ops)",
        dept="Sales",
        days_since_launch=240,
        baseline_minutes=15, hourly_rate=60, build_cost=9600, monthly_fixed_cost=200,
        monthly_runs_start=1300, monthly_runs_end=1700,
        mix=(0.65, 0.13, 0.17, 0.05),
        human_minutes={"accepted": 3.0, "edited": 7.0, "rejected": 4.0, "failed": 1.0},
        models=[("claude-sonnet-5-5", 0.12, 1.0)],
        user_depts={"Sales": 1.0},
        reject_reasons={"user_rejected": 0.5, "hallucination": 0.5},
        fail_reasons={"bad_input": 0.7, "timeout": 0.3},
        story="Expensive people, big time savings: strong ROI despite a pricier model.",
        reach={"Sales": 0.85},
    ),
    Profile(
        name="PTO / HR Policy Bot",
        description="Answers employee questions about PTO, benefits and policy from the handbook.",
        owner="Dana K. (AI Ops)",
        dept="HR",
        days_since_launch=270,
        baseline_minutes=5, hourly_rate=40, build_cost=3600, monthly_fixed_cost=150,
        monthly_runs_start=750, monthly_runs_end=850,
        mix=(0.60, 0.12, 0.22, 0.06),
        human_minutes={"accepted": 1.0, "edited": 2.5, "rejected": 1.5, "failed": 0.5},
        models=[("claude-haiku-5-5", 0.02, 1.0)],
        user_depts=ALL_DEPTS_BY_HEADCOUNT,
        reject_reasons={"user_rejected": 0.6, "hallucination": 0.4},
        fail_reasons={"bad_input": 0.8, "timeout": 0.2},
        story="Works well, but each answer only saves a few minutes: low $ value per run.",
        reach={d[0]: 0.6 for d in DEPARTMENTS}, ramp_days=200,
    ),
    Profile(
        name="Marketing Copy Generator",
        description="Drafts campaign emails, landing-page copy and social posts on brand.",
        owner="Jordan L. (AI Ops)",
        dept="Marketing",
        days_since_launch=330,
        baseline_minutes=20, hourly_rate=52, build_cost=14400, monthly_fixed_cost=400,
        monthly_runs_start=2800, monthly_runs_end=3200,
        mix=(0.09, 0.13, 0.66, 0.12),
        human_minutes={"accepted": 5.0, "edited": 11.0, "rejected": 6.0, "failed": 1.0},
        models=[("claude-sonnet-5-5", 0.55, 1.0)],
        model_schedule=[
            (0.0, [("claude-sonnet-5-5", 0.55, 1.0)]),
            # Team upgraded to the largest model hoping quality would improve. It didn't.
            (0.5, [("claude-opus-5-5", 1.05, 1.0)]),
        ],
        user_depts={"Marketing": 0.8, "Sales": 0.2},
        reject_reasons={"user_rejected": 0.75, "hallucination": 0.25},
        fail_reasons={"timeout": 0.5, "bad_input": 0.5},
        story="Used constantly, but 78% of drafts are thrown away. A model upgrade doubled spend without moving acceptance.",
        reach={"Marketing": 0.95, "Sales": 0.25},
    ),
    Profile(
        name="Invoice Data Extractor (OCR)",
        description="Reads vendor invoices (PDF/scan) and fills the AP system fields.",
        owner="Sam R. (AI Ops)",
        dept="Finance",
        days_since_launch=210,
        baseline_minutes=10, hourly_rate=40, build_cost=3000, monthly_fixed_cost=50,
        monthly_runs_start=550, monthly_runs_end=650,
        mix=(0.82, 0.08, 0.06, 0.04),
        human_minutes={"accepted": 1.5, "edited": 4.0, "rejected": 2.0, "failed": 0.5},
        models=[("ocr + claude-haiku-5-5", 0.05, 1.0)],
        user_depts={"Finance": 1.0},
        reject_reasons={"user_rejected": 0.4, "hallucination": 0.6},
        fail_reasons={"bad_input": 0.85, "timeout": 0.15},
        story="Modest volume, cheap to run, very accurate: quietly excellent.",
        reach={"Finance": 0.55},
    ),
    Profile(
        name="Contract Clause Checker",
        description="Flags risky or non-standard clauses in inbound vendor contracts.",
        owner="Alex M. (AI Ops)",
        dept="Legal",
        days_since_launch=250,
        baseline_minutes=30, hourly_rate=150, build_cost=24000, monthly_fixed_cost=800,
        monthly_runs_start=45, monthly_runs_end=38,
        mix=(0.20, 0.15, 0.50, 0.15),
        human_minutes={"accepted": 10.0, "edited": 20.0, "rejected": 25.0, "failed": 2.0},
        models=[("claude-opus-5-5", 1.50, 1.0)],
        user_depts={"Legal": 0.7, "Sales": 0.3},
        reject_reasons={"hallucination": 0.6, "user_rejected": 0.4},
        fail_reasons={"bad_input": 0.6, "timeout": 0.4},
        story="Expensive to build and license, rarely used, and lawyers don't trust it.",
        reach={"Legal": 0.84, "Sales": 0.12},
    ),
    Profile(
        name="PR Description Writer",
        description="Drafts pull-request descriptions and test notes from the code diff.",
        owner="Chris W. (AI Ops)",
        dept="Engineering",
        days_since_launch=18,
        baseline_minutes=12, hourly_rate=95, build_cost=4000, monthly_fixed_cost=0,
        monthly_runs_start=450, monthly_runs_end=450,
        mix=(0.60, 0.25, 0.12, 0.03),
        human_minutes={"accepted": 2.0, "edited": 5.0, "rejected": 3.0, "failed": 0.5},
        models=[("claude-sonnet-5-5", 0.04, 1.0)],
        user_depts={"Engineering": 1.0},
        reject_reasons={"user_rejected": 0.8, "hallucination": 0.2},
        fail_reasons={"timeout": 0.5, "bad_input": 0.5},
        story="Launched 18 days ago. Early numbers look great, but it's too soon to call.",
        reach={"Engineering": 0.6}, ramp_days=14,
    ),
]

IDEAS = [
    # name, dept, tasks/mo, min saved/task, $/hr, adoption %, build hrs, $/mo API
    ("Order Exception Triage", "Operations", 2500, 6, 38, 70, 80, 150),
    ("Month-End Variance Explainer", "Finance", 150, 45, 75, 80, 120, 200),
    ("Refund Eligibility Checker", "Support", 1200, 4, 45, 60, 60, 60),
    ("Incident Postmortem Drafter", "Engineering", 20, 90, 95, 70, 60, 40),
    ("RFP First-Draft Writer", "Sales", 30, 240, 65, 50, 200, 300),
]


def _pick(rng: random.Random, weights: Dict[str, float]) -> str:
    keys = list(weights)
    return rng.choices(keys, weights=[weights[k] for k in keys])[0]


def _models_at(p: Profile, progress: float):
    if not p.model_schedule:
        return p.models
    current = p.model_schedule[0][1]
    for start, models in p.model_schedule:
        if progress >= start:
            current = models
    return current


HEADCOUNT = {d[0]: d[1] for d in DEPARTMENTS}


def user_id(dept_id: int, n: int) -> int:
    """Anonymous employee id: department id × 1000 + seat number."""
    return dept_id * 1000 + n


def build_user_pools(p: Profile, dept_ids: Dict[str, int], launch: date, rng: random.Random):
    """For each department: the employees who use this tool, how heavily (Zipf-like: a few power users),
    and the day each one starts using it (gradual roll-out over ramp_days)."""
    reach = p.reach or {p.dept: 0.85}
    pools = {}
    for dept in p.user_depts:
        share = reach.get(dept, 0.1)
        n = max(1, round(HEADCOUNT[dept] * share))
        seats = rng.sample(range(1, HEADCOUNT[dept] + 1), n)
        pools[dept] = [
            (user_id(dept_ids[dept], s), 1.0 / (rank + 1) ** 0.8,
             launch + timedelta(days=int(rng.random() * p.ramp_days)))
            for rank, s in enumerate(seats)
        ]
    return pools


def generate_runs(p: Profile, tool_id: int, dept_ids: Dict[str, int], as_of: date, rng: random.Random):
    launch = as_of - timedelta(days=p.days_since_launch)
    pools = build_user_pools(p, dept_ids, launch, rng)
    window_start = as_of - timedelta(days=SEED_DAYS - 1)
    start = max(launch, window_start)
    outcomes = ("accepted", "edited", "rejected", "failed")
    n_days = (as_of - start).days + 1
    rows = []
    for i in range(n_days):
        day = start + timedelta(days=i)
        progress = (day - window_start).days / (SEED_DAYS - 1)
        monthly = p.monthly_runs_start + (p.monthly_runs_end - p.monthly_runs_start) * progress
        weekday = day.weekday() < 5
        # 5 weekdays at 1.0, 2 weekend days at 0.25 -> normalize to the monthly rate
        per_day = monthly * 12 / 365 * (1.0 if weekday else 0.25) / (5.5 / 7)
        n = max(0, int(round(rng.gauss(per_day, per_day ** 0.5 + 0.3))))
        models = _models_at(p, progress)
        for _ in range(n):
            outcome = rng.choices(outcomes, weights=p.mix)[0]
            mean_h = p.human_minutes[outcome]
            human = max(0.2, rng.gauss(mean_h, mean_h * 0.25))
            model, mean_cost, _ = rng.choices(models, weights=[m[2] for m in models])[0]
            cost = max(0.001, rng.gauss(mean_cost, mean_cost * 0.2))
            reason = None
            if outcome == "rejected":
                reason = _pick(rng, p.reject_reasons)
            elif outcome == "failed":
                reason = _pick(rng, p.fail_reasons)
            ts = datetime(day.year, day.month, day.day, rng.randint(8, 18), rng.randint(0, 59), rng.randint(0, 59))
            dept = _pick(rng, p.user_depts)
            live = [u for u in pools[dept] if u[2] <= day] or pools[dept][:1]
            uid = rng.choices(live, weights=[u[1] for u in live])[0][0]
            rows.append((tool_id, ts.isoformat(), dept_ids[dept], uid,
                         round(human, 2), round(cost, 4), model, outcome, reason))
    return rows


def seed(conn=None, as_of: date = None, rng_seed: int = 42) -> dict:
    own = conn is None
    conn = conn or db.connect()
    as_of = as_of or date.today()
    rng = random.Random(rng_seed)

    conn.executescript("DROP TABLE IF EXISTS runs; DROP TABLE IF EXISTS ideas; DROP TABLE IF EXISTS tools; DROP TABLE IF EXISTS departments;")
    db.init_db(conn)

    dept_ids = {}
    for name, headcount, manual in DEPARTMENTS:
        cur = conn.execute("INSERT INTO departments(name, headcount, manual_hours_per_month) VALUES (?,?,?)",
                           (name, headcount, manual))
        dept_ids[name] = cur.lastrowid

    total_runs = 0
    for p in PROFILES:
        launch = as_of - timedelta(days=p.days_since_launch)
        cur = conn.execute(
            """INSERT INTO tools(name, description, owner, department_id, launch_date,
                   baseline_minutes_per_task, loaded_hourly_rate, build_cost, monthly_fixed_cost)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (p.name, p.description, p.owner, dept_ids[p.dept], launch.isoformat(),
             p.baseline_minutes, p.hourly_rate, p.build_cost, p.monthly_fixed_cost),
        )
        rows = generate_runs(p, cur.lastrowid, dept_ids, as_of, rng)
        conn.executemany(
            """INSERT INTO runs(tool_id, timestamp, user_department_id, user_id, human_minutes_with_ai,
                   api_cost_usd, model_name, outcome, failure_reason) VALUES (?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        total_runs += len(rows)

    for name, dept, tasks, mins, rate, adopt, hours, api in IDEAS:
        conn.execute(
            """INSERT INTO ideas(name, department_id, tasks_per_month, minutes_saved_per_task, hourly_rate,
                   expected_adoption_pct, build_hours, est_monthly_api_cost) VALUES (?,?,?,?,?,?,?,?)""",
            (name, dept_ids[dept], tasks, mins, rate, adopt, hours, api),
        )
    conn.commit()
    result = {"as_of": as_of.isoformat(), "tools": len(PROFILES), "runs": total_runs, "ideas": len(IDEAS)}
    if own:
        conn.close()
    return result


if __name__ == "__main__":
    print(seed())
