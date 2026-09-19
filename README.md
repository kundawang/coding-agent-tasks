# neonbarrage

纵向弹幕射击，网页版。自机在底部，弹幕从上往下，躲的同时打掉敌人。

纯静态、无构建、无依赖。

## 目录

```
samples/stage.json   第一关：波次与弹幕模式
samples/ship.json    自机参数（速度、判定点半径、射速）
```

## 关卡格式

```json
{
  "id": "stage-01",
  "durationMs": 90000,
  "waves": [
    { "at": 1500, "kind": "fan", "count": 12, "spreadDeg": 60,
      "speed": 180, "from": [0.5, -0.05], "hp": 30 },
    { "at": 4000, "kind": "ring", "count": 24, "speed": 140,
      "from": [0.3, 0.2], "hp": 45 }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `at` | 毫秒，从关卡开始算 |
| `kind` | `fan`（扇形）/ `ring`（环形）/ `aimed`（朝自机）/ `spiral`（螺旋） |
| `count` | 这一波几发 |
| `speed` | 弹速，像素/秒 |
| `from` | 相对屏幕的坐标，`[x, y]`，取值 0~1 |
| `hp` | 这个弹源要打几下才消失 |

## 自机参数

```json
{ "speed": 320, "hitRadius": 2.5, "shotIntervalMs": 90, "shotDamage": 5 }
```

`hitRadius` 是**判定点**半径（很小，这是弹幕游戏的核心手感），不是整个机体的大小。
