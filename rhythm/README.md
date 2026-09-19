# DFJK 打歌台

纯静态网页四键下落式音游：原生 ES Module + Canvas + WebAudio，零依赖、零构建。

## 怎么开

```bash
# 在仓库根目录（rhythm/ 的上级）执行：
python -m http.server 8000
# 浏览器打开 http://localhost:8000/rhythm/
```

不能用 `file://` 直接双击打开（浏览器会拦 `fetch` 谱面），必须起个静态服务。

## 玩法

- 按键 **D F J K** 对应四条轨道，音符落到判定线时按下。
- **Esc** 暂停 / 继续；右上角按钮切全屏。
- 打完出成绩：Perfect / Great / Good / Miss、最大连击、准确率、总分，可留名进榜。
- 排行榜存在浏览器 localStorage，支持导出 JSON / 粘贴合并别人的 JSON。

## 判定窗口（最终采用值）

| 判定 | 窗口 | 单音分 |
| --- | --- | --- |
| Perfect | ±30 ms | 1000 |
| Great | ±60 ms | 650 |
| Good | ±100 ms | 300 |
| Miss | 超出 ±100 ms（或超时未按） | 0 |

准确率 = (Perfect×1 + Great×0.65 + Good×0.3) / 总音符数 × 100%。
排名依据：总分（同分看准确率）。

## 时间轴设计（为什么高刷屏 / 掉帧不会漂）

全游戏只有一条时间轴：**AudioContext 的音频时钟**。

- 歌曲位置 = `audioCtx.currentTime - 起点`，渲染、判定、伴奏调度全部换算自这条轴。
- `requestAnimationFrame` 只负责"把当前歌曲位置画出来"，不参与任何计时；
  掉帧只是画面少画一帧，判定结果不受影响，165Hz 和 60Hz 表现一致。
- 键盘事件通过 `AudioContext.getOutputTimestamp()` 把 `event.timeStamp`
  精确映射到音频时钟（不支持的浏览器退化为当前音频时钟，误差由校准吸收）。
- 暂停用 `audioCtx.suspend()`：`currentTime` 被冻结，恢复（`resume()`）后从原值
  继续走，暂停期间不计时、不错位。
- 伴奏按谱面的 `bpm` / `offsetMs` 用 lookahead 调度器（25ms 间隔、提前 150ms）
  排进音频时钟，与判定共用同一首歌的起点，不另起节奏。
- 画面布局每帧按当前画布尺寸现算，拖窗口、切全屏不积累误差。

## 输入校准

菜单 → 输入校准：4 声预备拍后，跟着 4 拍每拍按任意键。

- 每次击打记录 `击打时刻 - 节拍时刻`（音频时钟，ms）。
- 取 **中位数** 作为这台机器的输入延迟补偿（中位数抗偶发手滑），
  存入 localStorage，下次打开自动生效。
- 之后每次判定时先从击打时刻减去该补偿再对照判定窗口。
- 成绩页会同时显示"已应用的补偿值"和"若不做校准的估算成绩"，
  校准有没有用一眼可见。

## 谱面

游戏运行时加载 `../samples/chart.json`（相对 `rhythm/index.html`）：

```json
{ "title": "...", "bpm": 150, "offsetMs": 0, "notes": [{ "time": 1234, "lane": 0 }] }
```

- `time` 单位 ms（歌曲时间轴），`lane` 0-3 对应 D F J K。
- 换谱面直接覆盖该文件即可，无需改代码。
- 当前文件是**生成器产出的占位谱**（804 音符 / 约 3 分钟 / 150 BPM），
  重新生成：`node rhythm/tools/gen_chart.mjs`。

## 伴奏

WebAudio 现场合成的 8-bit 伴奏（无音频素材）：方波主旋律（A 小调五声音阶
随机游走）+ 三角波贝斯（Am-F-C-G 进行）+ 噪声鼓组。由固定种子生成，
每次播放完全一致，保证比赛公平。

## 测试

纯计算部分（判定 / 计分 / 校准 / 榜单合并）不依赖浏览器，可直接跑：

```bash
node rhythm/tests/run.mjs
```

## 文件结构

```
rhythm/
  index.html        页面与五个界面（菜单/校准/游戏/成绩/榜单）
  css/style.css
  js/
    main.js         界面装配与流程
    audio.js        WebAudio 引擎：音频时钟、伴奏合成、暂停
    game.js         游戏主循环：Canvas 渲染 + 输入判定
    judge.js        判定窗口（纯计算）
    score.js        计分 / 准确率 / 评级（纯计算）
    calibrate.js    校准计算（纯计算）
    leaderboard.js  榜单存取 / 导出 / 导入 / 合并（纯计算 + localStorage）
  tools/gen_chart.mjs   占位谱面生成器
  tests/run.mjs         纯计算模块测试
```
