# Coding Agent 题目库（Pair-wise GSB）

一个仓库集中存放所有题目。每道题包含：**一个初始环境快照** + **A/B 两次跑的产物快照** + 两条轨迹文件。

## 仓库结构

```
main                        题目台账：题目信息、prompt、轨迹、索引
├── tasks/
│   ├── _TEMPLATE/          新建题目时复制的模板
│   └── T001/               每道题一个目录
│       ├── prompt.md       发给模型的 prompt 原文（不改写）
│       ├── meta.json       提交表字段（机器可读）
│       └── trajectories/   A/B 轨迹 jsonl
├── docs/                   项目文档与口径（原文、SOP、字段、GSB 写法、雷同题黑名单）
│   └── vendor/             项目方给的接入脚本（codex-cli-setup.sh 等）
└── tools/                  自动化脚本
    ├── task.py             建题 / 记录 A/B / 重置 / 出字段
    ├── find_trajectory.py  按 SessionID 在本机找 jsonl
    └── submit.py           把字段（含附件）推到飞书提交表

t001/base                   初始环境快照（这题的工作区代码）
├── t001/a                  A 跑完后的产物快照（parent = t001/base）
└── t001/b                  B 跑完后的产物快照（parent = t001/base）
```

代码放在按题命名的分支上（`t<编号>/base|a|b`），台账放在 `main`。这样模型跑题时工作区里只有这一题的代码，不会被其他题目干扰。

## 先读这个

项目原文和所有注意事项在 `docs/` 里，出题和提交前请至少过一遍：

| 文件 | 内容 |
|---|---|
| `docs/项目要点与注意事项.md` | 数据形态、两步流程、硬性要求、**易踩的坑自查清单** |
| `docs/提交字段与填表口径.md` | 飞书表的真实字段名、类型、可选项 |
| `docs/GSB理由写法与合格示例.md` | 三要素写法 + 两条真实合格样例 |
| `docs/雷同题黑名单.md` | 会被查重拒收的题目清单 |
| `docs/Pair-wise-GSB-项目-原文.md` | 飞书文档原文存档 |

## 运行环境

这台机器上 `python` 不在 PATH 里，用 `uv` 跑（仓库里已带了两个双击即用的包装脚本，
它们会 `chcp 65001` 再调用 `uv run python`）：

```bat
t list                     :: 等价于 uv run python tools/task.py list
t report T003
submit T003                :: 飞书表格 dry-run，只看要写什么
```

## A/B 并行跑（两个窗口同时跑）

可以，而且比"跑完 A 再重置跑 B"更不容易出错。关键是**两个窗口不能指着同一个目录**，
而是从同一个初始快照各铺一份副本：

```bat
t reset T004 --workspace D:\gsb\T004-a --force
t reset T004 --workspace D:\gsb\T004-b --force
```

两份都来自 `t004/base`，内容逐字节一致（想自查就 `Get-FileHash -Algorithm SHA256` 对一遍），
所以"同一起点"是构造出来的，不存在 A 的产物漏进 B 的问题。之后两个窗口各贴一次
**完全相同的 prompt**、各只跑首轮即可。

跑完分别记账，两个产物快照的父提交都会是 `t004/base`：

```bat
t record T004 a --workspace D:\gsb\T004-a --session <A-SessionID>
t record T004 b --workspace D:\gsb\T004-b --session <B-SessionID>
```

注意：

- 并行的只是**时间**，不是环境：同一台机器、同一个 Harness 和版本，这两条不变。
- 两个窗口里各自只能有 prompt；不要去对方的窗口里追问，也不要让两边互相看到。
- 录屏照旧两段，各录各的。
- 项目文档写的是"第一次跑完后 reset 再跑第二次"，那是单工作区的做法；它真正要保证的是
  两次跑**同一起点**，而核验方式就是两个产物快照的父提交都是初始环境快照 —— 并行复制同样满足。
- 要加 `--force` 是因为 `reset` 默认拒绝往这道题的"另一份"工作区里铺东西，防止手滑重置错目录。
  这道题已经登记过的工作区会列在 `tasks/<题号>/.workspace` 里（只在本机，不入库）。

## 两台电脑一起跑

台账（`main`）和每道题的代码分支（`t00X/base|a|b`）都在 GitHub 上，所以在另一台机器上
`git pull`（或重新 clone）之后，两边的题目都能看见、都能接着跑。

**在第二台机器上开始跑某道已经建好的题**（例如 T003）：

```bat
git pull
t reset T003 --workspace D:\work\T003
```

`reset` 会把 `t003/base` 的内容铺到工作区、顺手把工作区初始化成 git 仓库
（以后重置就走 `reset --hard` + `clean -fdx`），然后就可以照常跑 A / B。

**轨迹在另一台机器上跑出来的**（例如 A 在 A 机、B 在 B 机）：

```bat
:: 在跑出轨迹的那台机器上，先找到文件
uv run python tools/find_trajectory.py <SessionID>
:: 把那两个 jsonl 拷到这台机器，然后登记进台账
t set T003 --a-session <A-SessionID> --b-session <B-SessionID> ^
           --a-trajectory D:\from-other-pc\A.jsonl ^
           --b-trajectory D:\from-other-pc\B.jsonl
```

登记完 `t report T003` 就会把两条轨迹输出成**可点击直达本机文件**的链接。
注意：一台机器只能提供自己跑出来的产物快照，跨机器的那次跑要由**跑它的那台机器**提交
产物快照分支（A、B 的快照分支都必须在同一个远端仓库里，父提交是同一个 `t00X/base`）。

## 每道题的标准流程

1. **准备初始环境**：把题目要用的工作区准备好（干净、可运行），然后
   `t new T001 --workspace <工作区> --prompt-file <prompt.txt> --lang "..." --difficulty 困难 --harness "Codex CLI" --harness-version "0.153.4" --os Windows --task-type "0-1 代码生成" --env-level "无外部依赖"`
   → 生成 `t001/base` 分支并拿到**初始环境快照** SHA（必须在首轮开始前完成）。
2. **跑 A**：auto 模型、只跑首轮、不追问不纠错。跑完立刻
   `t record T001 a --workspace <工作区> --session <SessionID>`
3. **重置**：`t reset T001 --workspace <工作区>`
   （恢复初始环境并清掉 node_modules / venv / 构建产物等未跟踪文件）
4. **跑 B**：prompt、Harness 和版本、机器都要与 A 完全一致，同样只跑首轮。跑完
   `t record T001 b --workspace <工作区> --session <SessionID>`
5. **录屏**：A/B 各录一段，放到 `tasks/T001/recordings/A-*.mp4`、`B-*.mp4`，
   或用 `t set T001 --a-recording <路径> --b-recording <路径>` 登记。
6. **写 GSB**（人来写）：`t set T001 --gsb-conclusion "A 更好" --gsb-reason-file reason.md`
7. **取字段**：`t report T001`（不写题号就输出全部）→ 直接给出发提交表的内容，
   轨迹文件会输出成**可点击直达本机文件**的链接。
8. **上传**：`submit T001` 先 dry-run 看一遍，确认后 `submit T001 --write`。

## 提交表字段对照

| 字段 | 来自 |
|---|---|
| 语言/框架 | `meta.json` → `language_framework` |
| 初始环境快照 | `meta.json` → `initial_snapshot.permalink`（40 位完整 SHA） |
| A/B-SessionID | `meta.json` → `runs.A/B.session_id` |
| A/B-轨迹文件 | `tasks/<id>/trajectories/*.jsonl` 的下载链接 |
| A/B-产物快照 | `meta.json` → `runs.A/B.product_snapshot.permalink` |

## 自动上传到飞书表格

`tools/submit.py`（配 `tools/submit_config.json`）把台账直接推到提交表：

- **默认 dry-run**，不加 `--write` 不会写表；写表前还会先做一遍**缺字段自查**
  和 **A/B 产物快照父提交核验**（父提交必须是初始环境快照）。
- 表行自动按**初始环境快照 SHA** 匹配，匹配不到就用 `--uid 141` 或 `--record-id`。
- `A/B-轨迹文件`、`A/B-运行录屏` 是**附件字段**，会调用
  `base +record-upload-attachment` 上传本地文件。
- **GSB 理由必须由人写好**（`--gsb-reason-file`）。项目文档明确禁止用 AI 分析
  轨迹/产物或代写理由，本工具只负责搬运。
- `提交` 是按钮字段，接口不能代点：字段写完后要自己到表里点「提交」。

```bat
submit T003                                   :: dry-run，预览
submit T003 --uid 141                         :: 指定表里的 UID 行
submit T003 --write                           :: 真正写表（会二次确认）
```

## 硬性约束（来自项目文档）

- 初始环境快照必须在**首轮开始前**提交；A、B 产物快照的父提交都必须是它。
- 跑 B 之前必须把工作区重置回初始环境，并清掉未跟踪文件。
- 记录过的 SHA 不要 `amend`、`rebase`、`force-push`，否则历史改写后 SHA 不可达，数据会被打回。
- 只用 40 位完整 SHA，不要用短 SHA、分支名或 tag 代替。
- 两次跑之间不要改任何配置（`max context token` 保持 1000000），差异只应来自模型本身。
- 跑 A、B 时窗口里**只能有 prompt**；遇到 api error / 504 / 无报错中断就**新开窗口重跑**。
- 录屏：从干净状态启动、完整展示真实输出、**90 秒以内、720p、mp4**，跑不起来也要录报错。
- 不要把 `.env`、密钥、token、连接串提交进仓库；本仓库的 `.gitignore` 已覆盖常见情况，提交前仍要自查。
- 仓库必须让评测团队可访问：公开仓库，或私有但把评测方加为 collaborator。

## 常用命令

```bash
t list                              # 列出所有题目与状态
t report                            # 输出全部题目的提交字段
t report T003                       # 只输出某一题
uv run python tools/find_trajectory.py <SessionID>   # 按 SessionID 找轨迹文件
```

`find_trajectory.py` 会扫 `~/.codex/sessions`、`$CODEX_HOME/sessions`、家目录下所有
`.codex*/sessions`，以及 `~/.claude/projects`。轨迹是在**另一台机器**上跑的时候，
把那边的 `rollout-*.jsonl` 拷进 `tasks/<题号>/trajectories/` 即可。

## 交给助手（Codex）时，请提供

```
题号: T001                        # 不写就按顺序自动编号
prompt: <原文粘贴，或给出 prompt 文件路径>
工作区: <跑题所在的目录，例如 D:\work\T001>
语言/框架: Vue3, Express, SQLite
任务类型: Feature 迭代            # 0-1 代码生成 / Feature 迭代 / Bug 修复 / 代码理解 / 代码重构 / 工程化 / 代码测试
任务难度: 困难                    # 本期首轮只能困难/地狱
Harness: Codex CLI 0.5x           # 或 Claude Code + 版本号
操作系统: Windows
环境可复现等级: 无外部依赖        # 有外部依赖，未容器化 / 已容器化，可一键起环境
A-SessionID: <A 那次跑的 session id>
B-SessionID: <B 那次跑的 session id>
```

关键顺序：**A 跑完先提交 A 的产物快照，再重置工作区跑 B**。如果 A 跑完直接覆盖着跑 B，A 的产物就没法还原了（文档要求 A/B 的父提交都必须是初始快照）。跑完 A 后先把工作区另存一份，或立刻把上面信息发我，我来提交并重置。

助手会返回：语言/框架、初始环境快照、A/B-SessionID、A/B-轨迹文件（可点击直达本机文件）、A/B-产物快照。

## 网络提示

这台机器直连 `github.com` 的 TLS 会被间歇性掐断（`schannel: failed to receive handshake`）。本仓库已设置：

```
git config http.sslBackend openssl
git config http.version HTTP/1.1
```

换 OpenSSL 后端后推送即可成功。若其他仓库也遇到同样报错，可执行
`git config --global http.sslBackend openssl`。推送失败时直接重试：
`python work/push_retry.py`（本地脚本，带退避重试）。
