# apexloop

俯视视角的赛车小游戏，网页版。跑圈、计圈速、刷自己的最好成绩。

纯静态、无构建、无依赖。

## 目录

```
samples/track.json   赛道：中心线折线 + 检查点 + 起终点
samples/car.json     车辆参数
```

## 赛道格式

```json
{
  "id": "loop-01",
  "width": 140,
  "centerline": [[400, 600], [900, 600], [1200, 300], [400, 300]],
  "checkpoints": [[900, 600], [1200, 300], [400, 300]],
  "startLine": [[400, 600], [400, 520]],
  "laps": 3
}
```

| 字段 | 说明 |
|---|---|
| `centerline` | 赛道中心线，折线点，像素坐标 |
| `width` | 路面宽度 |
| `checkpoints` | 必须按顺序穿过的检查点（防止抄近道） |
| `startLine` | 起终点线，`[p1, p2]` |
| `laps` | 要跑几圈 |

## 车辆参数

```json
{
  "accel": 380, "brake": 620, "maxSpeed": 520,
  "turnRateDeg": 170, "driftTurnRateDeg": 260,
  "offRoadSpeedFactor": 0.45, "fuelPerSecond": 3.5
}
```

速度单位是像素/秒，`turnRateDeg` 是每秒能转多少度。
