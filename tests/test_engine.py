import unittest

from riskmule.engine import Engine


def ruleset(rules, default="allow"):
    return {"version": "test.1", "default_decision": default, "rules": rules}


def rule(rule_id, priority, when, then="deny", reason=""):
    return {"id": rule_id, "priority": priority, "when": when, "then": then, "reason": reason}


def amount_rule(threshold, priority=10, then="deny"):
    return rule(
        "R-AMOUNT",
        priority,
        {"field": "amount", "op": "gt", "value": threshold},
        then,
        "金额超限",
    )


class EngineTest(unittest.TestCase):
    def test_matching_rule_decides(self):
        engine = Engine(ruleset([amount_rule(100)]))
        event = {"ts": 1, "user": {"id": "u1"}, "amount": 500}
        engine.observe(event)
        result = engine.decide(event)
        self.assertEqual(result["decision"], "deny")
        self.assertEqual(result["rule_id"], "R-AMOUNT")

    def test_no_match_falls_back_to_default(self):
        engine = Engine(ruleset([amount_rule(100)]))
        event = {"ts": 1, "user": {"id": "u1"}, "amount": 10}
        engine.observe(event)
        self.assertEqual(engine.decide(event)["decision"], "allow")

    def test_default_decision_can_be_review(self):
        engine = Engine(ruleset([amount_rule(100)], default="review"))
        event = {"ts": 1, "user": {"id": "u1"}, "amount": 10}
        engine.observe(event)
        self.assertEqual(engine.decide(event)["decision"], "review")

    def test_rule_can_read_window_count(self):
        rules = [rule("R-FREQ", 10, {"field": "window.count_60s", "op": "gte", "value": 1})]
        engine = Engine(ruleset(rules))
        first = {"ts": 10, "user": {"id": "u1"}, "amount": 1}
        engine.observe(first)
        self.assertEqual(engine.decide(first)["decision"], "allow")

        second = {"ts": 20, "user": {"id": "u1"}, "amount": 1}
        engine.observe(second)
        self.assertEqual(engine.decide(second)["decision"], "deny")

    def test_rule_with_missing_field_is_skipped(self):
        rules = [rule("R-DEVICE", 10, {"field": "device.risk_score", "op": "gte", "value": 70})]
        engine = Engine(ruleset(rules))
        event = {"ts": 1, "user": {"id": "u1"}, "amount": 1}
        engine.observe(event)
        self.assertEqual(engine.decide(event)["decision"], "allow")
        self.assertEqual(engine.counters["skipped"], 1)

    def test_event_without_user_id_does_not_crash(self):
        engine = Engine(ruleset([amount_rule(100)]))
        event = {"ts": 1, "user": {}, "amount": 10}
        engine.observe(event)
        self.assertIn(engine.decide(event)["decision"], ("allow", "review", "deny"))

    def test_observe_then_decide_sees_previous_events_only(self):
        rules = [rule("R-FREQ", 10, {"field": "window.count_60s", "op": "gte", "value": 2})]
        engine = Engine(ruleset(rules))
        for ts in (10, 20):
            event = {"ts": ts, "user": {"id": "u1"}, "amount": 1}
            engine.observe(event)
            self.assertEqual(engine.decide(event)["decision"], "allow")

        third = {"ts": 30, "user": {"id": "u1"}, "amount": 1}
        engine.observe(third)
        self.assertEqual(engine.decide(third)["decision"], "deny")


if __name__ == "__main__":
    unittest.main()
