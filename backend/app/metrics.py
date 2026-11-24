"""
All ROI math lives here. Pure functions, no database, no I/O.

The numbers are the product, so every rule the dashboard shows is defined
once in this file and covered by tests/test_metrics.py.

Vocabulary
----------
baseline minutes   How long the task took a person before AI.
human minutes      How long a person still spent on the task *with* AI.
minutes saved      baseline - human minutes, weighted by outcome:
                     accepted -> 100%, edited -> 50%, rejected/failed -> 0%.
value ($)          minutes saved / 60 x loaded hourly rate.
cost ($)           API cost of every run (successful or not)
                   + fixed monthly cost (licenses, hosting), accrued daily
                   + one-time build cost, amortized daily over 12 months.
net ROI            (value - cost) / cost.   3.0 means "$3 back on top of every $1 spent".
acceptance rate    (accepted + edited) / all runs.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Dict, Iterable, List, Optional, Sequence

# ---------------------------------------------------------------------------
# Business rules (single source of truth; the UI reads these via /api/meta)
# ---------------------------------------------------------------------------
OUTCOMES = ("accepted", "edited", "rejected", "failed")
VALUE_WEIGHT = {"accepted": 1.0, "edited": 0.5, "rejected": 0.0, "failed": 0.0}
SUCCESS_OUTCOMES = ("accepted", "edited")
FAILURE_REASONS = ("bad_input", "hallucination", "timeout", "user_rejected")

DAYS_PER_YEAR = 365
DAYS_PER_MONTH = DAYS_PER_YEAR / 12  # 30.4167, used to express rates "per month"
BUILD_AMORTIZATION_DAYS = 365        # build cost is spread over the first 12 months

SCALE_MIN_ROI = 3.0
SCALE_MIN_ACCEPTANCE = 0.70
KILL_MAX_ROI = 1.0                   # ROI below this...
KILL_CONSECUTIVE_MONTHS = 2          # ...for this many complete months -> KILL
LOW_ACCEPTANCE = 0.50
WATCH_MIN_DAYS = 30
HIGH_USAGE_TOP_FRACTION = 0.5        # top 50% of tools by monthly run rate

ENGINEER_HOURLY_RATE = 100.0         # used to cost backlog ideas

FLAGS = ("SCALE", "FIX", "KILL", "WATCH")


# ---------------------------------------------------------------------------
# Per-run value
# ---------------------------------------------------------------------------
def run_minutes_saved(outcome: str, baseline_minutes: float, human_minutes: float) -> float:
    """Minutes saved by one run, after outcome weighting.

    Not clamped at zero: if a person spent longer than the baseline, the run
    has negative value. AI made that task slower, and the tracker should say so.
    """
    return VALUE_WEIGHT[outcome] * (baseline_minutes - human_minutes)


def minutes_to_value(minutes: float, hourly_rate: float) -> float:
    return minutes / 60.0 * hourly_rate


def run_value(outcome: str, baseline_minutes: float, human_minutes: float, hourly_rate: float) -> float:
    return minutes_to_value(run_minutes_saved(outcome, baseline_minutes, human_minutes), hourly_rate)


# ---------------------------------------------------------------------------
# Fixed / amortized cost over a date window (inclusive on both ends)
# ---------------------------------------------------------------------------
def overlap_days(a_start: date, a_end: date, b_start: date, b_end: date) -> int:
    start, end = max(a_start, b_start), min(a_end, b_end)
    return max(0, (end - start).days + 1)


def fixed_cost_in_window(monthly_fixed_cost: float, launch: date, start: date, end: date) -> float:
    """Licenses/hosting accrue every day the tool has been live."""
    days = overlap_days(launch, date.max, start, end)
    return monthly_fixed_cost * 12 / DAYS_PER_YEAR * days


def build_cost_in_window(build_cost: float, launch: date, start: date, end: date) -> float:
    """The one-time build cost is spread evenly over the first 365 days after launch."""
    amort_end = launch + timedelta(days=BUILD_AMORTIZATION_DAYS - 1)
    days = overlap_days(launch, amort_end, start, end)
    return build_cost / BUILD_AMORTIZATION_DAYS * days


# ---------------------------------------------------------------------------
# Tool metrics over a window
# ---------------------------------------------------------------------------
@dataclass
class Assumptions:
    baseline_minutes: float
    hourly_rate: float
    build_cost: float
    monthly_fixed_cost: float
    launch_date: date


@dataclass
class OutcomeTotals:
    """Aggregated runs of one outcome type: count, Σ human minutes, Σ API $."""
    runs: int = 0
    human_minutes: float = 0.0
    api_cost: float = 0.0

    def add(self, other: "OutcomeTotals") -> None:
        self.runs += other.runs
        self.human_minutes += other.human_minutes
        self.api_cost += other.api_cost


def safe_div(n: float, d: float) -> Optional[float]:
    return n / d if d else None


def roi(value: float, cost: float) -> Optional[float]:
    return safe_div(value - cost, cost)


@dataclass
class ToolMetrics:
    runs: int
    runs_by_outcome: Dict[str, int]
    successful_runs: int
    acceptance_rate: Optional[float]
    minutes_saved: float
    hours_saved: float
    value_by_outcome: Dict[str, float]
    value: float
    api_cost: float
    fixed_cost: float
    build_cost: float
    total_cost: float
    net_value: float
    roi: Optional[float]
    cost_per_run: Optional[float]
    cost_per_success: Optional[float]
    wasted_human_minutes: float     # time people spent on rejected/failed runs (not in ROI)
    active_days: int
    monthly_run_rate: float         # runs per month while live in this window

    def to_dict(self) -> dict:
        return asdict(self)


def compute_tool_metrics(
    a: Assumptions,
    outcomes: Dict[str, OutcomeTotals],
    start: date,
    end: date,
) -> ToolMetrics:
    """Everything the dashboard shows for one tool, for one window."""
    o = {k: outcomes.get(k, OutcomeTotals()) for k in OUTCOMES}
    runs = sum(t.runs for t in o.values())
    successful = o["accepted"].runs + o["edited"].runs

    minutes_by_outcome = {
        k: VALUE_WEIGHT[k] * (t.runs * a.baseline_minutes - t.human_minutes) for k, t in o.items()
    }
    minutes = sum(minutes_by_outcome.values())
    value_by_outcome = {k: minutes_to_value(m, a.hourly_rate) for k, m in minutes_by_outcome.items()}
    value = sum(value_by_outcome.values())

    api = sum(t.api_cost for t in o.values())
    fixed = fixed_cost_in_window(a.monthly_fixed_cost, a.launch_date, start, end)
    build = build_cost_in_window(a.build_cost, a.launch_date, start, end)
    total = api + fixed + build
    active = overlap_days(a.launch_date, date.max, start, end)

    return ToolMetrics(
        runs=runs,
        runs_by_outcome={k: t.runs for k, t in o.items()},
        successful_runs=successful,
        acceptance_rate=safe_div(successful, runs),
        minutes_saved=minutes,
        hours_saved=minutes / 60.0,
        value_by_outcome=value_by_outcome,
        value=value,
        api_cost=api,
        fixed_cost=fixed,
        build_cost=build,
        total_cost=total,
        net_value=value - total,
        roi=roi(value, total),
        cost_per_run=safe_div(total, runs),
        cost_per_success=safe_div(total, successful),
        wasted_human_minutes=o["rejected"].human_minutes + o["failed"].human_minutes,
        active_days=active,
        monthly_run_rate=(runs / active * DAYS_PER_MONTH) if active else 0.0,
    )


# ---------------------------------------------------------------------------
# Scale / Fix / Kill / Watch
# ---------------------------------------------------------------------------
def high_usage_ids(monthly_run_rates: Dict[int, float]) -> set:
    """Tools in the top 50% by monthly run rate (ties broken by id for stability)."""
    if not monthly_run_rates:
        return set()
    ranked = sorted(monthly_run_rates.items(), key=lambda kv: (-kv[1], kv[0]))
    k = math.ceil(len(ranked) * HIGH_USAGE_TOP_FRACTION)
    return {tool_id for tool_id, _ in ranked[:k]}


@dataclass
class FlagInput:
    days_live: int
    roi: Optional[float]
    acceptance_rate: Optional[float]
    high_usage: bool
    recent_monthly_rois: Sequence[Optional[float]] = field(default_factory=list)  # last complete months, oldest first
    override: Optional[str] = None


def _fmt_roi(r: Optional[float]) -> str:
    return "n/a" if r is None else f"{r:.1f}×".replace("-0.0×", "0.0×")


def _fmt_pct(p: Optional[float]) -> str:
    return "n/a" if p is None else f"{p * 100:.0f}%"


def decide_flag(fi: FlagInput) -> dict:
    """Return the automatic flag, the rule that fired, and every check evaluated.

    Rules are checked in order; the first one that matches wins.
      1. WATCH  live < 30 days: not enough evidence yet.
      2. FIX    usage without impact: top-50% usage AND (ROI < 1× OR acceptance < 50%).
                Checked before KILL on purpose: heavy usage proves demand, so the
                answer is to fix the quality, not to take the tool away.
      3. KILL   ROI < 1× in each of the last 2 complete months.
      4. SCALE  ROI ≥ 3× AND acceptance ≥ 70%.
      5. FIX    everything else (ROI 1–3×, acceptance < 70%, a single bad month...).
    """
    r = fi.roi if fi.roi is not None else math.inf  # zero cost: treat as infinitely good
    acc = fi.acceptance_rate if fi.acceptance_rate is not None else 0.0
    recent = list(fi.recent_monthly_rois)[-KILL_CONSECUTIVE_MONTHS:]

    watch = fi.days_live < WATCH_MIN_DAYS
    uwi = fi.high_usage and (r < KILL_MAX_ROI or acc < LOW_ACCEPTANCE)
    kill = len(recent) == KILL_CONSECUTIVE_MONTHS and all(m is not None and m < KILL_MAX_ROI for m in recent)
    scale = r >= SCALE_MIN_ROI and acc >= SCALE_MIN_ACCEPTANCE

    checks = [
        {
            "rule": "WATCH",
            "test": f"Live fewer than {WATCH_MIN_DAYS} days",
            "observed": f"{fi.days_live} days live",
            "passed": watch,
        },
        {
            "rule": "FIX",
            "test": "Usage without impact: top-50% usage AND (ROI < 1× OR acceptance < 50%)",
            "observed": f"{'top' if fi.high_usage else 'bottom'} 50% usage, ROI {_fmt_roi(fi.roi)}, acceptance {_fmt_pct(fi.acceptance_rate)}",
            "passed": uwi,
        },
        {
            "rule": "KILL",
            "test": f"ROI < 1× in each of the last {KILL_CONSECUTIVE_MONTHS} complete months",
            "observed": "monthly ROI " + ", ".join(_fmt_roi(m) for m in recent) if recent else "not enough complete months",
            "passed": kill,
        },
        {
            "rule": "SCALE",
            "test": "ROI ≥ 3× AND acceptance ≥ 70%",
            "observed": f"ROI {_fmt_roi(fi.roi)}, acceptance {_fmt_pct(fi.acceptance_rate)}",
            "passed": scale,
        },
    ]

    if watch:
        auto, why = "WATCH", f"Only {fi.days_live} days of data. Re-evaluate after {WATCH_MIN_DAYS} days."
    elif uwi:
        auto = "FIX"
        parts = []
        if r < KILL_MAX_ROI:
            parts.append(f"ROI is {_fmt_roi(fi.roi)}")
        if acc < LOW_ACCEPTANCE:
            parts.append(f"only {_fmt_pct(fi.acceptance_rate)} of outputs are used")
        why = ("Usage without impact: heavily used, but " + " and ".join(parts)
               + ". The demand is real, so rework the prompts or workflow before spending more.")
    elif kill:
        why = f"ROI below 1× for {KILL_CONSECUTIVE_MONTHS} straight months with little usage. Sunset it and stop the spend."
        auto = "KILL"
    elif scale:
        auto, why = "SCALE", f"ROI {_fmt_roi(fi.roi)} with {_fmt_pct(fi.acceptance_rate)} acceptance. Roll it out to more teams."
    else:
        auto = "FIX"
        gaps = []
        if r < SCALE_MIN_ROI:
            gaps.append(f"ROI {_fmt_roi(fi.roi)} is under the {SCALE_MIN_ROI:.0f}× SCALE bar")
        if acc < SCALE_MIN_ACCEPTANCE:
            gaps.append(f"acceptance {_fmt_pct(fi.acceptance_rate)} is under the {SCALE_MIN_ACCEPTANCE:.0%} SCALE bar")
        why = "Pays for itself, but " + " and ".join(gaps) + "." if gaps else "Does not meet SCALE criteria."

    return {
        "auto_flag": auto,
        "flag": fi.override or auto,
        "overridden": bool(fi.override and fi.override != auto),
        "reason": why,
        "checks": checks,
    }


# ---------------------------------------------------------------------------
# Portfolio roll-ups
# ---------------------------------------------------------------------------
def sum_metrics(items: Iterable[ToolMetrics]) -> dict:
    items = list(items)
    value = sum(m.value for m in items)
    cost = sum(m.total_cost for m in items)
    runs = sum(m.runs for m in items)
    successes = sum(m.successful_runs for m in items)
    return {
        "runs": runs,
        "successful_runs": successes,
        "acceptance_rate": safe_div(successes, runs),
        "hours_saved": sum(m.hours_saved for m in items),
        "value": value,
        "api_cost": sum(m.api_cost for m in items),
        "fixed_cost": sum(m.fixed_cost for m in items),
        "build_cost": sum(m.build_cost for m in items),
        "total_cost": cost,
        "net_value": value - cost,
        "roi": roi(value, cost),
        "cost_per_success": safe_div(cost, successes),
    }


def pct_change(prev: Optional[float], cur: Optional[float]) -> Optional[float]:
    if prev is None or cur is None or prev == 0:
        return None
    return (cur - prev) / abs(prev)


def cost_outpacing_value(cost_growth: Optional[float], value_growth: Optional[float], margin: float = 0.10) -> bool:
    """UC5: spend is growing at least 10 points faster than the value it creates."""
    if cost_growth is None or cost_growth <= 0:
        return False
    return value_growth is None or cost_growth - value_growth >= margin


# ---------------------------------------------------------------------------
# Backlog opportunity scoring (UC7)
# ---------------------------------------------------------------------------
def score_idea(
    tasks_per_month: float,
    minutes_saved_per_task: float,
    hourly_rate: float,
    expected_adoption_pct: float,
    build_hours: float,
    est_monthly_api_cost: float,
    engineer_rate: float = ENGINEER_HOURLY_RATE,
) -> dict:
    """Priority score = estimated annual value / estimated first-year cost.

    Estimated value = tasks/month × minutes saved/task ÷ 60 × hourly rate × adoption %
    Estimated cost  = build hours × engineer rate + 12 × monthly API cost
    """
    adoption = expected_adoption_pct / 100.0
    monthly_value = tasks_per_month * minutes_saved_per_task / 60.0 * hourly_rate * adoption
    annual_value = monthly_value * 12
    build_cost = build_hours * engineer_rate
    first_year_cost = build_cost + 12 * est_monthly_api_cost
    monthly_net = monthly_value - est_monthly_api_cost
    return {
        "est_monthly_hours_saved": tasks_per_month * minutes_saved_per_task / 60.0 * adoption,
        "est_monthly_value": monthly_value,
        "est_annual_value": annual_value,
        "est_build_cost": build_cost,
        "est_first_year_cost": first_year_cost,
        "priority_score": safe_div(annual_value, first_year_cost),
        "payback_months": (build_cost / monthly_net) if monthly_net > 0 else None,
    }


# ---------------------------------------------------------------------------
# One run, priced step by step (powers the "Log a Run" receipt)
# ---------------------------------------------------------------------------
def price_run(outcome: str, baseline_minutes: float, human_minutes: float, hourly_rate: float, api_cost: float) -> dict:
    """Every intermediate number of the per-run formula, so the UI can show each step."""
    raw = baseline_minutes - human_minutes
    weight = VALUE_WEIGHT[outcome]
    saved = weight * raw
    value = minutes_to_value(saved, hourly_rate)
    return {
        "outcome": outcome,
        "baseline_minutes": baseline_minutes,
        "human_minutes": human_minutes,
        "raw_minutes_saved": raw,          # before outcome credit
        "credit": weight,                  # 1.0 / 0.5 / 0.0
        "minutes_saved": saved,            # after outcome credit
        "hourly_rate": hourly_rate,
        "value": value,
        "api_cost": api_cost,
        "net": value - api_cost,
    }


# ---------------------------------------------------------------------------
# Run funnel: adoption is the top of the funnel, impact is the bottom
# ---------------------------------------------------------------------------
FUNNEL_STAGES = (
    ("runs", "Runs started"),
    ("completed", "Completed without error"),
    ("used", "Output used"),
    ("as_is", "Used as-is"),
)


def run_funnel(runs_by_outcome: Dict[str, int]) -> List[dict]:
    """Runs → completed (not failed) → used (accepted + edited) → used as-is (accepted)."""
    o = {k: runs_by_outcome.get(k, 0) for k in OUTCOMES}
    total = sum(o.values())
    counts = {
        "runs": total,
        "completed": total - o["failed"],
        "used": o["accepted"] + o["edited"],
        "as_is": o["accepted"],
    }
    out, prev = [], None
    for key, label in FUNNEL_STAGES:
        n = counts[key]
        out.append({
            "key": key,
            "label": label,
            "count": n,
            "share_of_runs": safe_div(n, total),
            "conversion": safe_div(n, prev) if prev is not None else None,
            "drop": (prev - n) if prev is not None else 0,
        })
        prev = n
    return out
