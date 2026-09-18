import tempfile
import unittest
from pathlib import Path

from pipeline.store import Store

FIXTURE = Path(__file__).parent / "fixtures" / "legacy_state.db"


class StoreTest(unittest.TestCase):
    def test_save_and_load(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "state.db"
            with Store(db) as store:
                store.save_result("a", [{"x": 1}], "2026-01-01T00:00:00")
                self.assertEqual(store.load_result("a"), [{"x": 1}])
                self.assertIsNone(store.load_result("missing"))

            # 重新打开同一个库，数据还在
            with Store(db) as store:
                self.assertEqual(store.load_result("a"), [{"x": 1}])

    def test_save_overwrites_previous_result(self):
        with Store(":memory:") as store:
            store.save_result("a", [{"x": 1}], "t1")
            store.save_result("a", [{"x": 2}], "t2")
            self.assertEqual(store.load_result("a"), [{"x": 2}])
            self.assertEqual(len(store.list_results()), 1)

    def test_run_lifecycle(self):
        with Store(":memory:") as store:
            store.start_run("r1", "demo", "t0")
            self.assertEqual(store.get_run("r1")["status"], "running")
            store.finish_run("r1", "success", "t1")
            self.assertEqual(store.get_run("r1")["status"], "success")
            self.assertEqual(store.get_run("r1")["finished_at"], "t1")

    def test_opens_legacy_database_file(self):
        """线上库文件是旧版本建的，升级后必须还能打开并读出历史结果。"""
        self.assertTrue(FIXTURE.exists(), f"缺少历史库文件: {FIXTURE}")
        with Store(FIXTURE) as store:
            rows = store.load_result("load_orders")
            self.assertIsNotNone(rows)
            self.assertGreater(len(rows), 0)
            self.assertIn("stage_id", store.schema_columns("stage_results"))
            self.assertIn("payload", store.schema_columns("stage_results"))


if __name__ == "__main__":
    unittest.main()
