"""
Glue between SQLite and metrics.py.

SQL does only counting and summing (GROUP BY tool / month / outcome).
Every dollar, ratio and flag is computed in metrics.py from those totals.
"""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

from . import metrics as m

RANGES = {"1m": 30, "3m": 91, "6m": 182}
DEFAULT_RANGE = "6m"


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------
def as_of(conn: sqlite3.Connection) -> date:
    """'Today' for the dashboard = the date of the latest run reported."""
    row = conn.execute("SELECT MAX(substr(timestamp,1,10)) FROM runs").fetchone()
    return date.fromisoformat(row[0]) if row and row[0] else date.today()


def window(conn: sqlite3.Connection, range_key: str) -> Tuple[date, date]:
    end = as_of(conn)
    days = RANGES.get(range_key, RANGES[DEFAULT_RANGE])
    return end - timedelta(days=days - 1), end


def month_start(d: date) -> date:
    return d.replace(day=1)


def next_month(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def months_in(start: date, end: date) -> List[Tuple[str, date, date]]:
    """Calendar months overlapping [start, end], each clipped to the window."""
    out, cur = [], month_start(start)
    while cur <= end:
        nxt = next_month(cur)
        out.append((cur.strftime("%Y-%m"), max(cur, start), min(nxt - timedelta(days=1), end)))
        cur = nxt
    return out


def last_complete_months(today: date, n: int) -> List[Tuple[str, date, date]]:
    """The n most recent calendar months that ended before `today`'s month, oldest first."""
    out, cur = [], month_start(today)
    for _ in range(n):
        prev_end = cur - timedelta(days=1)
        cur = month_start(prev_end)
        out.append((cur.strftime("%Y-%m"), cur, prev_end))
    return list(reversed(out))


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------
def load_tools(conn) -> List[dict]:
    rows = conn.execute(
        """SELECT t.*, d.name AS department FROM tools t JOIN departments d ON d.id = t.department_id ORDER BY t.id"""
    ).fetchall()
    return [dict(r) for r in rows]


def assumptions(t: dict) -> m.Assumptions:
    return m.Assumptions(
        baseline_minutes=t["baseline_minutes_per_task"],
        hourly_rate=t["loaded_hourly_rate"],
        build_cost=t["build_cost"],
        monthly_fixed_cost=t["monthly_fixed_cost"],
        launch_date=date.fromisoformat(t["launch_date"]),
    )


def outcome_buckets(conn, start: date, end: date, extra: Tuple[str, ...] = ()) -> Dict[tuple, Dict[str, m.OutcomeTotals]]:
    """{(tool_id, *extra): {outcome: OutcomeTotals}} for runs in [start, end]."""
    extra_sql = "".join(f", {e}" for e in extra)
    rows = conn.execute(
        f"""SELECT tool_id{extra_sql}, outcome, COUNT(*) n,
                   SUM(human_minutes_with_ai) h, SUM(api_cost_usd) c
            FROM runs
            WHERE timestamp >= ? AND timestamp < date(?, '+1 day')
            GROUP BY tool_id{extra_sql}, outcome""",
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    out: Dict[tuple, Dict[str, m.OutcomeTotals]] = defaultdict(dict)
    for r in rows:
        key = tuple(r[i] for i in range(1 + len(extra)))
        out[key][r["outcome"]] = m.OutcomeTotals(r["n"], r["h"] or 0.0, r["c"] or 0.0)
    return out


MONTH = "substr(timestamp,1,7)"
WEEK = "date(substr(timestamp,1,10), '-6 days', 'weekday 1')"   # Monday on or before the run


def active_users(conn, start: date, end: date, by: Optional[str] = None) -> Dict:
    """Distinct employees with at least one run in [start, end]. {group: n}, or {None: n} when ungrouped."""
    sel = f"{by}," if by else "NULL,"
    grp = f"GROUP BY {by}" if by else ""
    rows = conn.execute(
        f"""SELECT {sel} COUNT(DISTINCT user_id) FROM runs
            WHERE user_id IS NOT NULL AND timestamp >= ? AND timestamp < date(?, '+1 day') {grp}""",
        (start.isoformat(), end.isoformat())).fetchall()
    return {r[0]: r[1] for r in rows}


# ---------------------------------------------------------------------------
# Portfolio (the core computation everything else reuses)
# ---------------------------------------------------------------------------
def portfolio(conn, range_key: str) -> dict:
    start, end = window(conn, range_key)
    tools = load_tools(conn)
    window_b = outcome_buckets(conn, start, end)

    per_tool = {}
    for t in tools:
        a = assumptions(t)
        tm = m.compute_tool_metrics(a, window_b.get((t["id"],), {}), start, end)
        per_tool[t["id"]] = (t, a, tm)

    # Monthly ROI for the KILL rule: always the last 2 complete calendar months.
    complete = last_complete_months(end, m.KILL_CONSECUTIVE_MONTHS)
    km_b = outcome_buckets(conn, complete[0][1], complete[-1][2], ("substr(timestamp,1,7)",))
    users = active_users(conn, start, end, "tool_id")
    high = m.high_usage_ids({tid: tm.monthly_run_rate for tid, (_, _, tm) in per_tool.items() if tm.runs})

    items = []
    for tid, (t, a, tm) in per_tool.items():
        recent = []
        for label, ms, me in complete:
            if a.launch_date > ms:  # tool not live for the whole month: don't judge it on that month
                continue
            mm = m.compute_tool_metrics(a, km_b.get((tid, label), {}), ms, me)
            recent.append({"month": label, "roi": mm.roi})
        days_live = (end - a.launch_date).days + 1
        flag = m.decide_flag(m.FlagInput(
            days_live=days_live,
            roi=tm.roi,
            acceptance_rate=tm.acceptance_rate,
            high_usage=tid in high,
            recent_monthly_rois=[r["roi"] for r in recent],
            override=t["status_override"],
        ))
        items.append({
            "id": tid,
            "name": t["name"],
            "description": t["description"],
            "owner": t["owner"],
            "department": t["department"],
            "department_id": t["department_id"],
            "launch_date": t["launch_date"],
            "days_live": days_live,
            "assumptions": {
                "baseline_minutes_per_task": t["baseline_minutes_per_task"],
                "loaded_hourly_rate": t["loaded_hourly_rate"],
                "build_cost": t["build_cost"],
                "monthly_fixed_cost": t["monthly_fixed_cost"],
                "status_override": t["status_override"],
            },
            "metrics": tm.to_dict(),
            "active_users": users.get(tid, 0),
            "runs_per_user": m.safe_div(tm.runs, users.get(tid, 0)),
            "funnel": m.run_funnel(tm.runs_by_outcome),
            "high_usage": tid in high,
            "recent_monthly_roi": recent,
            **flag,
        })
    totals = m.sum_metrics(pt[2] for pt in per_tool.values())
    all_outcomes: Dict[str, int] = defaultdict(int)
    for _, _, tm in per_tool.values():
        for k, v in tm.runs_by_outcome.items():
            all_outcomes[k] += v
    totals["funnel"] = m.run_funnel(all_outcomes)
    totals["active_users"] = active_users(conn, start, end).get(None, 0)
    totals["headcount"] = conn.execute("SELECT SUM(headcount) FROM departments").fetchone()[0]
    usage_rates = sorted((i["metrics"]["monthly_run_rate"] for i in items if i["high_usage"]))
    return {
        "range": range_key,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "tools": items,
        "totals": totals,
        "high_usage_threshold": usage_rates[0] if usage_rates else 0,
    }


def monthly_series(conn, start: date, end: date, tool_ids: Optional[List[int]] = None, buckets=None) -> List[dict]:
    """Value, cost and ROI per calendar month, summed across the given tools.
    Pass `buckets` (from outcome_buckets(..., (MONTH,)) over the same window) to reuse one query across calls."""
    tools = {t["id"]: t for t in load_tools(conn)}
    ids = tool_ids or list(tools)
    b = buckets if buckets is not None else outcome_buckets(conn, start, end, (MONTH,))
    out = []
    for label, ms, me in months_in(start, end):
        tms = [m.compute_tool_metrics(assumptions(tools[i]), b.get((i, label), {}), ms, me) for i in ids]
        s = m.sum_metrics(tms)
        out.append({
            "month": label,
            "partial": (ms.day != 1) or (me != next_month(ms) - timedelta(days=1)),
            "days": (me - ms).days + 1,
            **{k: s[k] for k in ("runs", "successful_runs", "acceptance_rate", "hours_saved", "value",
                                 "api_cost", "fixed_cost", "build_cost", "total_cost", "net_value", "roi")},
        })
    return out


# ---------------------------------------------------------------------------
# Screens
# ---------------------------------------------------------------------------
def summary(conn, range_key: str) -> dict:
    p = portfolio(conn, range_key)
    start, end = date.fromisoformat(p["start"]), date.fromisoformat(p["end"])
    series = monthly_series(conn, start, end)

    # Month over month: last 2 complete months, independent of range.
    prev_m, cur_m = last_complete_months(end, 2)
    mom_series = monthly_series(conn, prev_m[1], cur_m[2])
    prev, cur = mom_series[0], mom_series[1]
    mom = {
        "previous_month": prev["month"],
        "current_month": cur["month"],
        "value": {"prev": prev["value"], "cur": cur["value"], "change": m.pct_change(prev["value"], cur["value"])},
        "total_cost": {"prev": prev["total_cost"], "cur": cur["total_cost"], "change": m.pct_change(prev["total_cost"], cur["total_cost"])},
        "hours_saved": {"prev": prev["hours_saved"], "cur": cur["hours_saved"], "change": m.pct_change(prev["hours_saved"], cur["hours_saved"])},
        "roi": {"prev": prev["roi"], "cur": cur["roi"]},
    }

    tools = p["tools"]
    wins = sorted(tools, key=lambda t: -t["metrics"]["net_value"])[:3]
    flagged = [t for t in tools if t["flag"] in ("FIX", "KILL")]
    # Biggest problem = the flagged tool with the most spend at stake.
    flagged.sort(key=lambda t: -t["metrics"]["total_cost"])
    flag_counts = {f: sum(1 for t in tools if t["flag"] == f) for f in m.FLAGS}

    slim = lambda t: {k: t[k] for k in ("id", "name", "department", "flag", "auto_flag", "reason")} | {
        k: t["metrics"][k] for k in ("value", "total_cost", "net_value", "roi", "hours_saved", "acceptance_rate", "runs")}
    return {
        "range": p["range"], "start": p["start"], "end": p["end"],
        "totals": p["totals"],
        "series": series,
        "mom": mom,
        "top_wins": [slim(t) for t in wins],
        "top_issue": slim(flagged[0]) if flagged else None,
        "other_issues": [slim(t) for t in flagged[1:]],
        "flag_counts": flag_counts,
        "by_tool": [slim(t) for t in sorted(tools, key=lambda t: -t["metrics"]["value"])],
    }


def tool_detail(conn, tool_id: int, range_key: str) -> Optional[dict]:
    p = portfolio(conn, range_key)
    item = next((t for t in p["tools"] if t["id"] == tool_id), None)
    if not item:
        return None
    start, end = date.fromisoformat(p["start"]), date.fromisoformat(p["end"])
    s, e = start.isoformat(), end.isoformat()
    item["series"] = monthly_series(conn, start, end, [tool_id])

    rows = conn.execute(
        """SELECT failure_reason r, outcome, COUNT(*) n FROM runs
           WHERE tool_id=? AND failure_reason IS NOT NULL AND timestamp >= ? AND timestamp < date(?, '+1 day')
           GROUP BY failure_reason, outcome ORDER BY n DESC""", (tool_id, s, e)).fetchall()
    total_runs = item["metrics"]["runs"] or 1
    item["failure_reasons"] = [{"reason": r["r"], "outcome": r["outcome"], "runs": r["n"], "share_of_runs": r["n"] / total_runs} for r in rows]

    rows = conn.execute(
        f"""SELECT {MONTH} month, failure_reason r, COUNT(*) n FROM runs
            WHERE tool_id=? AND failure_reason IS NOT NULL AND timestamp >= ? AND timestamp < date(?, '+1 day')
            GROUP BY month, r""", (tool_id, s, e)).fetchall()
    by_month = defaultdict(dict)
    for r in rows:
        by_month[r["month"]][r["r"]] = r["n"]
    for pt in item["series"]:
        pt["failures"] = by_month.get(pt["month"], {})

    rows = conn.execute(
        """SELECT model_name, COUNT(*) n, SUM(api_cost_usd) c,
                  SUM(outcome IN ('accepted','edited')) ok
           FROM runs WHERE tool_id=? AND timestamp >= ? AND timestamp < date(?, '+1 day')
           GROUP BY model_name ORDER BY c DESC""", (tool_id, s, e)).fetchall()
    item["models"] = [{"model": r["model_name"], "runs": r["n"], "api_cost": r["c"],
                       "acceptance_rate": m.safe_div(r["ok"], r["n"]),
                       "api_cost_per_success": m.safe_div(r["c"], r["ok"])} for r in rows]

    rows = conn.execute(
        f"""SELECT {WEEK} wk, COUNT(*) n, COUNT(DISTINCT user_id) u, SUM(outcome IN ('accepted','edited')) ok
            FROM runs WHERE tool_id=? AND timestamp >= ? AND timestamp < date(?, '+1 day')
            GROUP BY wk ORDER BY wk""", (tool_id, s, e)).fetchall()
    item["weekly"] = [{
        "week": r["wk"], "runs": r["n"], "active_users": r["u"],
        "runs_per_user": m.safe_div(r["n"], r["u"]), "acceptance_rate": m.safe_div(r["ok"], r["n"]),
        # a week is partial if it starts before the window or ends after the last day of data
        "partial": r["wk"] < max(s, item["launch_date"]) or (date.fromisoformat(r["wk"]) + timedelta(days=6)) > end,
    } for r in rows]

    rows = conn.execute(
        """SELECT * FROM runs WHERE tool_id=? ORDER BY timestamp DESC, id DESC LIMIT 8""", (tool_id,)).fetchall()
    a = item["assumptions"]
    item["recent_runs"] = [dict(r) | {
        "minutes_saved": m.run_minutes_saved(r["outcome"], a["baseline_minutes_per_task"], r["human_minutes_with_ai"]),
        "value": m.run_value(r["outcome"], a["baseline_minutes_per_task"], r["human_minutes_with_ai"], a["loaded_hourly_rate"]),
    } for r in rows]
    return item


def spend(conn, range_key: str) -> dict:
    p = portfolio(conn, range_key)
    start, end = date.fromisoformat(p["start"]), date.fromisoformat(p["end"])
    s, e = start.isoformat(), end.isoformat()

    rows = conn.execute(
        """SELECT model_name, COUNT(*) n, SUM(api_cost_usd) c, SUM(outcome IN ('accepted','edited')) ok,
                  COUNT(DISTINCT tool_id) tools
           FROM runs WHERE timestamp >= ? AND timestamp < date(?, '+1 day') GROUP BY model_name ORDER BY c DESC""",
        (s, e)).fetchall()
    by_model = [{"model": r["model_name"], "runs": r["n"], "api_cost": r["c"], "tools": r["tools"],
                 "acceptance_rate": m.safe_div(r["ok"], r["n"]),
                 "api_cost_per_run": m.safe_div(r["c"], r["n"]),
                 "api_cost_per_success": m.safe_div(r["c"], r["ok"])} for r in rows]

    rows = conn.execute(
        f"""SELECT {MONTH} month, model_name, SUM(api_cost_usd) c FROM runs
            WHERE timestamp >= ? AND timestamp < date(?, '+1 day') GROUP BY month, model_name""", (s, e)).fetchall()
    api_by_month = defaultdict(dict)
    for r in rows:
        api_by_month[r["month"]][r["model_name"]] = r["c"]
    series = monthly_series(conn, start, end)
    for pt in series:
        pt["api_by_model"] = api_by_month.get(pt["month"], {})

    # Growth: last complete month vs 3 months earlier, per tool (a quarter of trend, not one noisy month).
    ms = last_complete_months(end, 4)
    prev_m, cur_m = ms[0], ms[-1]
    growth = []
    growth_buckets = outcome_buckets(conn, prev_m[1], cur_m[2], (MONTH,))
    for t in p["tools"]:
        ser = monthly_series(conn, prev_m[1], cur_m[2], [t["id"]], growth_buckets)
        prev, cur = ser[0], ser[-1]
        if prev["runs"] == 0 or date.fromisoformat(t["launch_date"]) > prev_m[1]:
            continue
        cg = m.pct_change(prev["total_cost"], cur["total_cost"])
        vg = m.pct_change(prev["value"], cur["value"])
        growth.append({"id": t["id"], "name": t["name"], "prev_cost": prev["total_cost"], "cur_cost": cur["total_cost"],
                       "prev_value": prev["value"], "cur_value": cur["value"], "cost_growth": cg, "value_growth": vg,
                       "outpacing": m.cost_outpacing_value(cg, vg)})

    by_tool = [{
        "id": t["id"], "name": t["name"], "flag": t["flag"], **{k: t["metrics"][k] for k in (
            "runs", "successful_runs", "api_cost", "fixed_cost", "build_cost", "total_cost", "value",
            "cost_per_run", "cost_per_success", "roi", "acceptance_rate")}
    } for t in sorted(p["tools"], key=lambda t: -t["metrics"]["total_cost"])]

    return {"range": p["range"], "start": s, "end": e, "totals": p["totals"], "by_tool": by_tool,
            "by_model": by_model, "series": series, "growth": growth,
            "growth_months": [prev_m[0], cur_m[0]]}


def departments(conn, range_key: str) -> dict:
    """Value is attributed to the department of the *person who used the tool*, not the tool owner.
    Fixed and build costs are split across departments by their share of each tool's runs."""
    start, end = window(conn, range_key)
    tools = {t["id"]: t for t in load_tools(conn)}
    depts = [dict(r) for r in conn.execute("SELECT * FROM departments ORDER BY id")]
    b_tool = outcome_buckets(conn, start, end)
    b_dept = outcome_buckets(conn, start, end, ("user_department_id",))
    months = (end - start).days + 1
    months = months / m.DAYS_PER_MONTH

    tool_metrics = {tid: m.compute_tool_metrics(assumptions(t), b_tool.get((tid,), {}), start, end) for tid, t in tools.items()}
    ideas = list_ideas(conn)
    users_by_dept = active_users(conn, start, end, "user_department_id")

    out = []
    for d in depts:
        value = hours = cost = 0.0
        runs = 0
        used = []
        for tid, t in tools.items():
            o = b_dept.get((tid, d["id"]))
            if not o:
                continue
            a = assumptions(t)
            # value side: same per-run math, restricted to this department's runs
            dm = m.compute_tool_metrics(a, o, start, end)
            share = m.safe_div(dm.runs, tool_metrics[tid].runs) or 0.0
            d_cost = dm.api_cost + share * (tool_metrics[tid].fixed_cost + tool_metrics[tid].build_cost)
            value += dm.value
            hours += dm.hours_saved
            cost += d_cost
            runs += dm.runs
            used.append({"id": tid, "name": t["name"], "value": dm.value, "hours_saved": dm.hours_saved,
                         "runs": dm.runs, "owned": t["department_id"] == d["id"]})
        used.sort(key=lambda u: -u["value"])
        hours_pm = hours / months
        d_ideas = [i for i in ideas if i["department_id"] == d["id"]]
        n_users = users_by_dept.get(d["id"], 0)
        out.append({
            "id": d["id"], "name": d["name"], "headcount": d["headcount"],
            "manual_hours_per_month": d["manual_hours_per_month"],
            "runs": runs, "value": value, "hours_saved": hours, "total_cost": cost,
            "net_value": value - cost, "roi": m.roi(value, cost),
            "hours_saved_per_month": hours_pm,
            "active_users": n_users,
            "adoption": m.safe_div(n_users, d["headcount"]),
            "hours_per_active_user_per_month": m.safe_div(hours_pm, n_users),
            "coverage": m.safe_div(hours_pm, d["manual_hours_per_month"]),
            "gap_hours_per_month": max(0.0, d["manual_hours_per_month"] - hours_pm),
            "tools_owned": sum(1 for t in tools.values() if t["department_id"] == d["id"]),
            "tools_used": used,
            "backlog_ideas": [{"id": i["id"], "name": i["name"], "priority_score": i["priority_score"],
                               "est_monthly_hours_saved": i["est_monthly_hours_saved"]} for i in d_ideas],
        })
    return {"range": range_key, "start": start.isoformat(), "end": end.isoformat(), "departments": out,
            "flow": usage_flow(depts, tools, b_dept, b_tool)}


OUTCOME_GROUPS = (("Used as-is", ("accepted",)), ("Used after edits", ("edited",)), ("Discarded", ("rejected", "failed")))


def usage_flow(depts, tools, b_dept, b_tool) -> dict:
    """Sankey data: department → tool → what happened to the output. Link values are run counts."""
    nodes, links, idx = [], [], {}

    def node(key, name, kind):
        if key not in idx:
            idx[key] = len(nodes)
            nodes.append({"name": name, "kind": kind})
        return idx[key]

    for d in depts:
        for tid, t in tools.items():
            runs = sum(o.runs for o in b_dept.get((tid, d["id"]), {}).values())
            if runs:
                links.append({"source": node(("d", d["id"]), d["name"], "department"),
                              "target": node(("t", tid), t["name"], "tool"), "value": runs, "kind": "use"})
    for tid, t in tools.items():
        o = b_tool.get((tid,), {})
        if ("t", tid) not in idx:
            continue
        for label, keys in OUTCOME_GROUPS:
            runs = sum(o[k].runs for k in keys if k in o)
            if runs:
                links.append({"source": idx[("t", tid)], "target": node(("o", label), label, "outcome"),
                              "value": runs, "kind": label})
    return {"nodes": nodes, "links": links}


def list_ideas(conn) -> List[dict]:
    rows = conn.execute(
        "SELECT i.*, d.name AS department FROM ideas i JOIN departments d ON d.id = i.department_id").fetchall()
    out = []
    for r in rows:
        r = dict(r)
        r.update(m.score_idea(r["tasks_per_month"], r["minutes_saved_per_task"], r["hourly_rate"],
                              r["expected_adoption_pct"], r["build_hours"], r["est_monthly_api_cost"]))
        out.append(r)
    out.sort(key=lambda i: -(i["priority_score"] or 0))
    for rank, i in enumerate(out, 1):
        i["rank"] = rank
    return out
