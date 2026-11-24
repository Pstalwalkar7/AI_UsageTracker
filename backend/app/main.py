"""FastAPI app. Thin HTTP layer over service.py; serves the built frontend in production."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, metrics as m, seed as seeder, service

app = FastAPI(title="AI Impact Tracker", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

conn = db.connect()
db.init_db(conn)
if db.is_empty(conn) or db.is_outdated(conn):
    seeder.seed(conn)


# ---------------------------------------------------------------------------
# Response cache. Data only changes through this app's own write endpoints, so
# every GET /api/* response is cached until the next write clears it.
# ---------------------------------------------------------------------------
_cache: dict[str, tuple[int, bytes, str]] = {}
READ_ONLY_POSTS = {"/api/runs/preview", "/api/ideas/score"}  # POSTs that compute but don't write


@app.middleware("http")
async def api_cache(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/"):
        resp = await call_next(request)
        if path.startswith("/assets/"):  # Vite file names are content-hashed
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp

    if request.method != "GET":
        resp = await call_next(request)
        if path not in READ_ONLY_POSTS:
            _cache.clear()
        return resp

    key = f"{path}?{request.url.query}"
    if key in _cache:
        status, body, ctype = _cache[key]
        return Response(body, status_code=status, media_type=ctype, headers={"X-Cache": "HIT"})
    resp = await call_next(request)
    if resp.status_code != 200:
        return resp
    body = b"".join([chunk async for chunk in resp.body_iterator])
    ctype = resp.headers.get("content-type", "application/json")
    _cache[key] = (200, body, ctype)
    return Response(body, status_code=200, media_type=ctype, headers={"X-Cache": "MISS"})


def _warm_cache() -> None:
    """Request every screen once after startup so the first visitor gets cached responses."""
    import time
    import urllib.request

    base = f"http://127.0.0.1:{os.environ.get('PORT', '8000')}"
    for _ in range(60):  # wait for uvicorn to accept connections
        try:
            urllib.request.urlopen(f"{base}/api/meta", timeout=5).read()
            break
        except OSError:
            time.sleep(0.5)
    tool_ids = [r[0] for r in conn.execute("SELECT id FROM tools ORDER BY id")]
    paths = ["/api/ideas"]
    for r in ("6m", "3m", "1m"):  # 6m is the default range, so warm it first
        paths += [f"/api/{p}?range={r}" for p in ("summary", "tools", "spend", "departments")]
        paths += [f"/api/tools/{i}?range={r}" for i in tool_ids]
    for p in paths:
        try:
            urllib.request.urlopen(base + p, timeout=60).read()
        except OSError:
            pass


@app.on_event("startup")
async def _start_warmup() -> None:
    if os.environ.get("WARM_CACHE") == "1":
        import threading
        threading.Thread(target=_warm_cache, daemon=True).start()


# Added last so it wraps everything, cached responses included (the JS bundle is ~785 KB raw, ~220 KB gzipped).
app.add_middleware(GZipMiddleware, minimum_size=1024)

RangeQ = Query(service.DEFAULT_RANGE, pattern="^(1m|3m|6m)$")
Outcome = Literal["accepted", "edited", "rejected", "failed"]
Flag = Literal["SCALE", "FIX", "KILL", "WATCH"]


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------
@app.get("/api/meta")
async def meta():
    return {
        "as_of": service.as_of(conn).isoformat(),
        "ranges": service.RANGES,
        "departments": [dict(r) for r in conn.execute("SELECT id, name FROM departments ORDER BY name")],
        "tools": [dict(r) for r in conn.execute("SELECT id, name, department_id FROM tools ORDER BY name")],
        "models": [r[0] for r in conn.execute("SELECT DISTINCT model_name FROM runs ORDER BY 1")],
        "rules": {
            "value_weight": m.VALUE_WEIGHT,
            "scale_min_roi": m.SCALE_MIN_ROI,
            "scale_min_acceptance": m.SCALE_MIN_ACCEPTANCE,
            "kill_max_roi": m.KILL_MAX_ROI,
            "kill_consecutive_months": m.KILL_CONSECUTIVE_MONTHS,
            "low_acceptance": m.LOW_ACCEPTANCE,
            "watch_min_days": m.WATCH_MIN_DAYS,
            "high_usage_top_fraction": m.HIGH_USAGE_TOP_FRACTION,
            "build_amortization_days": m.BUILD_AMORTIZATION_DAYS,
            "engineer_hourly_rate": m.ENGINEER_HOURLY_RATE,
            "failure_reasons": m.FAILURE_REASONS,
        },
    }


@app.get("/api/summary")
async def get_summary(range: str = RangeQ):
    return service.summary(conn, range)


@app.get("/api/tools")
async def get_tools(range: str = RangeQ):
    return service.portfolio(conn, range)


@app.get("/api/tools/{tool_id}")
async def get_tool(tool_id: int, range: str = RangeQ):
    d = service.tool_detail(conn, tool_id, range)
    if not d:
        raise HTTPException(404, "tool not found")
    return d


@app.get("/api/departments")
async def get_departments(range: str = RangeQ):
    return service.departments(conn, range)


@app.get("/api/spend")
async def get_spend(range: str = RangeQ):
    return service.spend(conn, range)


@app.get("/api/ideas")
async def get_ideas():
    return service.list_ideas(conn)


# ---------------------------------------------------------------------------
# Write endpoints
# ---------------------------------------------------------------------------
class RunIn(BaseModel):
    tool_id: int
    human_minutes_with_ai: float = Field(ge=0, le=24 * 60)
    api_cost_usd: float = Field(ge=0, le=1000)
    model_name: str = Field(min_length=1, max_length=80)
    outcome: Outcome
    failure_reason: Optional[str] = Field(default=None, max_length=80)
    user_department_id: Optional[int] = None   # defaults to the tool's department
    user_id: Optional[int] = None              # anonymous employee id, enables adoption metrics
    timestamp: Optional[datetime] = None       # defaults to now (UTC)


def _price(t, run: RunIn) -> dict:
    p = m.price_run(run.outcome, t["baseline_minutes_per_task"], run.human_minutes_with_ai,
                    t["loaded_hourly_rate"], run.api_cost_usd)
    return p | {"tool_id": t["id"], "tool": t["name"]}


@app.post("/api/runs/preview")
async def preview_run(run: RunIn):
    """Price a run without saving it (powers the live receipt on Log a Run)."""
    t = conn.execute("SELECT * FROM tools WHERE id=?", (run.tool_id,)).fetchone()
    if not t:
        raise HTTPException(404, "tool not found")
    return _price(t, run)


@app.post("/api/runs", status_code=201)
async def post_run(run: RunIn):
    """The integration point: every internal AI tool calls this once per run."""
    t = conn.execute("SELECT * FROM tools WHERE id=?", (run.tool_id,)).fetchone()
    if not t:
        raise HTTPException(404, "tool not found")
    dept = run.user_department_id or t["department_id"]
    if not conn.execute("SELECT 1 FROM departments WHERE id=?", (dept,)).fetchone():
        raise HTTPException(422, "unknown user_department_id")
    if run.outcome in ("rejected", "failed") and not run.failure_reason:
        run.failure_reason = "user_rejected" if run.outcome == "rejected" else "bad_input"
    if run.outcome in ("accepted", "edited"):
        run.failure_reason = None
    ts = (run.timestamp or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(tzinfo=None, microsecond=0)
    cur = conn.execute(
        """INSERT INTO runs(tool_id, timestamp, user_department_id, user_id, human_minutes_with_ai, api_cost_usd,
               model_name, outcome, failure_reason) VALUES (?,?,?,?,?,?,?,?,?)""",
        (run.tool_id, ts.isoformat(), dept, run.user_id, run.human_minutes_with_ai, run.api_cost_usd,
         run.model_name, run.outcome, run.failure_reason))
    conn.commit()
    baseline, rate = t["baseline_minutes_per_task"], t["loaded_hourly_rate"]
    minutes = m.run_minutes_saved(run.outcome, baseline, run.human_minutes_with_ai)
    value = m.minutes_to_value(minutes, rate)
    return _price(t, run) | {
        "id": cur.lastrowid,
        "timestamp": ts.isoformat(),
        "minutes_saved": minutes,
        "value_usd": value,
        "api_cost_usd": run.api_cost_usd,
        "explanation": (
            f"{m.VALUE_WEIGHT[run.outcome]:.0%} weight ({run.outcome}) × ({baseline:g} baseline min − "
            f"{run.human_minutes_with_ai:g} human min) = {minutes:.2f} min saved; "
            f"{minutes:.2f} ÷ 60 × ${rate:g}/hr = ${value:.2f} value, against ${run.api_cost_usd:.4f} API cost."
        ),
    }


class ToolPatch(BaseModel):
    baseline_minutes_per_task: Optional[float] = Field(default=None, gt=0, le=24 * 60)
    loaded_hourly_rate: Optional[float] = Field(default=None, gt=0, le=2000)
    build_cost: Optional[float] = Field(default=None, ge=0)
    monthly_fixed_cost: Optional[float] = Field(default=None, ge=0)
    status_override: Optional[Flag] = None
    clear_override: bool = False


@app.patch("/api/tools/{tool_id}")
async def patch_tool(tool_id: int, patch: ToolPatch, range: str = RangeQ):
    if not conn.execute("SELECT 1 FROM tools WHERE id=?", (tool_id,)).fetchone():
        raise HTTPException(404, "tool not found")
    fields = patch.model_dump(exclude_none=True, exclude={"clear_override"})
    if patch.clear_override:
        fields["status_override"] = None
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE tools SET {sets} WHERE id=?", (*fields.values(), tool_id))
        conn.commit()
    return service.tool_detail(conn, tool_id, range)


class IdeaIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    department_id: int
    tasks_per_month: float = Field(gt=0)
    minutes_saved_per_task: float = Field(gt=0)
    hourly_rate: float = Field(gt=0)
    expected_adoption_pct: float = Field(gt=0, le=100)
    build_hours: float = Field(ge=0)
    est_monthly_api_cost: float = Field(ge=0)


@app.post("/api/ideas/score")
async def score_idea(idea: IdeaIn):
    """Preview a score without saving (powers the live form)."""
    d = idea.model_dump()
    d.pop("name"); d.pop("department_id")
    return m.score_idea(**d)


@app.post("/api/ideas", status_code=201)
async def post_idea(idea: IdeaIn):
    if not conn.execute("SELECT 1 FROM departments WHERE id=?", (idea.department_id,)).fetchone():
        raise HTTPException(422, "unknown department_id")
    d = idea.model_dump()
    cur = conn.execute(f"INSERT INTO ideas({', '.join(d)}) VALUES ({', '.join('?' * len(d))})", tuple(d.values()))
    conn.commit()
    ideas = service.list_ideas(conn)
    return {"created": next(i for i in ideas if i["id"] == cur.lastrowid), "ideas": ideas}


@app.delete("/api/ideas/{idea_id}", status_code=204)
async def delete_idea(idea_id: int):
    conn.execute("DELETE FROM ideas WHERE id=?", (idea_id,))
    conn.commit()


@app.post("/api/admin/reset")
async def reset():
    """Re-seed demo data (dates are regenerated relative to today)."""
    return seeder.seed(conn)


# ---------------------------------------------------------------------------
# Static frontend (production build)
# ---------------------------------------------------------------------------
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        f = STATIC_DIR / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(STATIC_DIR / "index.html")
