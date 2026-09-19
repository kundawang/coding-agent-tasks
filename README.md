# tickwars

本地双人抢点对战，网页版。两个人在一台机器上、同一个键盘，抢地图上的据点攒分。

纯静态、无构建、无依赖。

## 目录

```
samples/arena.json   地图：尺寸、障碍、据点
samples/rules.json   对战规则与手感参数
```

## 地图格式

```json
{
  "id": "yard",
  "width": 960, "height": 640,
  "obstacles": [[420, 120, 120, 90], [420, 430, 120, 90]],
  "points": [
    { "id": "A", "x": 180, "y": 150 },
    { "id": "B", "x": 780, "y": 150 },
    { "id": "C", "x": 480, "y": 320 }
  ],
  "spawns": { "p1": [80, 560], "p2": [880, 560] }
}
```

`obstacles` 里每项是 `[x, y, w, h]` 的矩形。

## 规则

```json
{
  "tickRate": 60,
  "matchMs": 180000,
  "captureRadius": 70,
  "captureMs": 2500,
  "scorePerSecond": 5,
  "speed": 240,
  "spawnImmunityMs": 1500
}
```

| 字段 | 说明 |
|---|---|
| `tickRate` | 逻辑每秒跑多少 tick（固定步长） |
| `captureMs` | 一个人站在据点里连续多久算占下 |
| `scorePerSecond` | 占着的据点每秒给几分 |
| `spawnImmunityMs` | 复活后的无敌时间 |

按键：玩家一是 `WASD`，玩家二是方向键。
