import json
import tempfile
import unittest
from pathlib import Path

from pipeline.spec import Stage
from pipeline.stages import StageError, run_stage


class FilterTest(unittest.TestCase):
    def test_ops(self):
        rows = [{"n": 1}, {"n": 5}, {"n": 9}]
        stage = Stage("f", "filter", {"field": "n", "op": "gt", "value": 4})
        self.assertEqual([r["n"] for r in run_stage(stage, {"in": rows}, {})], [5, 9])

    def test_contains(self):
        rows = [{"name": "alpha"}, {"name": "beta"}]
        stage = Stage("f", "filter", {"field": "name", "op": "contains", "value": "ph"})
        self.assertEqual(len(run_stage(stage, {"in": rows}, {})), 1)

    def test_rows_missing_field_are_skipped(self):
        rows = [{"n": 1}, {"other": 2}]
        stage = Stage("f", "filter", {"field": "n", "op": "eq", "value": 1})
        self.assertEqual(len(run_stage(stage, {"in": rows}, {})), 1)

    def test_unknown_op(self):
        stage = Stage("f", "filter", {"field": "n", "op": "wat", "value": 1})
        with self.assertRaises(StageError):
            run_stage(stage, {"in": [{"n": 1}]}, {})


class MapTest(unittest.TestCase):
    def test_cast_and_arithmetic(self):
        stage = Stage("m", "map", {"add": {"cents": {"from": "amount", "cast": "float", "mul": 100}}})
        out = run_stage(stage, {"in": [{"amount": "1.5"}]}, {})
        self.assertAlmostEqual(out[0]["cents"], 150.0)

    def test_missing_source_field(self):
        stage = Stage("m", "map", {"add": {"x": {"from": "nope"}}})
        with self.assertRaises(StageError):
            run_stage(stage, {"in": [{"a": 1}]}, {})


class AggregateTest(unittest.TestCase):
    def test_group_and_metrics(self):
        rows = [{"g": "x", "v": 2}, {"g": "x", "v": 4}, {"g": "y", "v": 6}]
        stage = Stage(
            "a",
            "aggregate",
            {"group_by": ["g"], "metrics": {"c": {"fn": "count"}, "s": {"field": "v", "fn": "sum"}}},
        )
        out = run_stage(stage, {"in": rows}, {})
        self.assertEqual(out, [{"g": "x", "c": 2, "s": 6}, {"g": "y", "c": 1, "s": 6}])


class ExportTest(unittest.TestCase):
    def test_json_and_csv(self):
        out_dir = tempfile.mkdtemp()
        rows = [{"a": 1, "b": 2}]
        json_stage = Stage("e", "export", {"path": "x.json", "format": "json"})
        run_stage(json_stage, {"in": rows}, {"out_dir": out_dir})
        self.assertEqual(json.loads((Path(out_dir) / "x.json").read_text(encoding="utf-8")), rows)

        csv_stage = Stage("e", "export", {"path": "x.csv", "format": "csv"})
        run_stage(csv_stage, {"in": rows}, {"out_dir": out_dir})
        self.assertIn("a,b", (Path(out_dir) / "x.csv").read_text(encoding="utf-8"))

    def test_unknown_kind(self):
        with self.assertRaises(StageError):
            run_stage(Stage("x", "nope", {}), {}, {})


if __name__ == "__main__":
    unittest.main()
