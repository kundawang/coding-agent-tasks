import json
import tempfile
import unittest
from pathlib import Path

from pipeline.runner import run_pipeline
from pipeline.spec import load_spec
from pipeline.store import Store

SPEC = Path(__file__).resolve().parents[1] / "specs" / "daily_etl.json"
BROKEN = Path(__file__).resolve().parents[1] / "specs" / "branchy_etl.json"


class RunnerTest(unittest.TestCase):
    def test_runs_stages_in_order_and_persists_results(self):
        pipeline = load_spec(SPEC)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out"
            with Store(Path(tmp) / "state.db") as store:
                report = run_pipeline(pipeline, store, out_dir=out)
                self.assertEqual(report.status, "success")
                self.assertEqual([s.stage_id for s in report.stages][0], "load_orders")
                self.assertEqual(len(store.load_result("by_region")), 3)
                self.assertEqual(store.get_run(report.run_id)["status"], "success")
            self.assertTrue((out / "report.json").exists())

    def test_stage_failure_marks_run_failed(self):
        pipeline = load_spec(BROKEN)
        with tempfile.TemporaryDirectory() as tmp:
            with Store(Path(tmp) / "state.db") as store:
                with self.assertRaises(ValueError):
                    run_pipeline(pipeline, store, out_dir=Path(tmp) / "out")

    def test_report_as_dict(self):
        pipeline = load_spec(SPEC)
        with tempfile.TemporaryDirectory() as tmp:
            with Store(":memory:") as store:
                report = run_pipeline(pipeline, store, out_dir=Path(tmp) / "out")
            payload = report.as_dict()
            self.assertEqual(payload["pipeline"], "daily_etl")
            self.assertEqual(len(payload["stages"]), 5)
            self.assertTrue(all("status" in item for item in payload["stages"]))


if __name__ == "__main__":
    unittest.main()
