"""条件表达式求值：把规则集里的 when 树求值成布尔值。"""

from decimal import Decimal, InvalidOperation

# 字段取不到时用它占位，区分"不存在"和"值是 None"
MISSING = object()


class ExpressionError(ValueError):
    """字段缺失、类型不匹配等求值错误。"""


def get_path(context, path):
    """按点分路径取值，取不到返回 MISSING。"""
    current = context
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return MISSING
        current = current[part]
    return current


def to_decimal(value):
    """把 JSON 里读出来的金额/数值统一成 Decimal，避免二进制浮点误差。"""
    if isinstance(value, bool):
        raise ExpressionError("布尔值不能参与数值比较")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ExpressionError(f"不是合法数值: {value!r}") from exc


_NUMERIC_OPS = ("gt", "gte", "lt", "lte")
_EQUALITY_OPS = ("eq", "ne")
_ALL_OPS = _NUMERIC_OPS + _EQUALITY_OPS + (
    "in", "not_in", "startswith", "exists",
)


def compare(actual, op, expected):
    """对单个叶子条件求值。"""
    if op == "exists":
        return actual is not MISSING and actual is not None
    if op not in _ALL_OPS:
        raise ExpressionError(f"不认识的操作符: {op}")
    if actual is MISSING:
        raise ExpressionError("字段缺失")

    if op in _NUMERIC_OPS or op in _EQUALITY_OPS:
        left, right = to_decimal(actual), to_decimal(expected)
        if op == "gt":
            return left > right
        if op == "gte":
            return left >= right
        if op == "lt":
            return left < right
        if op == "lte":
            return left <= right
        if op == "eq":
            return left == right
        return left != right

    if op == "in":
        return actual in expected
    if op == "not_in":
        return actual not in expected
    if op == "startswith":
        if not isinstance(actual, str):
            raise ExpressionError("startswith 需要字符串字段")
        return actual.startswith(expected)
    raise ExpressionError(f"不认识的操作符: {op}")


def evaluate(node, context):
    """递归求值一个 when 节点。"""
    if "all" in node:
        return all([evaluate(child, context) for child in node["all"]])
    if "any" in node:
        return any([evaluate(child, context) for child in node["any"]])
    if "not" in node:
        return not evaluate(node["not"], context)

    field = node.get("field")
    if not field:
        raise ExpressionError(f"非法的条件节点: {node!r}")
    return compare(get_path(context, field), node.get("op"), node.get("value"))
