"""Tiny SQLite store for gameplay telemetry and the leaderboard.

Stdlib only so it works with zero setup. For the Tiger Data track, swap these
functions for a Postgres/Timescale implementation behind the same signatures.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Any, Dict, List

_lock = threading.Lock()
_conn = None


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        path = os.getenv("DB_PATH", "reality_rift.db")
        _conn = sqlite3.connect(path, check_same_thread=False)
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS events(
              id INTEGER PRIMARY KEY, ts REAL, session TEXT, type TEXT, payload TEXT);
            CREATE TABLE IF NOT EXISTS scores(
              id INTEGER PRIMARY KEY, ts REAL, team TEXT, stars INTEGER, hearts INTEGER,
              outcome TEXT, artifact TEXT);
            """
        )
    return _conn


def reset_for_tests(path: str = ":memory:") -> None:
    global _conn
    os.environ["DB_PATH"] = path
    _conn = None


def log_event(session: str, type_: str, payload: Dict[str, Any]) -> None:
    with _lock:
        _db().execute(
            "INSERT INTO events(ts, session, type, payload) VALUES (?,?,?,?)",
            (time.time(), session, type_, json.dumps(payload)[:2000]),
        )
        _db().commit()


def add_score(team: str, stars: int, hearts: int, outcome: str, artifact: str) -> None:
    with _lock:
        _db().execute(
            "INSERT INTO scores(ts, team, stars, hearts, outcome, artifact) VALUES (?,?,?,?,?,?)",
            (time.time(), team, stars, hearts, outcome, artifact),
        )
        _db().commit()


def leaderboard(limit: int = 10) -> List[Dict[str, Any]]:
    with _lock:
        rows = _db().execute(
            "SELECT team, stars, hearts, outcome, artifact FROM scores "
            "ORDER BY stars + hearts * 2 DESC, ts ASC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(zip(("team", "stars", "hearts", "outcome", "artifact"), r)) for r in rows]


def stats() -> Dict[str, Any]:
    with _lock:
        by_type = dict(_db().execute("SELECT type, COUNT(*) FROM events GROUP BY type").fetchall())
        games = _db().execute("SELECT COUNT(*) FROM scores").fetchone()[0]
    return {"games": games, "events": by_type}
