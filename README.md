# seedforge

用种子生成地牢地图的小工具，网页版。同一个种子永远生成同一张地图，地图可以编码进链接发给别人。

纯静态、无构建、无依赖。

## 目录

```
samples/presets.json   几套生成参数
samples/seeds.txt      一串平时用的种子
```

## 生成参数

```json
{
  "id": "cramped",
  "name": "窄道",
  "width": 64, "height": 48,
  "roomMin": 5, "roomMax": 11,
  "roomCount": 18,
  "corridorWidth": 1,
  "extraLoops": 2,
  "treasureRooms": 3
}
```

| 字段 | 说明 |
|---|---|
| `width` / `height` | 网格尺寸（格） |
| `roomMin` / `roomMax` | 房间边长范围 |
| `roomCount` | 目标房间数（放不下就少放几个，但不能报错） |
| `corridorWidth` | 走廊宽度 |
| `extraLoops` | 除了生成树之外额外连几条环路 |
| `treasureRooms` | 标注几个宝箱房 |

## 种子

`samples/seeds.txt` 里一行一个种子，允许是任意字符串（数字、单词、一串乱码都行），
同一个种子必须生成完全一样的地图。
