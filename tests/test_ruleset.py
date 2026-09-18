import json
import tempfile
import unittest
from pathlib import Path

from riskmule import ruleset


def make_ruleset(**overrides):
    data = {
        "version": "test.1",
        "default_decision": "allow",
        "rules": [
            {
                "id": "R1",
                "priority": 10,
                "when": {"field": "amount", "op": "gt", "value": 100},
                "then": "deny",
                "reason": "大额",
            }
        ],
    }
    data.update(overrides)
    return data


class RulesetParseTest(unittest.TestCase):
    def test_parses_valid_ruleset(self):
        parsed = ruleset.parse(make_ruleset())
        self.assertEqual(parsed["version"], "test.1")
        self.assertEqual(len(parsed["rules"]), 1)

    def test_default_decision_defaults_to_allow(self):
        data = make_ruleset()
        del data["default_decision"]
        self.assertEqual(ruleset.parse(data)["default_decision"], "allow")

    def test_requires_rules_key(self):
        with self.assertRaises(ruleset.RuleSetError):
            ruleset.parse({"version": "x"})

    def test_requires_rule_fields(self):
        data = make_ruleset()
        del data["rules"][0]["when"]
        with self.assertRaises(ruleset.RuleSetError):
            ruleset.parse(data)

    def test_rejects_unknown_decision(self):
        data = make_ruleset()
        data["rules"][0]["then"] = "block"
        with self.assertRaises(ruleset.RuleSetError):
            ruleset.parse(data)

    def test_rejects_unknown_default_decision(self):
        with self.assertRaises(ruleset.RuleSetError):
            ruleset.parse(make_ruleset(default_decision="block"))

    def test_load_reads_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ruleset.json"
            path.write_text(json.dumps(make_ruleset()), encoding="utf-8")
            parsed = ruleset.load(str(path))
            self.assertEqual(parsed["rules"][0]["id"], "R1")


if __name__ == "__main__":
    unittest.main()
