import unittest

from riskmule import expr


class GetPathTest(unittest.TestCase):
    def test_reads_nested_value(self):
        context = {"user": {"card": {"number": "6217001234567890"}}}
        self.assertEqual(expr.get_path(context, "user.card.number"), "6217001234567890")

    def test_missing_path(self):
        self.assertIs(expr.get_path({"user": {}}, "user.card.number"), expr.MISSING)

    def test_none_is_a_real_value(self):
        self.assertIsNone(expr.get_path({"card": None}, "card"))


class CompareTest(unittest.TestCase):
    def test_numeric_operators(self):
        self.assertTrue(expr.compare(10, "gt", 9))
        self.assertTrue(expr.compare(10, "gte", 10))
        self.assertTrue(expr.compare(9, "lt", 10))
        self.assertTrue(expr.compare(10, "lte", 10))
        self.assertTrue(expr.compare(10, "eq", 10))
        self.assertTrue(expr.compare(10, "ne", 11))
        self.assertFalse(expr.compare(9, "gt", 10))

    def test_two_decimal_amounts_compare_exactly(self):
        self.assertTrue(expr.compare("1233.76", "eq", 1233.76))

    def test_membership(self):
        self.assertTrue(expr.compare("h5", "in", ["h5", "miniapp"]))
        self.assertTrue(expr.compare("app", "not_in", ["h5", "miniapp"]))

    def test_startswith(self):
        self.assertTrue(expr.compare("621700", "startswith", "62"))
        with self.assertRaises(expr.ExpressionError):
            expr.compare(621700, "startswith", "62")

    def test_exists(self):
        self.assertTrue(expr.compare("value", "exists", None))
        self.assertFalse(expr.compare(expr.MISSING, "exists", None))

    def test_missing_field_raises(self):
        with self.assertRaises(expr.ExpressionError):
            expr.compare(expr.MISSING, "gt", 1)

    def test_unknown_operator_raises(self):
        with self.assertRaises(expr.ExpressionError):
            expr.compare(1, "roughly", 1)

    def test_bool_is_not_a_number(self):
        with self.assertRaises(expr.ExpressionError):
            expr.compare(True, "gt", 0)


class EvaluateTest(unittest.TestCase):
    def setUp(self):
        self.context = {
            "amount": 9000,
            "channel": "h5",
            "user": {"level": "normal", "age_days": 30},
            "device": {"risk_score": 85},
        }

    def test_all_node(self):
        node = {"all": [
            {"field": "amount", "op": "gt", "value": 5000},
            {"field": "channel", "op": "in", "value": ["h5"]},
        ]}
        self.assertTrue(expr.evaluate(node, self.context))

    def test_any_node(self):
        node = {"any": [
            {"field": "channel", "op": "in", "value": ["app"]},
            {"field": "device.risk_score", "op": "gte", "value": 70},
        ]}
        self.assertTrue(expr.evaluate(node, self.context))

    def test_not_node(self):
        node = {"not": {"field": "user.level", "op": "in", "value": ["vip"]}}
        self.assertTrue(expr.evaluate(node, self.context))

    def test_nested_nodes(self):
        node = {"all": [
            {"field": "amount", "op": "gt", "value": 5000},
            {"any": [
                {"field": "user.level", "op": "in", "value": ["vip"]},
                {"field": "device.risk_score", "op": "gte", "value": 70},
            ]},
        ]}
        self.assertTrue(expr.evaluate(node, self.context))

    def test_illegal_node_raises(self):
        with self.assertRaises(expr.ExpressionError):
            expr.evaluate({"op": "gt", "value": 1}, self.context)


if __name__ == "__main__":
    unittest.main()
