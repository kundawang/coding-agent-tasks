import subprocess
import sys
import tempfile
import unittest
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "specs" / "daily_etl.json"


class CliTest(unittest.TestCase):
    def run_cli(self, *args, cwd):
        env = dict(os.environ)
        env["PYTHONPATH"] = str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")
        return subprocess.run(
            [sys.executable, "-m", "pipeline", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
        )

    def test_run_then_dump(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = self.run_cli("run", str(SPEC), "--db", "state.db", "--out", "out", cwd=tmp)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("status: success", proc.stdout)
            self.assertIn("load_orders", proc.stdout)

            proc = self.run_cli("dump", str(SPEC), "--db", "state.db", cwd=tmp)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("by_region", proc.stdout)

    def test_cycle_spec_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = self.run_cli("run", str(ROOT / "specs" / "broken_cycle.json"), cwd=tmp)
            self.assertNotEqual(proc.returncode, 0)


if __name__ == "__main__":
    unittest.main()
