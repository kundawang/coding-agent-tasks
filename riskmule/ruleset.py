"""规则集加载与校验。"""

import json

REQUIRED_RULE_KEYS = ("id", "priority", "when", "then")
VALID_DECISIONS = ("allow", "review", "deny")


class RuleSetError(ValueError):
    """规则集不合法。"""


def load(path):
    """读规则集文件，校验必要字段，返回排好序的规则集。"""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    return parse(data)


def parse(data):
    if not isinstance(data, dict) or "rules" not in data:
        raise RuleSetError("规则集必须是一个带 rules 的对象")
    default = data.get("default_decision", "allow")
    if default not in VALID_DECISIONS:
        raise RuleSetError(f"default_decision 不合法: {default!r}")

    for rule in data["rules"]:
        for key in REQUIRED_RULE_KEYS:
            if key not in rule:
                raise RuleSetError(f"规则 {rule.get('id')!r} 缺少字段 {key}")
        if rule["then"] not in VALID_DECISIONS:
            raise RuleSetError(f"规则 {rule['id']} 的 then 不合法: {rule['then']!r}")

    data["default_decision"] = default
    data["rules"].sort(key=lambda rule: rule["priority"])
    return data
