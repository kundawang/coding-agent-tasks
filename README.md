# pipeline-svc

一个轻量的数据处理管道服务：用 JSON 描述 stage 之间的依赖，按依赖顺序执行，
把每个 stage 的结果落到 SQLite。内部报表任务都跑在它上面。

## 目录

```
pipeline/
  spec.py     管道定义解析与执行顺序推导
  stages.py   内置 stage 实现（source / filter / map / aggregate / export）
  store.py    SQLite 结果存储
  runner.py   执行引擎
  cli.py      命令行入口
specs/        管道定义示例
tests/        单元测试（python -m unittest）
```

## 用法

```bash
# 跑一个管道
python -m pipeline run specs/daily_etl.json

# 指定状态库和输出目录
python -m pipeline run specs/daily_etl.json --db .pipeline/state.db --out out

# 看某次运行的库内容
python -m pipeline dump specs/daily_etl.json
```

跑完会打印每个 stage 的状态和行数：

```
run 2026-09-18T09:12:33 pipeline=daily_etl
  load_orders     success  rows=8
  drop_cancelled  success  rows=6
  enrich          success  rows=6
  by_region       success  rows=3
  write_report    success  rows=3
status: success
```

## 测试

```bash
python -m unittest discover -s tests -v
```

只依赖标准库（Python 3.11+）。

## stage 类型

| kind | 参数 | 说明 |
|---|---|---|
| `source` | `rows` | 内置行数据（测试和演示用） |
| `filter` | `field` / `op` / `value` | `op` 支持 `eq` `ne` `gt` `lt` `contains` |
| `map` | `add` | 新增字段，`{"name": {"from": "field", "cast": "int\|float\|str", "mul": 100, "add": 1}}`（`cast`/`mul`/`add` 都可省略） |
| `aggregate` | `group_by` / `metrics` | `metrics` 形如 `{"total": {"field": "amount", "fn": "sum"}}`，`fn` 支持 `sum` `count` `avg` |
| `export` | `path` / `format` | 写到 `--out` 目录，`format` 支持 `json` `csv` |

## 已知问题（待办）

- 每次运行都会把所有 stage 从头跑一遍，历史结果存在库里但从来没被复用。
- 跑到一半进程挂掉，重启只能从头再来。
- 某个 stage 挂了，整个运行立刻中断，其它分支也跟着白跑。
- spec 里写错依赖方向（成环）时只抛一句 `cannot determine execution order`，看不出环在哪。
