# benchlab

可复现的前端性能压测面板，网页版。同一份工作负载、同一个种子，跑出来的数要能对得上。

纯静态、无构建、无依赖。

## 目录

```
samples/workload.json  一次压测的工作负载描述
```

## 工作负载格式

```json
{
  "name": "render-heavy",
  "seed": "20260919",
  "warmupRuns": 5,
  "runs": 40,
  "tasks": [
    { "kind": "renderList", "weight": 6, "items": 2000 },
    { "kind": "sortRows", "weight": 3, "items": 20000 },
    { "kind": "computeHash", "weight": 1, "bytes": 2000000 }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `seed` | 随机种子，决定每次跑的任务顺序和输入数据 |
| `warmupRuns` | 预热次数，不计入统计 |
| `runs` | 正式跑多少次 |
| `tasks[].weight` | 抽到这类任务的相对权重 |

任务是**在页面上真实执行**的（渲染列表、排序、算哈希），不是假装的空转。
