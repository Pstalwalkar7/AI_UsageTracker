"""End-to-end checks against the seeded demo data (the acceptance criteria in the spec)."""
import os
import tempfile

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh():
    client.post("/api/admin/reset")


def tools_by_name(range_="6m"):
    return {t["name"]: t for t in client.get(f"/api/tools?range={range_}").json()["tools"]}


@pytest.mark.parametrize("range_", ["1m", "3m", "6m"])
def test_every_flag_appears_as_designed(range_):
    t = tools_by_name(range_)
    assert t["Support Ticket Summarizer"]["flag"] == "SCALE"
    assert t["Sales Call Notes → CRM"]["flag"] == "SCALE"
    assert t["Invoice Data Extractor (OCR)"]["flag"] == "SCALE"
    assert t["PTO / HR Policy Bot"]["flag"] == "FIX"
    assert t["Marketing Copy Generator"]["flag"] == "FIX"
    assert t["Marketing Copy Generator"]["reason"].startswith("Usage without impact")
    assert t["Contract Clause Checker"]["flag"] == "KILL"
    assert t["PR Description Writer"]["flag"] == "WATCH"


def test_quadrant_isolates_marketing():
    """Bottom-right (high usage, ROI < 1×) contains exactly one tool."""
    t = tools_by_name()
    bottom_right = [n for n, x in t.items() if x["high_usage"] and x["metrics"]["roi"] < 1]
    assert bottom_right == ["Marketing Copy Generator"]


def test_summary_totals_equal_sum_of_tools():
    s = client.get("/api/summary").json()
    tools = client.get("/api/tools").json()["tools"]
    assert s["totals"]["value"] == pytest.approx(sum(t["metrics"]["value"] for t in tools))
    assert s["totals"]["total_cost"] == pytest.approx(sum(t["metrics"]["total_cost"] for t in tools))
    # monthly series adds up to the window total too
    assert sum(p["value"] for p in s["series"]) == pytest.approx(s["totals"]["value"])
    assert sum(p["total_cost"] for p in s["series"]) == pytest.approx(s["totals"]["total_cost"])
    assert s["top_issue"]["name"] == "Marketing Copy Generator"


def test_department_rollup_reconciles_with_portfolio():
    d = client.get("/api/departments").json()["departments"]
    s = client.get("/api/summary").json()["totals"]
    assert sum(x["value"] for x in d) == pytest.approx(s["value"])
    assert sum(x["total_cost"] for x in d) == pytest.approx(s["total_cost"])
    ops = next(x for x in d if x["name"] == "Operations")
    # Operations owns no tools; its only AI help is the company-wide HR bot -> biggest gap.
    assert ops["tools_owned"] == 0 and ops["coverage"] < 0.01
    assert max(d, key=lambda x: x["gap_hours_per_month"])["name"] == "Operations"


def test_editing_baseline_recalculates_roi_and_flag():
    hr = tools_by_name()["PTO / HR Policy Bot"]
    assert hr["flag"] == "FIX"
    r = client.patch(f"/api/tools/{hr['id']}", json={"baseline_minutes_per_task": 10}).json()
    assert r["metrics"]["roi"] > hr["metrics"]["roi"]
    assert r["flag"] == "SCALE"


def test_override_flag():
    mk = tools_by_name()["Marketing Copy Generator"]
    r = client.patch(f"/api/tools/{mk['id']}", json={"status_override": "KILL"}).json()
    assert r["flag"] == "KILL" and r["auto_flag"] == "FIX" and r["overridden"]
    r = client.patch(f"/api/tools/{mk['id']}", json={"clear_override": True}).json()
    assert r["flag"] == "FIX"


def test_post_run_updates_dashboard():
    before = client.get("/api/summary").json()["totals"]
    tid = tools_by_name()["Support Ticket Summarizer"]["id"]
    end = client.get("/api/meta").json()["as_of"]
    r = client.post("/api/runs", json={
        "tool_id": tid, "human_minutes_with_ai": 2, "api_cost_usd": 0.03,
        "model_name": "claude-haiku-5-5", "outcome": "accepted", "timestamp": f"{end}T12:00:00Z"})
    assert r.status_code == 201
    assert r.json()["value_usd"] == pytest.approx(4.5)
    after = client.get("/api/summary").json()["totals"]
    assert after["runs"] == before["runs"] + 1
    assert after["value"] == pytest.approx(before["value"] + 4.5)


def test_post_run_validation():
    assert client.post("/api/runs", json={"tool_id": 1, "human_minutes_with_ai": 1, "api_cost_usd": 0,
                                          "model_name": "x", "outcome": "great"}).status_code == 422
    assert client.post("/api/runs", json={"tool_id": 999, "human_minutes_with_ai": 1, "api_cost_usd": 0,
                                          "model_name": "x", "outcome": "accepted"}).status_code == 404


def test_add_idea_scores_immediately():
    r = client.post("/api/ideas", json={"name": "Test idea", "department_id": 1, "tasks_per_month": 1000,
                                        "minutes_saved_per_task": 10, "hourly_rate": 60, "expected_adoption_pct": 50,
                                        "build_hours": 40, "est_monthly_api_cost": 100})
    assert r.status_code == 201
    created = r.json()["created"]
    assert created["est_annual_value"] == pytest.approx(1000 * 10 / 60 * 60 * 0.5 * 12)
    assert created["priority_score"] == pytest.approx(60000 / (4000 + 1200))
    assert created["rank"] == 1


def test_detail_and_spend_endpoints():
    tid = tools_by_name()["Marketing Copy Generator"]["id"]
    d = client.get(f"/api/tools/{tid}").json()
    assert {f["reason"] for f in d["failure_reasons"]} >= {"user_rejected"}
    assert len(d["models"]) == 2  # switched models mid-window
    sp = client.get("/api/spend").json()
    mk = next(g for g in sp["growth"] if g["name"] == "Marketing Copy Generator")
    assert sp["by_tool"][0]["name"] == "Marketing Copy Generator"  # biggest spender


def test_preview_matches_post():
    tid = tools_by_name()["Support Ticket Summarizer"]["id"]
    body = {"tool_id": tid, "human_minutes_with_ai": 3, "api_cost_usd": 0.05,
            "model_name": "claude-haiku-5-5", "outcome": "edited"}
    before = client.get("/api/summary").json()["totals"]["runs"]
    pv = client.post("/api/runs/preview", json=body).json()
    assert client.get("/api/summary").json()["totals"]["runs"] == before  # preview does not save
    assert pv["minutes_saved"] == pytest.approx(0.5 * (8 - 3))
    posted = client.post("/api/runs", json=body | {"user_id": 1001}).json()
    assert posted["value"] == pytest.approx(pv["value"])


def test_adoption_vs_impact():
    d = {x["name"]: x for x in client.get("/api/departments").json()["departments"]}
    # Operations uses AI (the company-wide HR bot) but gets almost no time back.
    assert d["Operations"]["adoption"] > 0.4
    assert d["Operations"]["hours_per_active_user_per_month"] < 1
    assert d["Support"]["hours_per_active_user_per_month"] > 3
    for x in d.values():
        assert x["active_users"] <= x["headcount"]


def test_usage_flow_conserves_runs():
    flow = client.get("/api/departments").json()["flow"]
    tools = {t["name"]: t for t in client.get("/api/tools").json()["tools"]}
    names = [n["name"] for n in flow["nodes"]]
    for name, t in tools.items():
        i = names.index(name)
        inflow = sum(l["value"] for l in flow["links"] if l["target"] == i)
        outflow = sum(l["value"] for l in flow["links"] if l["source"] == i)
        assert inflow == outflow == t["metrics"]["runs"]


def test_portfolio_funnel_and_users():
    p = client.get("/api/tools").json()
    f = p["totals"]["funnel"]
    assert f[0]["count"] == p["totals"]["runs"]
    assert f[2]["count"] == p["totals"]["successful_runs"]
    assert 0 < p["totals"]["active_users"] <= p["totals"]["headcount"]
