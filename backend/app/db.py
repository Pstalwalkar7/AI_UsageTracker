"""SQLite schema and connection helper. Plain sqlite3, no ORM."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "impact.db"
DB_PATH = Path(os.environ.get("DB_PATH", DEFAULT_DB))

SCHEMA = """
CREATE TABLE IF NOT EXISTS departments (
    id                      INTEGER PRIMARY KEY,
    name                    TEXT NOT NULL UNIQUE,
    headcount               INTEGER NOT NULL,
    manual_hours_per_month  REAL NOT NULL   -- estimate of repetitive, automatable work
);

CREATE TABLE IF NOT EXISTS tools (
    id                         INTEGER PRIMARY KEY,
    name                       TEXT NOT NULL UNIQUE,
    description                TEXT NOT NULL,
    owner                      TEXT NOT NULL,
    department_id              INTEGER NOT NULL REFERENCES departments(id),
    launch_date                TEXT NOT NULL,      -- YYYY-MM-DD
    baseline_minutes_per_task  REAL NOT NULL,      -- manual time before AI
    loaded_hourly_rate         REAL NOT NULL,      -- $/hr of the people doing the task
    build_cost                 REAL NOT NULL,      -- one-time, amortized over 12 months
    monthly_fixed_cost         REAL NOT NULL,      -- licenses, hosting
    status_override            TEXT CHECK (status_override IN ('SCALE','FIX','KILL','WATCH'))
);

CREATE TABLE IF NOT EXISTS runs (
    id                    INTEGER PRIMARY KEY,
    tool_id               INTEGER NOT NULL REFERENCES tools(id),
    timestamp             TEXT NOT NULL,           -- ISO-8601 UTC, YYYY-MM-DDTHH:MM:SS
    user_department_id    INTEGER NOT NULL REFERENCES departments(id),
    user_id               INTEGER,                 -- anonymous employee id (for adoption); optional
    human_minutes_with_ai REAL NOT NULL,
    api_cost_usd          REAL NOT NULL,
    model_name            TEXT NOT NULL,
    outcome               TEXT NOT NULL CHECK (outcome IN ('accepted','edited','rejected','failed')),
    failure_reason        TEXT
);
CREATE INDEX IF NOT EXISTS ix_runs_tool_time ON runs(tool_id, timestamp);
CREATE INDEX IF NOT EXISTS ix_runs_time ON runs(timestamp);

CREATE TABLE IF NOT EXISTS ideas (
    id                      INTEGER PRIMARY KEY,
    name                    TEXT NOT NULL,
    department_id           INTEGER NOT NULL REFERENCES departments(id),
    tasks_per_month         REAL NOT NULL,
    minutes_saved_per_task  REAL NOT NULL,
    hourly_rate             REAL NOT NULL,
    expected_adoption_pct   REAL NOT NULL,
    build_hours             REAL NOT NULL,
    est_monthly_api_cost    REAL NOT NULL
);
"""


def connect(path: Path = None) -> sqlite3.Connection:
    p = Path(path or DB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def is_empty(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT COUNT(*) FROM tools").fetchone()[0] == 0


def is_outdated(conn: sqlite3.Connection) -> bool:
    """A database created before the user_id column existed needs a re-seed."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(runs)")}
    return "user_id" not in cols
