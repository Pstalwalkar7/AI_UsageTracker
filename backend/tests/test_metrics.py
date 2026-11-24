"""The numbers are the product: every rule in metrics.py is pinned here."""
from datetime import date, timedelta

import pytest

from app import metrics as m

D = date(2026, 1, 1)


def a(**kw):
    base = dict(baseline_minutes=8, hourly_rate=45, build_cost=0, monthly_fixed_cost=0, launch_date=D)
    base.update(kw)
    return m.Assumptions(**base)


# --- value ------------------------------------------------------------------
def test_run_value_accepted_full_weight():
    # 8 min baseline, 2 min with AI, $45/hr -> 6 min saved = $4.50
    assert m.run_minutes_saved("accepted", 8, 2) == 6
    assert m.run_value("accepted", 8, 2, 45) == pytest.approx(4.50)


def test_run_value_edited_half_weight():
    assert m.run_value("edited", 8, 2, 45) == pytest.approx(2.25)


@pytest.mark.parametrize("outcome", ["rejected", "failed"])
def test_rejected_and_failed_have_no_value(outcome):
    assert m.run_value(outcome, 8, 2, 45) == 0


def test_slower_than_baseline_is_negative_value():
    assert m.run_value("accepted", 8, 10, 60) == pytest.approx(-2.0)


def test_spec_example_support_summarizer():
    # UC1: 6 min/ticket × 4,000 tickets × $45/hr = $18,000 value vs $600 cost -> 29× ROI
    totals = {"accepted": m.OutcomeTotals(runs=4000, human_minutes=4000 * 2, api_cost=600)}
    start, end = D, D + timedelta(days=29)
    tm = m.compute_tool_metrics(a(), totals, start, end)
    assert tm.value == pytest.approx(18000)
    assert tm.total_cost == pytest.approx(600)
    assert tm.roi == pytest.approx(29.0)
    assert tm.hours_saved == pytest.approx(400)
    assert tm.acceptance_rate == 1.0


def test_tool_metrics_mixed_outcomes():
    totals = {
        "accepted": m.OutcomeTotals(10, 20, 1.0),   # 10 × (8-2)   = 60 min
        "edited": m.OutcomeTotals(4, 16, 0.4),      # 0.5 × (32-16) = 8 min
        "rejected": m.OutcomeTotals(5, 10, 0.5),    # 0
        "failed": m.OutcomeTotals(1, 1, 0.1),       # 0
    }
    tm = m.compute_tool_metrics(a(hourly_rate=60), totals, D, D)
    assert tm.runs == 20
    assert tm.successful_runs == 14
    assert tm.acceptance_rate == pytest.approx(0.7)
    assert tm.minutes_saved == pytest.approx(68)
    assert tm.value == pytest.approx(68)               # $60/hr = $1/min
    assert tm.api_cost == pytest.approx(2.0)
    assert tm.cost_per_success == pytest.approx(2.0 / 14)
    assert tm.wasted_human_minutes == pytest.approx(11)


# --- cost -------------------------------------------------------------------
def test_fixed_cost_accrues_daily():
    # $365/month = $12 per day (365×12/365)
    assert m.fixed_cost_in_window(365, D, D, D + timedelta(days=9)) == pytest.approx(120)


def test_fixed_cost_starts_at_launch():
    launch = D + timedelta(days=5)
    assert m.fixed_cost_in_window(365, launch, D, D + timedelta(days=9)) == pytest.approx(60)


def test_build_cost_amortized_over_12_months_only():
    assert m.build_cost_in_window(3650, D, D, D + timedelta(days=9)) == pytest.approx(100)
    # fully amortized after 365 days
    assert m.build_cost_in_window(3650, D, D, D + timedelta(days=1000)) == pytest.approx(3650)
    assert m.build_cost_in_window(3650, D, D + timedelta(days=400), D + timedelta(days=500)) == 0


def test_total_cost_includes_api_fixed_and_build():
    totals = {"failed": m.OutcomeTotals(10, 0, 5.0)}
    tm = m.compute_tool_metrics(a(build_cost=365, monthly_fixed_cost=365), totals, D, D)
    assert tm.total_cost == pytest.approx(5 + 12 + 1)
    assert tm.value == 0
    assert tm.roi == pytest.approx(-1.0)
    assert tm.cost_per_success is None


def test_roi_definition():
    assert m.roi(300, 100) == pytest.approx(2.0)
    assert m.roi(100, 100) == 0
    assert m.roi(10, 0) is None


# --- usage ------------------------------------------------------------------
def test_high_usage_top_half_rounds_up():
    rates = {1: 4000, 2: 3000, 3: 1500, 4: 800, 5: 600, 6: 450, 7: 40}
    assert m.high_usage_ids(rates) == {1, 2, 3, 4}
    assert m.high_usage_ids({}) == set()


# --- flags ------------------------------------------------------------------
def flag(**kw):
    base = dict(days_live=200, roi=5.0, acceptance_rate=0.85, high_usage=True, recent_monthly_rois=[5.0, 5.0])
    base.update(kw)
    return m.decide_flag(m.FlagInput(**base))


def test_scale():
    assert flag()["flag"] == "SCALE"


def test_scale_boundaries_inclusive():
    assert flag(roi=3.0, acceptance_rate=0.70)["flag"] == "SCALE"
    assert flag(roi=2.99)["flag"] == "FIX"
    assert flag(acceptance_rate=0.69)["flag"] == "FIX"


def test_watch_beats_everything():
    assert flag(days_live=18, roi=-0.9, acceptance_rate=0.1, recent_monthly_rois=[])["flag"] == "WATCH"
    assert flag(days_live=30)["flag"] == "SCALE"


def test_fix_mid_roi():
    r = flag(roi=1.9, acceptance_rate=0.72, high_usage=True, recent_monthly_rois=[2.0, 1.9])
    assert r["flag"] == "FIX"
    assert "3× SCALE bar" in r["reason"]


def test_usage_without_impact_low_acceptance():
    r = flag(roi=4.0, acceptance_rate=0.22, high_usage=True)
    assert r["flag"] == "FIX"
    assert r["reason"].startswith("Usage without impact")


def test_usage_without_impact_beats_kill():
    # Heavily used and losing money for 2 months: demand is real, fix it rather than kill it.
    r = flag(roi=0.1, acceptance_rate=0.22, high_usage=True, recent_monthly_rois=[0.1, -0.02])
    assert r["flag"] == "FIX"
    assert r["checks"][2]["passed"] is True   # KILL condition was also true...
    assert r["checks"][1]["passed"] is True   # ...but usage-without-impact is checked first


def test_kill_needs_two_consecutive_bad_months():
    assert flag(roi=-0.8, acceptance_rate=0.35, high_usage=False, recent_monthly_rois=[-0.8, -0.9])["flag"] == "KILL"
    assert flag(roi=0.8, acceptance_rate=0.75, high_usage=False, recent_monthly_rois=[1.5, 0.5])["flag"] == "FIX"
    assert flag(roi=0.8, acceptance_rate=0.75, high_usage=False, recent_monthly_rois=[0.5])["flag"] == "FIX"


def test_low_usage_low_acceptance_is_not_usage_without_impact():
    r = flag(roi=1.5, acceptance_rate=0.30, high_usage=False, recent_monthly_rois=[1.5, 1.5])
    assert r["flag"] == "FIX"
    assert not r["checks"][1]["passed"]


def test_override_keeps_auto_flag_visible():
    r = flag(override="KILL")
    assert r["flag"] == "KILL"
    assert r["auto_flag"] == "SCALE"
    assert r["overridden"] is True


# --- spend growth -----------------------------------------------------------
def test_cost_outpacing_value():
    assert m.cost_outpacing_value(0.50, 0.05) is True
    assert m.cost_outpacing_value(0.10, 0.08) is False
    assert m.cost_outpacing_value(-0.2, -0.5) is False
    assert m.pct_change(100, 150) == pytest.approx(0.5)
    assert m.pct_change(0, 10) is None


# --- backlog ----------------------------------------------------------------
def test_score_idea():
    # 2,500 tasks × 6 min ÷ 60 × $38 × 70% = $6,650/mo = $79,800/yr
    # cost: 80 h × $100 + 12 × $150 = $9,800
    s = m.score_idea(2500, 6, 38, 70, 80, 150)
    assert s["est_monthly_value"] == pytest.approx(6650)
    assert s["est_annual_value"] == pytest.approx(79800)
    assert s["est_first_year_cost"] == pytest.approx(9800)
    assert s["priority_score"] == pytest.approx(79800 / 9800)
    assert s["payback_months"] == pytest.approx(8000 / 6500)


def test_score_idea_never_pays_back():
    s = m.score_idea(10, 1, 30, 10, 100, 50)
    assert s["payback_months"] is None


# --- per-run receipt ----------------------------------------------------------
def test_price_run_steps():
    p = m.price_run("edited", 8, 4, 45, 0.03)
    assert p["raw_minutes_saved"] == 4
    assert p["credit"] == 0.5
    assert p["minutes_saved"] == 2
    assert p["value"] == pytest.approx(1.50)
    assert p["net"] == pytest.approx(1.47)


def test_price_run_rejected_is_pure_cost():
    p = m.price_run("rejected", 8, 3, 45, 0.03)
    assert p["value"] == 0 and p["net"] == pytest.approx(-0.03)


# --- funnel -------------------------------------------------------------------
def test_run_funnel():
    f = m.run_funnel({"accepted": 50, "edited": 20, "rejected": 20, "failed": 10})
    assert [s["count"] for s in f] == [100, 90, 70, 50]
    assert f[0]["conversion"] is None
    assert f[2]["conversion"] == pytest.approx(70 / 90)
    assert f[3]["share_of_runs"] == pytest.approx(0.5)
    assert f[2]["drop"] == 20
