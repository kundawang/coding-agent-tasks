"""SQLite 结果存储：每个 stage 的最新结果、以及每次运行的状态。

线上已经有历史库文件（旧版本建的），打开时必须能继续用。
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS stage_results (
    stage_id   TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    run_id      TEXT PRIMARY KEY,
    pipeline    TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path)
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    # ---------------------------------------------------------------- stages
    def save_result(self, stage_id: str, rows: list[dict[str, Any]], updated_at: str) -> None:
        self._conn.execute(
            "INSERT INTO stage_results (stage_id, payload, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(stage_id) DO UPDATE SET payload = excluded.payload, "
            "updated_at = excluded.updated_at",
            (stage_id, json.dumps(rows, ensure_ascii=False), updated_at),
        )
        self._conn.commit()

    def load_result(self, stage_id: str) -> list[dict[str, Any]] | None:
        row = self._conn.execute(
            "SELECT payload FROM stage_results WHERE stage_id = ?", (stage_id,)
        ).fetchone()
        if row is None:
            return None
        return json.loads(row[0])

    def list_results(self) -> list[tuple[str, str, str]]:
        return list(
            self._conn.execute(
                "SELECT stage_id, updated_at, payload FROM stage_results ORDER BY stage_id"
            )
        )

    # ------------------------------------------------------------------ runs
    def start_run(self, run_id: str, pipeline: str, started_at: str) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO runs (run_id, pipeline, started_at, finished_at, status) "
            "VALUES (?, ?, ?, NULL, 'running')",
            (run_id, pipeline, started_at),
        )
        self._conn.commit()

    def finish_run(self, run_id: str, status: str, finished_at: str) -> None:
        self._conn.execute(
            "UPDATE runs SET status = ?, finished_at = ? WHERE run_id = ?",
            (status, finished_at, run_id),
        )
        self._conn.commit()

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT run_id, pipeline, started_at, finished_at, status FROM runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if row is None:
            return None
        keys = ("run_id", "pipeline", "started_at", "finished_at", "status")
        return dict(zip(keys, row))

    def schema_columns(self, table: str) -> list[str]:
        return [row[1] for row in self._conn.execute(f"PRAGMA table_info({table})")]

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()
