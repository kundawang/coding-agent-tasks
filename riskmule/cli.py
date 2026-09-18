"""replay 命令行：按顺序回放事件文件，打印每条事件的决策。"""

import argparse
import json
import sys

from . import ruleset as ruleset_mod
from .engine import Engine

try:  # Windows 控制台默认可能是 cp936，统一按 utf-8 输出
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def read_events(path):
    events = []
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit(f"samples 第 {lineno} 行不是合法 JSON: {exc}") from exc
    return events


def cmd_replay(args):
    rs = ruleset_mod.load(args.ruleset)
    events = read_events(args.events)
    engine = Engine(rs, window_seconds=args.window)

    counts = {"allow": 0, "review": 0, "deny": 0}
    for index, event in enumerate(events, 1):
        engine.observe(event)
        result = engine.decide(event)
        counts[result["decision"]] = counts.get(result["decision"], 0) + 1
        user_id = (event.get("user") or {}).get("id") or "-"
        print(
            f"#{index:<3} t={event['ts']:<4} user={user_id:<8} "
            f"amount={event.get('amount', 0)!s:<10} -> {result['decision']:<6} "
            f"{result['rule_id'] or '-':<20} {result['reason']}"
        )

    print()
    print("汇总:", ", ".join(f"{k}={v}" for k, v in counts.items()))
    print(
        "引擎计数:",
        ", ".join(f"{k}={v}" for k, v in engine.counters.items()),
    )
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="riskmule")
    sub = parser.add_subparsers(dest="cmd", required=True)

    replay = sub.add_parser("replay", help="回放事件文件")
    replay.add_argument("ruleset", help="规则集 JSON 路径")
    replay.add_argument("events", help="事件 JSONL 路径")
    replay.add_argument("--window", type=int, default=60, help="窗口秒数，默认 60")
    replay.set_defaults(func=cmd_replay)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
