"""内置 stage 实现。每个 stage 都是 list[dict] -> list[dict]。"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Callable


class StageError(RuntimeError):
    """stage 执行失败。"""


Row = dict[str, Any]

_OPS: dict[str, Callable[[Any, Any], bool]] = {
    "eq": lambda a, b: a == b,
    "ne": lambda a, b: a != b,
    "gt": lambda a, b: a > b,
    "lt": lambda a, b: a < b,
    "contains": lambda a, b: b in a,
}

_CASTS: dict[str, Callable[[Any], Any]] = {
    "int": lambda v: int(v),
    "float": lambda v: float(v),
    "str": lambda v: str(v),
}


def _first_input(inputs: dict[str, list[Row]]) -> list[Row]:
    if not inputs:
        return []
    return next(iter(inputs.values()))


def _source(stage, inputs, ctx) -> list[Row]:
    return [dict(row) for row in stage.params.get("rows", [])]


def _filter(stage, inputs, ctx) -> list[Row]:
    rows = _first_input(inputs)
    field = stage.params["field"]
    op = stage.params.get("op", "eq")
    if op not in _OPS:
        raise StageError(f"unknown filter op: {op}")
    value = stage.params.get("value")
    return [row for row in rows if field in row and _OPS[op](row[field], value)]


def _map(stage, inputs, ctx) -> list[Row]:
    rows = _first_input(inputs)
    spec = stage.params.get("add", {})
    out = []
    for row in rows:
        new = dict(row)
        for name, rule in spec.items():
            source_field = rule.get("from", name)
            if source_field not in row:
                raise StageError(f"map: field '{source_field}' missing for new column '{name}'")
            value = row[source_field]
            cast = rule.get("cast")
            if cast:
                if cast not in _CASTS:
                    raise StageError(f"unknown cast: {cast}")
                value = _CASTS[cast](value)
            if "mul" in rule:
                value = float(value) * float(rule["mul"])
            if "add" in rule:
                value = float(value) + float(rule["add"])
            new[name] = value
        out.append(new)
    return out


def _aggregate(stage, inputs, ctx) -> list[Row]:
    rows = _first_input(inputs)
    group_by = stage.params.get("group_by", [])
    metrics = stage.params.get("metrics", {})
    buckets: dict[tuple, list[Row]] = {}
    order: list[tuple] = []
    for row in rows:
        key = tuple(row.get(field) for field in group_by)
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(row)

    out: list[Row] = []
    for key in order:
        group = buckets[key]
        result: Row = {}
        for field, value in zip(group_by, key):
            result[field] = value
        for name, rule in metrics.items():
            fn = rule.get("fn", "count")
            field = rule.get("field")
            if fn == "count":
                result[name] = len(group)
            elif fn == "sum":
                result[name] = sum(row.get(field, 0) for row in group)
            elif fn == "avg":
                values = [row.get(field, 0) for row in group]
                result[name] = sum(values) / len(values) if values else 0
            else:
                raise StageError(f"unknown aggregate fn: {fn}")
        out.append(result)
    return out


def _export(stage, inputs, ctx) -> list[Row]:
    rows = _first_input(inputs)
    relative = stage.params.get("path")
    if not relative:
        raise StageError("export requires a path")
    fmt = stage.params.get("format", "json")
    target = Path(ctx["out_dir"]) / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "json":
        target.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    elif fmt == "csv":
        fields = list(rows[0].keys()) if rows else []
        with target.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
    else:
        raise StageError(f"unknown export format: {fmt}")
    return rows


_HANDLERS = {
    "source": _source,
    "filter": _filter,
    "map": _map,
    "aggregate": _aggregate,
    "export": _export,
}


def run_stage(stage, inputs: dict[str, list[Row]], ctx: dict[str, Any]) -> list[Row]:
    handler = _HANDLERS.get(stage.kind)
    if handler is None:
        raise StageError(f"unknown stage kind: {stage.kind}")
    return handler(stage, inputs, ctx)
