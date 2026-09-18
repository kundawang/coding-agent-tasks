"""编排：事件 -> 决策。"""

from . import expr
from .window import SlidingWindow


class Engine:
    def __init__(self, ruleset, window_seconds=60):
        self.ruleset = ruleset
        self.window = SlidingWindow(window_seconds)
        self.counters = {"decided": 0, "skipped": 0}

    def observe(self, event):
        """把事件记进滑动窗口。要在 decide 之前调用，当前这条才会进窗口统计。"""
        user_id = (event.get("user") or {}).get("id")
        self.window.add(user_id, event["ts"], event.get("amount", 0))

    def decide(self, event):
        decision = {
            "decision": self.ruleset.get("default_decision", "allow"),
            "rule_id": None,
            "reason": "没有规则命中",
        }

        for rule in self.ruleset["rules"]:
            try:
                matched = expr.evaluate(rule["when"], self._context(event))
            except expr.ExpressionError:
                self.counters["skipped"] += 1
                continue
            if matched:
                decision = {
                    "decision": rule["then"],
                    "rule_id": rule["id"],
                    "reason": rule.get("reason", ""),
                }
                break

        self.counters["decided"] += 1
        return dict(decision)

    def _context(self, event):
        context = dict(event)
        user = dict(event.get("user") or {})
        context["user"] = user
        user_id = user.get("id")
        now = event["ts"]
        context["window"] = {
            "count_60s": self.window.count(user_id, now),
            "amount_60s": self.window.amount(user_id, now),
        }
        return context
