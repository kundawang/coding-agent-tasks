"""执行引擎：按依赖顺序跑完整个管道，并把每个 stage 的结果写进 store。"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .spec import Pipeline, execution_order
from .stages import Row, run_stage
from .store import Store


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


@dataclass
class StageRun:
    stage_id: str
    status: str
    rows: list[Row] = field(default_factory=list)
    message: str = ""


@dataclass
class RunReport:
    run_id: str
    pipeline: str
    stages: list[StageRun]
    status: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "pipeline": self.pipeline,
            "status": self.status,
            "stages": [
                {"stage_id": s.stage_id, "status": s.status, "rows": len(s.rows), "message": s.message}
                for s in self.stages
            ],
        }


def run_pipeline(
    pipeline: Pipeline,
    store: Store,
    out_dir: str | Path = "out",
    run_id: str | None = None,
) -> RunReport:
    run_id = run_id or uuid.uuid4().hex[:12]
    started = now()
    store.start_run(run_id, pipeline.name, started)
    ctx = {"out_dir": str(out_dir), "run_id": run_id, "pipeline": pipeline.name}
    Path(out_dir).mkdir(parents=True, exist_ok=True)

    results: dict[str, list[Row]] = {}
    stage_runs: list[StageRun] = []

    try:
        for stage_id in execution_order(pipeline):
            stage = pipeline.stages[stage_id]
            inputs = {dep: results[dep] for dep in stage.deps}
            rows = run_stage(stage, inputs, ctx)
            results[stage_id] = rows
            store.save_result(stage_id, rows, now())
            stage_runs.append(StageRun(stage_id=stage_id, status="success", rows=rows))
    except Exception:
        store.finish_run(run_id, "failed", now())
        raise

    store.finish_run(run_id, "success", now())
    return RunReport(run_id=run_id, pipeline=pipeline.name, stages=stage_runs, status="success")
