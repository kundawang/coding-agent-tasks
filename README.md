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

## 运行

纯静态页面，必须通过 HTTP 打开（要 `fetch` 加载 `samples/*.json`，`file://` 双击会被浏览器拦）：

```
python -m http.server 8000
```

浏览器访问 `http://localhost:8000/`。原生 ES module + Canvas，无任何依赖、无构建步骤。

## 按键与玩法

| 操作 | 玩家一 | 玩家二 |
|---|---|---|
| 上 / 下 / 左 / 右 | `W` `S` `A` `D` | `↑` `↓` `←` `→` |
| 暂停 / 继续 | `P` | `P`（观战中也是播放/暂停） |

- 三个据点 A/B/C，走进据点圆圈（半径 `captureRadius`）连续站 `captureMs` 毫秒即占下；
  两人同时在圈内为「争夺」，进度冻结；离开或换占领者，进度清零。
- 占着的据点每 tick 按 `scorePerSecond / tickRate` 加分，三分钟（`matchMs`）结算，分高者胜，平分平局。
- 人是半径 16 像素的圆，撞墙沿墙滑动，两人不能互相穿过（`samples` 里没有半径字段，此值固定写死在 `js/sim.js`）。

### 战斗与复活

`rules.json` 没有战斗字段，战斗规则在此固定：

- 两圆接触（中心距 ≤ 2r + 2.5 像素）即搏命：
  - 双方都不在无敌 → 双双淘汰；
  - 一方处于出生无敌 → 无敌方存活，另一方淘汰；
  - 双方都无敌 → 只是身体挡住，谁都不死。
- 淘汰后**当 tick 立即在己方出生点复活**，并获得 `spawnImmunityMs`（默认 1.5 秒，90 tick）无敌：
  无敌期间身体可以穿过对方——专门用来防止一出生就被堵在角落。
- 出生点有 ±12 像素的随机抖动（避免每局站位完全重合），由种子决定。

## 固定 tick（逻辑与渲染解耦）

- 逻辑步长恒为 `1000 / tickRate` 毫秒（默认 60 tick/秒，每步 16.6667ms），由
  「累加器」驱动：每帧把真实帧间隔累加，能凑整几个步长就跑几个 step，渲染只画最新状态。
- 165Hz、60Hz、30Hz 屏幕上**同一局输入产生完全相同的 tick 序列和分数**；
  累加器带 1e-9ms 的浮点吸附，消除 165/144 等非整除帧率跑满一整局时的 1 tick 浮点漂移。
- 单帧卡顿超过 250ms（切后台等）丢弃积压时间；单帧最多补 10 个步长防螺旋死亡。
  掉帧只会让画面少几帧，已经发生的判定不会改变。
- 模拟层（`js/sim.js`）不读真实时间、不碰 DOM、不调用 `Math.random`；唯一随机源是
  种子化的 mulberry32 PRNG。

## 观战与回放

一局结束后可「导出本局回放」（下载 `.twr.json`），也可以在主菜单「导入回放观战」
把别人的 JSON 整段贴进来。观战支持：播放/暂停、0.25×–4× 慢放/快放、时间轴任意拖动
（拖到任意 tick 都是从第 0 tick 确定性重算，10800 步约几毫秒）。

### 回放格式（格式 v1，由本程序定义）

回放是一个 JSON 对象：

```json
{
  "format": "tickwars-replay",
  "version": 1,
  "seed": 123456789,
  "totalTicks": 10800,
  "arena": { "...": "samples/arena.json 的原样内容" },
  "rules": { "...": "samples/rules.json 的原样内容" },
  "inputs": [[5, 1, 0], [12, 0, 2]],
  "events": [
    { "type": "capture", "tick": 258, "point": "A", "owner": 0, "score": [0, 0] },
    { "type": "kill", "tick": 401, "victim": 1, "killer": 0, "x": 500, "y": 320 },
    { "type": "spawn", "tick": 401, "player": 1, "x": 884.2, "y": 553.7 },
    { "type": "result", "tick": 10800, "score": [878.33, 878.33], "winner": "draw" }
  ],
  "result": { "score": [878.33, 878.33], "winner": "draw" }
}
```

- `seed`：mulberry32 的 32 位种子（出生抖动等所有随机都从它推出）。
- `inputs`：**只记录按键状态发生变化的 tick**，每项 `[tick, p1Mask, p2Mask]`，
  该掩码从 `tick` 起一直生效到下一条记录。掩码位：上 `1`、下 `2`、左 `4`、右 `8`（可组合，如 `5`=上+左）。
  没有记录的 tick 沿用上一条；第一条之前视为全 0。
- `events`：占领 / 击杀 / 复活 / 结算。`capture.score` 是占领完成那一刻的累计分，
  方便逐 tick 对账「谁在哪一 tick 占的点、分怎么涨」。
- 位置、据点归属、中间分数**都不存**——全部由 `seed` + `inputs` 重算。
  导入回放时会从第 0 tick 完整重跑一局，把重算出的 `events`/`result` 与文件里记录的
  逐事件比对：全部一致显示绿色「回放校验通过」，任何字段对不上（改过种子、输入、规则）
  都会红色标出具体不一致项，防止拿篡改过的回放扯皮。

## 文件结构

```
index.html        页面与 UI（HUD、结算遮罩、观战时间轴）
js/config.js      加载并归一化 samples/*.json
js/sim.js         纯确定性模拟：移动/碰撞/抢点/加分/复活/结算，固定 tick 步进
js/input.js       键盘采样（WASD / 方向键）
js/render.js      Canvas 只读渲染
js/replay.js      回放记录、解析、确定性重放与事件对账
js/app.js         主循环（固定步长累加器）与页面交互
samples/          地图与规则参数（勿改）
```
