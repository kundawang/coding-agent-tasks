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
