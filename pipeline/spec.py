"""管道定义：解析 JSON spec，校验引用关系，推导执行顺序。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class SpecError(ValueError):
    """spec 本身有问题（字段缺失、引用不存在、依赖成环等）。"""


@dataclass(frozen=True)
class Stage:
    id: str
    kind: str
    params: dict[str, Any]
    deps: tuple[str, ...] = ()


@dataclass(frozen=True)
class Pipeline:
    name: str
    stages: dict[str, Stage]

    def stage(self, stage_id: str) -> Stage:
        return self.stages[stage_id]


def load_spec(path: str | Path) -> Pipeline:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    stages: dict[str, Stage] = {}
    for item in raw.get("stages", []):
        stage_id = item["id"]
        if stage_id in stages:
            raise SpecError(f"duplicate stage id: {stage_id}")
        stages[stage_id] = Stage(
            id=stage_id,
            kind=item["kind"],
            params=item.get("params", {}),
            deps=tuple(item.get("deps", ())),
        )
    if not stages:
        raise SpecError("spec has no stages")
    for stage in stages.values():
        for dep in stage.deps:
            if dep not in stages:
                raise SpecError(f"stage '{stage.id}' depends on unknown stage '{dep}'")
    return Pipeline(name=raw.get("name", "pipeline"), stages=stages)


def execution_order(pipeline: Pipeline) -> list[str]:
    """按依赖关系返回执行顺序；同一层的 stage 按 id 排序，保证结果稳定。"""
    done: list[str] = []
    remaining = dict(pipeline.stages)
    while remaining:
        ready = [
            stage_id
            for stage_id, stage in remaining.items()
            if all(dep in done for dep in stage.deps)
        ]
        if not ready:
            raise SpecError("cannot determine execution order")
        for stage_id in sorted(ready):
            done.append(stage_id)
            remaining.pop(stage_id)
    return done
