import unittest

from riskmule.window import SlidingWindow


class SlidingWindowTest(unittest.TestCase):
    def setUp(self):
        self.window = SlidingWindow(60)

    def test_counts_events_inside_window(self):
        for ts in (10, 20, 30):
            self.window.add("u1", ts, 5)
        self.assertEqual(self.window.count("u1", 40), 3)

    def test_event_inside_window_included(self):
        self.window.add("u1", 10, 5)
        self.assertEqual(self.window.count("u1", 20), 1)

    def test_current_event_is_not_counted(self):
        self.window.add("u1", 30, 5)
        self.assertEqual(self.window.count("u1", 30), 0)

    def test_window_is_per_key(self):
        self.window.add("u1", 10, 5)
        self.window.add("u2", 10, 5)
        self.assertEqual(self.window.count("u1", 20), 1)
        self.assertEqual(self.window.count("u3", 20), 0)

    def test_amount_sums_inside_window(self):
        self.window.add("u1", 1, 100)
        self.window.add("u1", 2, 250.5)
        self.assertAlmostEqual(float(self.window.amount("u1", 10)), 350.5)

    def test_missing_amount_counts_as_zero(self):
        self.window.add("u1", 1, None)
        self.assertAlmostEqual(float(self.window.amount("u1", 2)), 0.0)

    def test_forget_drops_key(self):
        self.window.add("u1", 10, 5)
        self.window.forget("u1")
        self.assertEqual(self.window.count("u1", 20), 0)

    def test_invalid_window_seconds(self):
        with self.assertRaises(ValueError):
            SlidingWindow(0)


if __name__ == "__main__":
    unittest.main()
