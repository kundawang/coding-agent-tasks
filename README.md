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

纯静态、原生 ES module + Canvas，无依赖、无构建。用任意静态服务器打开本目录即可，例如：

```
python -m http.server 8000
```

然后浏览器访问 `http://localhost:8000/`。不要直接双击 `index.html`（`file://` 下 ES module 和 `fetch` 会被浏览器拦）。

## 目录

```
index.html          入口
style.css           样式
src/main.js         固定步长主循环、UI、观战
src/engine.js       纯逻辑：createMatch / step（不碰时钟、DOM、Math.random）
src/replay.js       录制、序列化、重放、快照校验
src/render.js       Canvas 渲染（只读状态，不推进逻辑）
src/input.js        键盘 -> 每玩家 5 bit 输入
src/prng.js         种子驱动的确定性 PRNG（mulberry32）
src/config.js       加载 samples + 战斗常量
samples/            地图与规则（原样读取，不修改）
```

## 按键

| | 移动 | 攻击 | 暂停 |
|---|---|---|---|
| 玩家一（蓝） | `W A S D` | `空格` | `Q` |
| 玩家二（红） | `↑ ← ↓ →` | `回车`（小键盘回车也行） | `P` |

攻击是朝面向方向的短距离扇形近战，命中扣 1 HP 并击退；3 HP 归零后倒下，1200ms 后在己方出生点复活，复活后有 `spawnImmunityMs`（1500ms）出生无敌（身上闪白圈，无敌时不吃伤害、也不被对方身体卡住）。

## 规则与战斗常量

| 参数 | 值 | 来源 |
|---|---|---|
| 逻辑步长 tickRate | 60 tick/秒（`dt = 1000/60` ms，固定） | `rules.json` |
| 比赛时长 matchMs | 180000 ms（108000 个 live tick，另有 180 tick = 3 秒开局倒计时） | `rules.json` |
| 据点半径 / 占领时间 | captureRadius 70 / captureMs 2500ms | `rules.json` |
| 占点得分 | scorePerSecond 5，按每个 tick `5*dt/1000` 累加 | `rules.json` |
| 移动速度 | speed 240 px/s，斜向已归一化，不会变快 | `rules.json` |
| 玩家半径 | 18 | `src/config.js COMBAT` |
| 生命 / 伤害 | 3 HP，近战一下 1 | 同上 |
| 攻击距离 / 扇形 | 52 px / 约 90° | 同上 |
| 攻击冷却 / 判定窗 | 450ms / 140ms（一次挥击对同一人只算一下） | 同上 |
| 倒地复活 | 1200ms | 同上 |
| 击退 | 260 px/s 初速，硬直 260ms，指数衰减 | 同上 |

据点规则：圈内只有一方时该方读占领条；双方同时在圈内算争夺、读条冻结；人离开后进度保留，回来接着读；占领后持续加分，被对方读满即易主。三分钟到点（含倒计时共 10980 tick）分数高者胜，平分算平局。

## 固定 tick（逻辑与渲染分离）

- 逻辑只能通过 `step(state, inputs)` 前进，每步固定推进 `1000/tickRate` ms。
- `requestAnimationFrame` 只负责渲染：主循环用累加器（spiral catch-up）把真实流逝时间切成整数个固定 tick，每个 tick 采样一次键盘、推一步、录一帧；切后台回来超过 250ms 的空洞不会补算。
- 因此 60Hz 和 165Hz 显示器上发生的判定完全一致；掉帧只让画面旧一点，已经发生的 tick 不会被改变或重算。
- 渲染层只读状态，绝不调用 `step`。
- 引擎不读真实时间、不读 DOM、不调 `Math.random`。唯一的随机源是 `src/prng.js` 的 mulberry32，其 32 位状态在快照里；当前随机仅用于击退方向的小偏角，种子写进回放，同种子必出同结果。

## 回放格式

导出为单个 JSON 文件（也可以直接把回放 `.json` 拖进页面，或主菜单点“导入回放观战”）。字段：

```json
{
  "format": "tickwars-replay",
  "version": 1,
  "startedAt": "2026-09-19T12:00:00.000Z",
  "seed": "开局随机种子字符串",
  "arena": { ... },
  "rules": { ... },
  "tickCount": 10980,
  "inputs": "base64...",
  "events": [ ... ],
  "snapshots": [ ... ]
}
```

- `arena` / `rules` 是开局所用配置的完整内嵌副本，所以即使 `samples` 改了，旧回放仍按当时参数重放。
- `tickCount` 是这局的总 tick 数（含 180 tick 倒计时）。
- `inputs` 是每 tick 两个玩家的输入：base64 解码后开头 4 字节是小端 uint32 的数值个数 `N = 2*tickCount`，其余按小端 uint16 解释为扁平数组 `[p1@tick1, p2@tick1, p1@tick2, p2@tick2, ...]`。每个 uint16 只用低 5 位，位定义（见 `src/config.js INPUT`）：

  | bit | 含义 |
  |---|---|
  | 0 (1) | 上 |
  | 1 (2) | 下 |
  | 2 (4) | 左 |
  | 3 (8) | 右 |
  | 4 (16) | 攻击 |

  记录的是每个 tick 时刻的按键**按住状态**而不是按键事件，长按时序与掉帧都不会丢失或错位。
- `events` 是事件元组数组（紧凑数组形式），第一项是类型，第二项都是 tick：

  | 元组 | 含义 |
  |---|---|
  | `["start", 0, seed]` | 对局开始 |
  | `["go", 180]` | 倒计时结束开战 |
  | `["swing", t, team]` | 某玩家在该 tick 起手攻击 |
  | `["hit", t, team, 剩余HP]` | 命中 |
  | `["kill", t, 击杀者team, 死者team]` | 击倒 |
  | `["respawn", t, team]` | 复活（带出生无敌） |
  | `["capture", t, team, 据点id]` | 在该 tick 占领/易主 |
  | `["score", t, p1分, p2分]` | 每整秒一条的分数对账，共 180 条 |
  | `["end", t, p1分, p2分]` | 终局结算 |

- `snapshots` 是完整状态快照：开局 t=0、之后每 300 tick（5 秒）一个、终局一个。快照里的坐标/速度/计时/分数都是**全精度 double**（快进恢复后要逐 bit 等价地继续模拟，不能四舍五入）；每个快照带 `h` 字段，是其余字段 `JSON.stringify` 后的 FNV-1a 哈希。观战拖时间轴时先跳到最近快照再顺序补 tick，并周期性重算快照哈希，和录制时对不上会在界面标红。

理论上有了 `seed + 配置 + 每 tick 输入` 就能完全重建整局；`events` 和 `snapshots` 是从这份真相推导出来的对账与快进副本，用于“谁在哪个 tick 占的点、分怎么涨”的逐帧核对和快速拖动。

## 观战

结算界面点“观看回放”、或导入/拖入回放文件进入观战：底部时间轴可任意拖动；`▶/⏸` 播放暂停（`Q/P` 也可）；支持 0.25× / 0.5× / 1× / 2× 慢放快放、`−1帧/+1帧` 单帧步进；事件列表里每一条都能点击跳到对应 tick；`✓ 快照校验一致` 表示该位置的重放状态与录制时哈希吻合。