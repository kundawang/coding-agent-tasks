"""命令行入口：python -m pipeline run <spec> [--db ...] [--out ...]"""

from __future__ import annotations

import argparse
import json
import sys

from .runner import run_pipeline
from .spec import SpecError, load_spec
from .store import Store


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pipeline", description="按依赖顺序执行数据处理管道")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="执行一个管道")
    run.add_argument("spec")
    run.add_argument("--db", default=".pipeline/state.db")
    run.add_argument("--out", default="out")

    dump = sub.add_parser("dump", help="打印状态库里已保存的 stage 结果")
    dump.add_argument("spec")
    dump.add_argument("--db", default=".pipeline/state.db")
    return parser


def cmd_run(args) -> int:
    pipeline = load_spec(args.spec)
    with Store(args.db) as store:
        report = run_pipeline(pipeline, store, out_dir=args.out)
    print(f"run {report.run_id} pipeline={report.pipeline}")
    for stage in report.stages:
        print(f"  {stage.stage_id:<16} {stage.status:<8} rows={len(stage.rows)}")
    print(f"status: {report.status}")
    return 0


def cmd_dump(args) -> int:
    pipeline = load_spec(args.spec)
    with Store(args.db) as store:
        for stage_id, updated_at, payload in store.list_results():
            rows = json.loads(payload)
            print(f"{stage_id:<16} updated={updated_at} rows={len(rows)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "run":
            return cmd_run(args)
        if args.command == "dump":
            return cmd_dump(args)
    except SpecError as exc:
        print(f"spec error: {exc}", file=sys.stderr)
        return 2
    return 1
