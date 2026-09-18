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
│       ├── TASK.md         自动生成的人类可读汇总
│       └── trajectories/   A/B 轨迹 jsonl
└── tools/                  自动化脚本

t001/base                   初始环境快照（这题的工作区代码）
├── t001/a                  A 跑完后的产物快照（parent = t001/base）
└── t001/b                  B 跑完后的产物快照（parent = t001/base）
```

代码放在按题命名的分支上（`t<编号>/base|a|b`），台账放在 `main`。这样模型跑题时工作区里只有这一题的代码，不会被其他题目干扰。

## 每道题的标准流程

1. **准备初始环境**：把题目要用的工作区准备好（干净、可运行），然后
   `python tools/task.py new T001 --workspace <工作区> --prompt-file <prompt.txt> --lang "..." --difficulty 困难 --harness "..." --os Windows --task-type "0-1 代码生成" --env-level "无外部依赖"`
   → 生成 `t001/base` 分支并拿到**初始环境快照** SHA（必须在首轮开始前完成）。
2. **跑 A**：auto 模型、只跑首轮、不追问不纠错。跑完立刻
   `python tools/task.py record T001 a --workspace <工作区> --session <SessionID>`
3. **重置**：`python tools/task.py reset T001 --workspace <工作区>`
   （恢复初始环境并清掉 node_modules / venv / 构建产物等未跟踪文件）
4. **跑 B**：prompt、Harness 和版本、机器都要与 A 完全一致，同样只跑首轮。跑完
   `python tools/task.py record T001 b --workspace <工作区> --session <SessionID>`
5. **取字段**：`python tools/task.py report T001` → 直接输出提交表要填的内容。

## 提交表字段对照

| 字段 | 来自 |
|---|---|
| 语言/框架 | `meta.json` → `language_framework` |
| 初始环境快照 | `meta.json` → `initial_snapshot.permalink`（40 位完整 SHA） |
| A/B-SessionID | `meta.json` → `runs.A/B.session_id` |
| A/B-轨迹文件 | `tasks/<id>/trajectories/*.jsonl` 的下载链接 |
| A/B-产物快照 | `meta.json` → `runs.A/B.product_snapshot.permalink` |

## 硬性约束（来自项目文档）

- 初始环境快照必须在**首轮开始前**提交；A、B 产物快照的父提交都必须是它。
- 跑 B 之前必须把工作区重置回初始环境，并清掉未跟踪文件。
- 记录过的 SHA 不要 `amend`、`rebase`、`force-push`，否则历史改写后 SHA 不可达，数据会被打回。
- 只用 40 位完整 SHA，不要用短 SHA、分支名或 tag 代替。
- 两次跑之间不要改任何配置（`max context token` 保持 1000000），差异只应来自模型本身。
- 不要把 `.env`、密钥、token、连接串提交进仓库；本仓库的 `.gitignore` 已覆盖常见情况，提交前仍要自查。
- 仓库必须让评测团队可访问：公开仓库，或私有但把评测方加为 collaborator。

## 常用命令

```bash
python tools/task.py list                 # 列出所有题目与状态
python tools/task.py report T001          # 输出提交字段
python tools/find_trajectory.py <SessionID>   # 按 SessionID 找轨迹文件
```

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
