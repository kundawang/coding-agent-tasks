# 怎么用这套方式作业（本线 lk-xxx）

给新加入的人看。照着做一遍就能开始出题、跑题、提交。

---

## 0. 先搞清楚这个仓库在干什么

**一道题跑两轮 = 一条数据。** 同一个 prompt、同一台机器，用 Codex CLI 各跑一次（A / B），
最后对两次结果做 GSB 判断，交给甲方。

仓库里同时跑着**两条工作流**，题号错开，别抢：

| 前缀 | 谁 | 分支 | 桌面工作区目录 |
|---|---|---|---|
| `T0xx` | 另一条线 | `t0xx/base|a|b` | `桌面\GSB出题\<题号>\A|B` |
| `lk-xxx` | 本线 | `lk-xxx/base|a|b` | `桌面\GSB题目\<题号>\A|B` |

**新来的人自己取一个前缀**（比如按名字缩写 `zh-001`、`ws-001`），别用 `lk-` 或 `T`，
否则会跟别人撞号——这个坑已经踩过一次了。

---

## 1. 一次性准备

### 1.1 环境

- **Git**、**Python**（这台机器没有系统 Python，用 `uv run python` 跑工具，见下）
- **uv**：https://docs.astral.sh/uv/ （`uv run python` 会自动准备解释器）
- **Node.js**（题目本身是纯前端，跑起来要它）
- **Codex CLI**：`npm install -g @openai/codex`，版本要记下来（提交表要填 `Harness 版本`）

### 1.2 接模型网关

项目方会单独发给你三样东西：`Base URL` / `API Key` / `Model ID`。
用他们给的 `vendor-instruction.zip` 里的 `codex-cli-setup.sh` 配，
**配完自查上下文窗口必须是 1,000,000**（这个配置不要自己改）。

建议把跑题用的 Codex CLI 单独放一个 `CODEX_HOME`（比如 `~/.codex-cli`），
跟日常用的 Codex 隔开——仓库里的启动器默认就认这个路径。

### 1.3 拉仓库

```bash
git clone https://github.com/kundawang/coding-agent-tasks
cd coding-agent-tasks
git config user.name  "<你的名字拼音>"
git config user.email "<你的邮箱>"
```

### 1.4 改一处配置（重要）

打开 `tools/submit_config.json`，把 `submitter_name` 换成**你在飞书里的显示名**
（提交表里的「提交人」要跟飞书显示名一致）。`base_token` / `table_id` 不用改。

### 1.5 让 codexcli 别再问「是否信任此目录」

不用手动配。本线的 `t new` / `t prep` / `t cycle` 会自动把工作区目录写进
`~/.codex-cli/config.toml` 的信任列表。跑题用的那份配置里审批也是关着的
（`approval_policy = "never"`），所以开窗口不会弹 yes。

---

## 2. 出题

### 2.1 挑方向

以 **0-1 前端（游戏 / 互动应用）** 为主，但要避开项目文档里那份**雷同题黑名单**：
贪吃蛇、打砖块、俄罗斯方块、坦克大战及变种、粒子物理、塔防、2D 解谜、潜行、平台跳跃、
喂食小动物、记忆翻牌/连连看、棋类、2048、扫雷、打地鼠。
也不要跟仓库里已有的题撞「环境几乎相同 + 任务几乎相同」。

好题的特征：**难点是工程性的、可客观核验的**。比如——

- 固定步长 / 确定性重演（同输入必同结果、跨机器一致）
- 音频时钟 vs 帧时钟、输入时序与缓冲
- 大数量级性能、对象池、内存不涨
- 崩溃恢复、状态升级、时间回拨防作弊
- 不可信输入、行级锚定、可复现随机

### 2.2 写起始仓库（只有一个 `README` + `samples` + `.gitignore`）

**不给实现，只给素材和口径**：

- `README.md`：数据结构 / 规则口径（比如关卡 JSON 格式、伤害公式、赛道检查点）
- `samples/`：一两份有真实感的样例数据（JSON / JSONL / txt）
- `.gitignore`

### 2.3 写 prompt —— 用真人口吻，别写成规格书

这一条最影响数据质量，也最容易被一眼看出是 AI 写的。要求：

- **不要加粗**、不要「想要的：/ 硬约束：/ 交付物：」这种小标题
- **不要 1/2/3 对仗的编号清单**
- 把要求揉进吐槽和细节里讲，像同事在群里发需求
- 有具体由来（上一版怎么坏的、谁抱怨过什么）、有个人偏好、有几处轻重不均
- 要求一条都不能少，但读起来要是人话

可以对照仓库里 `tasks/LK-002/prompt.md` 这一批的写法。

### 2.4 一条命令建题

```bat
t new zh-001 --workspace <起始环境目录> --prompt-file p.txt ^
  --title "一句话标题（从 0 实现）" ^
  --task-type "0-1 代码生成" --difficulty 困难 ^
  --lang "JavaScript, Canvas, 原生 ES module（无构建、无依赖）" ^
  --harness "Codex CLI" --harness-version "<你的版本>" --os Windows ^
  --env-level "无外部依赖"
```

它会自动做完这些（不用你操心）：

1. 建 `zh-001/base` 分支，拿到**初始环境快照**（40 位 SHA）
2. 写台账 `tasks/ZH-001/`
3. 桌面铺出 `GSB题目\ZH-001\A` 和 `\B` 两份工作区（内容逐字节一致）
4. 生成 `A-run.cmd` / `B-run.cmd`
5. prompt 原文复制一份到桌面 `prompt原文\`
6. 把两个工作区加进 codexcli 信任列表

---

## 3. 跑题

### 3.1 双击启动器

```
桌面\GSB题目\ZH-001\A-run.cmd     ← A 轮
桌面\GSB题目\ZH-001\B-run.cmd     ← B 轮
```

双击后会：开一个带名字和颜色的终端标签 → **存档上一轮 + 把工作区清成全新并逐文件核验** → 启动 codexcli。

### 3.2 三条铁律

1. **窗口里只贴 prompt 原文**，其他任何东西都不要输（连 `/status` 这类命令都不要）
2. **只跑首轮**：模型答完就结束，不追问、不纠错
3. 报错、504、无提示中断 → **关掉窗口、重新双击同一个启动器**，不要在同一个会话里接着跑

### 3.3 跑挂了 / 跑完了

- **跑挂了**：直接关窗口，再双击同一个启动器。上一轮会自动存档到
  `C:\Users\<你>\.coding-agent-tasks\runs\<题号>\<A|B>-<时间戳>\`，工作区恢复成全新。
- **跑完了**：**先别关窗口**，按顺序做完这两件事再关：

```bat
t record zh-001 a --side a --session <A-SessionID>
t record zh-001 b --side b --session <B-SessionID>
```

忘了先记账也没事：存档还在，`t record zh-001 a --workspace "<存档目录>" --session <ID>` 能补记。

---

## 4. 收尾提交

1. **录屏**：A、B 各一段，**≤90 秒、720p、mp4**，从干净状态启动、完整展示真实输出；
   **跑不起来也要录，把报错录出来**。前端要展示实际跑起来的样子。

```bat
t set zh-001 --a-recording "<A录屏>" --b-recording "<B录屏>"
```

2. **GSB 结论和理由**：**必须人自己写**（项目文档禁止 AI 分析轨迹或代写理由），写成文件。

```bat
t set zh-001 --gsb-conclusion "A 更好" --gsb-reason-file reason.md
```

3. **核对字段**：`t report zh-001` —— 会输出这条数据要填的所有字段，轨迹文件是可点击的本机链接。

4. **上传**：

```bat
submit zh-001 --uid 14X            :: dry-run，只预览不写表
submit zh-001 --uid 14X --write    :: 真正写入
```

5. 最后到飞书表里**自己点「提交」按钮**（按钮字段，接口点不了）。

---

## 5. 硬性规矩（项目文档的，别踩）

- 两次跑必须是**完全相同的 prompt**、同一个 Harness 和版本、同一台机器、同一套配置
- **只跑首轮**
- 初始环境快照必须是两次跑的**共同起点**；A / B 产物快照的父提交都必须是它
  （本线用「A / B 各一份独立工作区、都从同一个 base 铺出来」来保证）
- 报错 / 504 / 无故中断 → 新开窗口重跑
- **禁止用 AI 工具分析轨迹和产物，禁止 AI 代写 GSB 理由**
- 录屏：干净状态、真实输出、90 秒以内、720p、mp4
- 时限：**当天 20:00 前**跑的**当天提交**；**20:00 后**跑的允许**次日 14:00 前**提交
- **数据不允许返修**，不合要求直接拒收

---

## 6. 命令一览

仓库根目录下（桌面上有「题库仓库」快捷方式）：

```bat
t list                        :: 列出所有题目和状态
t report zh-001               :: 输出要填的字段 + 可点击的轨迹文件
t prep  zh-001                :: 重铺 A / B 工作区 + 刷新启动器
t cycle zh-001 --side a       :: 存档上一轮 + 把 A 清成全新（启动器里调的就是它）
t reset zh-001 --side a --fresh
t record zh-001 a --side a --session <ID>
t set   zh-001 --gsb-conclusion "B 更好" --gsb-reason-file reason.md
t launch                      :: 刷新所有启动器
t prompt                      :: 刷新桌面上的 prompt 原文副本
t rebuild                     :: 桌面误删 / 换机器后一键重建
push                          :: 推送（带重试；HTTPS 不通会自动改走 SSH）
submit zh-001 --uid 14X       :: 上传提交表（默认 dry-run）
```

`t` 是 `uv run python tools/task.py` 的包装脚本；`submit` 是 `tools/submit.py`。

---

## 7. 目录速查

```
仓库
  ├─ tasks/<题号>/       台账：meta.json、prompt.md、trajectories/
  ├─ tools/              task.py / submit.py / push.py / find_trajectory.py / find_sessions.py …
  └─ docs/               项目文档原文、字段口径、GSB 写法、雷同题黑名单

桌面
  ├─ GSB题目/<题号>/     A\  B\  A-run.cmd  B-run.cmd
  └─ prompt原文/         <题号>-<项目名>.txt（双击就能复制）

失败存档    C:\Users\<你>\.coding-agent-tasks\runs\<题号>\<A|B>-<时间戳>\
跑题轨迹    C:\Users\<你>\.codex-cli\sessions\YYYY\MM\DD\rollout-*.jsonl
```

---

## 8. 踩过的坑，你大概率也会遇到

| 现象 | 原因 / 怎么办 |
|---|---|
| 开窗口就问「是否信任此目录」 | 目录没登记。本线启动器会自动登记；手动开的窗口要自己加进 `~/.codex-cli/config.toml` 的 `[projects.'<路径>']` |
| 新窗口里能看到上一轮跑的东西 | 上一轮没清。用启动器开窗（会自动清+核验），或手动 `t cycle <题号> --side a` |
| `PermissionError: 另一个程序正在使用此文件` | 那个 A / B 目录还有窗口开着。**先关窗口**再清 |
| 目录被删了一半 | 别在有窗口开着时删目录。用 `t cycle`（原地清，不删目录） |
| 题号跟别人撞了 | 换自己的前缀。两条线并存，题号必须错开 |
| `github.com:443` 连不上、push 失败 | 本机常见。`push.cmd` 会自动重试并尝试走 SSH；最省事是把自己的公钥加到 GitHub |
| 上下文窗口不是 1,000,000 | 配置被改或 `relay_model_catalog.json` 被删。重新跑一遍项目方的 setup 脚本 |
