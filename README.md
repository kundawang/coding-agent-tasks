# riskmule

内部风控规则引擎。把风控同学写的规则集（JSON）加载进来，对下单事件逐条求值，
输出 `allow` / `review` / `deny` 三类决策。

没有第三方依赖，Python 3.10+ 直接跑。

## 快速开始

```bash
python -m riskmule replay samples/ruleset.json samples/events.jsonl
python -m unittest discover -s tests -v
```

`replay` 会按顺序把 events.jsonl 里的事件喂给引擎，逐条打印决策和命中的规则。

## 规则集格式

```json
{
  "version": "2026-09-18.1",
  "default_decision": "allow",
  "rules": [
    {
      "id": "R-DENY-AMOUNT",
      "priority": 90,
      "when": {"all": [
        {"field": "amount", "op": "gt", "value": 5000},
        {"field": "channel", "op": "in", "value": ["h5", "miniapp"]}
      ]},
      "then": "deny",
      "reason": "非可信渠道大额"
    }
  ]
}
```

### 求值语义

- `when` 是一棵布尔树，节点可以是 `{"all": [...]}`、`{"any": [...]}`、`{"not": {...}}`，
  叶子是 `{"field": <点分路径>, "op": ..., "value": ...}`。
- 操作符：`gt` `gte` `lt` `lte` `eq` `ne` `in` `not_in` `startswith` `exists`。
- **规则按 `priority` 从高到低依次求值，命中即返回，不再看后面的规则。**
  所有规则都没命中时返回 `default_decision`。
- `field` 是点分路径，从事件对象上取值，例如 `user.id`、`user.card.number`、
  `window.count_60s`。

### 滑动窗口

引擎对每个用户维护一个滑动窗口，规则里可以用两个派生字段：

| 字段 | 含义 |
|---|---|
| `window.count_60s` | 该用户近 60 秒内的事件条数 |
| `window.amount_60s` | 该用户近 60 秒内的事件金额合计 |

窗口是**左闭右开**的：记当前事件时间为 `now`，统计区间是 `[now - 60, now)`。
也就是说正好落在 60 秒前那一刻的事件**算在窗口内**，当前这条事件本身不算进计数。

## 目录

```
riskmule/
  expr.py      条件表达式求值
  ruleset.py   规则集加载与校验
  window.py    滑动窗口统计
  engine.py    编排：事件 -> 决策
  cli.py       replay 命令行
samples/       规则集与事件样例
tests/         单元测试
```
