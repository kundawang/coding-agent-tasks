# framecombo

格斗游戏的连招练习器，网页版。按帧数据判定出招，照着练习表连招，统计成功率和平均耗时。

纯静态、无构建、无依赖。

## 目录

```
samples/moves.json    招式帧数据
samples/combos.json   练习用的连招表
```

## 招式格式

```json
{
  "id": "light_punch",
  "name": "轻拳",
  "input": "5L",
  "startup": 3,
  "active": 2,
  "recovery": 7,
  "damage": 5,
  "hitstun": 12,
  "blockstun": 8,
  "cancelInto": ["light_kick", "heavy_punch"]
}
```

| 字段 | 说明 |
|---|---|
| `startup` / `active` / `recovery` | 帧数（60fps 下 1 帧 = 16.67ms） |
| `hitstun` | 打中对方后对方僵直帧数 |
| `cancelInto` | 命中后可以取消成哪些招式 |

## 招式的按键写法

`input` 用格斗游戏常见的记法：`5` 是站立，`2` 是蹲，`4` 是后退，`6` 是前进，
后面跟 `L`（轻）/ `M`（中）/ `H`（重）/ `S`（特殊）。例如 `236L` 是波动拳式的摇杆输入。

## 连招格式

```json
{ "id": "basic-1", "steps": ["5L", "5L", "5M"], "note": "三下小连段" }
```
