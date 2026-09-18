import json
import tempfile
import unittest
from pathlib import Path

from pipeline.spec import SpecError, execution_order, load_spec


def write_spec(payload: dict) -> Path:
    tmp = Path(tempfile.mkdtemp()) / "spec.json"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    return tmp


class LoadSpecTest(unittest.TestCase):
    def test_loads_stages_and_order(self):
        path = write_spec(
            {
                "name": "demo",
                "stages": [
                    {"id": "b", "kind": "filter", "deps": ["a"], "params": {}},
                    {"id": "a", "kind": "source", "params": {"rows": []}},
                ],
            }
        )
        pipeline = load_spec(path)
        self.assertEqual(pipeline.name, "demo")
        self.assertEqual(execution_order(pipeline), ["a", "b"])

    def test_duplicate_stage_id(self):
        path = write_spec(
            {"stages": [{"id": "a", "kind": "source"}, {"id": "a", "kind": "source"}]}
        )
        with self.assertRaises(SpecError):
            load_spec(path)

    def test_unknown_dependency(self):
        path = write_spec({"stages": [{"id": "a", "kind": "filter", "deps": ["nope"]}]})
        with self.assertRaises(SpecError):
            load_spec(path)

    def test_empty_spec(self):
        with self.assertRaises(SpecError):
            load_spec(write_spec({"stages": []}))

    def test_cycle_is_rejected(self):
        path = write_spec(
            {
                "stages": [
                    {"id": "a", "kind": "source", "deps": ["c"]},
                    {"id": "b", "kind": "filter", "deps": ["a"]},
                    {"id": "c", "kind": "map", "deps": ["b"]},
                ]
            }
        )
        with self.assertRaises(SpecError):
            execution_order(load_spec(path))


if __name__ == "__main__":
    unittest.main()
