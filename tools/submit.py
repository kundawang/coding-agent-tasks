#!/usr/bin/env python3
"""把一道题的提交字段推到飞书《Pair-wise GSB 项目》提交表。

用法（默认只预览，不写表）：

    uv run python tools/submit.py T003                 # 预览将要写入的字段
    uv run python tools/submit.py T003 --uid 141       # 指定表里的 UID 行
    uv run python tools/submit.py T003 --record-id recXXXX
    uv run python tools/submit.py T003 --write         # 真正写表
    uv run python tools/submit.py T003 --write --yes   # 跳过二次确认

设计约束（对着项目文档来的）：

- **默认 dry-run**，只有显式 `--write` 才会调用 lark-cli 写表。
- **GSB 理由必须是人写好的**（写进 `meta.json` 的 `gsb.reason`，或用
  `--gsb-reason-file` 给一个文件）。本工具只负责搬运，不生成、不润色任何理由
  —— 项目文档明确禁止用 AI 分析轨迹/产物或代写 GSB 理由。
- 附件（`A/B-轨迹文件`、`A/B-运行录屏`）走 `base +record-upload-attachment`。
- `提交`、`领取题目` 是按钮字段，接口不能代点；字段写完后要人工在表里点「提交」。
- 公式字段（`字段检查`、`当日提交数量`、`是否在领题平台领题`、`uid-领取题目`）只读，不写。
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TOOLS)
TASKS = os.path.join(REPO, "tasks")
CONFIG_PATH = os.path.join(TOOLS, "submit_config.json")

try:  # Windows 控制台默认可能不是 utf-8
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


# ---------------------------------------------------------------- lark-cli

def lark_bin():
    """Windows 上 lark-cli 是 .cmd/.ps1 垫片，subprocess 直接给裸名字会找不到。"""
    for name in ("lark-cli.cmd", "lark-cli.exe", "lark-cli"):
        path = shutil.which(name)
        if path:
            return path
    return "lark-cli"


def lark(args, expect_ok=True):
    """调用 lark-cli，返回解析后的 JSON。"""
    proc = subprocess.run([lark_bin(), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    raw = (proc.stdout or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        if expect_ok:
            raise SystemExit(f"lark-cli 返回了非 JSON 内容：\n{raw[:800]}\n{proc.stderr[:400]}")
        return None
    if expect_ok and not data.get("ok"):
        err = data.get("error", {})
        raise SystemExit(
            f"lark-cli {' '.join(args)} 失败：{err.get('code', '')} {err.get('message', '')}\n"
            f"{err.get('hint', '')}"
        )
    return data


def load_config():
    if not os.path.exists(CONFIG_PATH):
        raise SystemExit(f"缺少配置文件 {CONFIG_PATH}")
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------- 数据准备

def task_dir(task_id):
    return os.path.join(TASKS, task_id.upper())


def load_meta(task_id):
    path = os.path.join(task_dir(task_id), "meta.json")
    if not os.path.exists(path):
        raise SystemExit(f"题目 {task_id} 不存在（缺 {path}）")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def read_prompt(meta, task_id):
    name = meta.get("prompt_file") or "prompt.md"
    path = os.path.join(task_dir(task_id), name)
    if not os.path.exists(path):
        return ""
    return open(path, encoding="utf-8").read().strip()


# 题目台账里写的是人话版本，表里的单选选项是紧凑版本，这里做一次归一化
TASK_TYPE_ALIASES = {
    "0-1 代码生成": "0-1代码生成",
    "0-1代码生成": "0-1代码生成",
    "01代码生成": "0-1代码生成",
    "feature 迭代": "feature迭代",
    "feature迭代": "feature迭代",
    "功能迭代": "feature迭代",
    "bug 修复": "Bug修复",
    "bug修复": "Bug修复",
    "代码理解": "代码理解",
    "代码重构": "代码重构",
    "工程化": "工程化",
    "代码测试": "代码测试",
}

SHA40 = re.compile(r"\b[0-9a-f]{40}\b")


def norm_task_type(value):
    if not value:
        return ""
    key = value.strip()
    if key in TASK_TYPE_ALIASES:
        return TASK_TYPE_ALIASES[key]
    low = key.lower().replace(" ", "")
    for alias, canon in TASK_TYPE_ALIASES.items():
        if alias.lower().replace(" ", "") == low:
            return canon
    return key.replace(" ", "")


def permalink_of(entry):
    """产物快照字段要 40 位完整 SHA 的 permalink。"""
    return (entry or {}).get("product_snapshot_permalink") or ""


def scan_recordings(task_id, role):
    """按约定找录屏：tasks/<id>/recordings/<A|B>-*.mp4，或 tasks/<id>/<A|B>-运行录屏.mp4"""
    base = task_dir(task_id)
    patterns = [
        os.path.join(base, "recordings", f"{role}-*.mp4"),
        os.path.join(base, "recordings", f"{role.upper()}-*.mp4"),
        os.path.join(base, f"{role}-运行录屏.mp4"),
        os.path.join(base, f"{role.upper()}-运行录屏.mp4"),
    ]
    hits = []
    for pattern in patterns:
        hits.extend(sorted(glob.glob(pattern)))
    return hits[0] if hits else ""


def build_fields(meta, task_id, args):
    """组装要写进表里的字段（按飞书表的真实字段名）。"""
    init = meta.get("initial_snapshot") or {}
    a = (meta.get("runs") or {}).get("A") or {}
    b = (meta.get("runs") or {}).get("B") or {}
    gsb = meta.get("gsb") or {}

    reason = gsb.get("reason") or ""
    if args.gsb_reason_file:
        reason = open(args.gsb_reason_file, encoding="utf-8").read().strip()
    conclusion = args.gsb_conclusion or gsb.get("conclusion") or ""

    def sel(value):
        return [value] if value else None

    fields = {
        "User Prompt": read_prompt(meta, task_id) or None,
        "任务类型": sel(norm_task_type(meta.get("task_type"))),
        "任务难度": sel(meta.get("difficulty")),
        "语言/框架": meta.get("language_framework") or None,
        "Harness": sel(meta.get("harness")),
        "Harness 版本": meta.get("harness_version") or None,
        "操作系统": sel(meta.get("os")),
        "环境可复现等级": sel(meta.get("env_level")),
        "初始环境快照": init.get("permalink") or None,
        "A-SessionID": a.get("session_id") or None,
        "A-产物快照": permalink_of(a) or None,
        "B-SessionID": b.get("session_id") or None,
        "B-产物快照": permalink_of(b) or None,
        "GSB 结论": sel(conclusion),
        "GSB 理由": reason or None,
        "有效性": sel(meta.get("validity") or "有效"),
        "备注": meta.get("remark") or meta.get("notes") or None,
    }
    return {k: v for k, v in fields.items() if v not in (None, "", [])}


def attachments(meta, task_id, args):
    """返回 {字段名: [本地文件路径]}。"""
    out = {}
    a = (meta.get("runs") or {}).get("A") or {}
    b = (meta.get("runs") or {}).get("B") or {}

    for role, entry in (("A", a), ("B", b)):
        traj = entry.get("trajectory_local") or ""
        if not traj:
            # 轨迹没记录进 meta 时，退回按 SessionID 在 trajectories/ 里找
            sid = entry.get("session_id") or ""
            if sid:
                hits = glob.glob(os.path.join(task_dir(task_id), "trajectories", f"*{sid}*.jsonl"))
                traj = hits[0] if hits else ""
        if traj and os.path.exists(traj):
            out[f"{role}-轨迹文件"] = [traj]

    for role, flag in (("A", args.a_recording), ("B", args.b_recording)):
        recorded = ((meta.get("runs") or {}).get(role) or {}).get("recording_local") or ""
        path = flag or recorded or scan_recordings(task_id, role)
        if path and os.path.exists(path):
            out[f"{role}-运行录屏"] = [path]
    return out


def check_blockers(meta, task_id, fields, attach):
    """提交前的自查：缺什么就明确列出来（文档要求必须填全）。"""
    problems = []
    if not fields.get("User Prompt"):
        problems.append("缺 User Prompt（tasks/<id>/prompt.md 为空）")
    if not fields.get("任务类型"):
        problems.append("缺 任务类型")
    if not fields.get("任务难度"):
        problems.append("缺 任务难度")
    if not fields.get("语言/框架"):
        problems.append("缺 语言/框架")
    if not fields.get("Harness 版本"):
        problems.append("缺 Harness 版本（必填，两次跑必须同一个版本）")
    if not fields.get("操作系统"):
        problems.append("缺 操作系统")
    if not fields.get("GSB 结论"):
        problems.append("缺 GSB 结论")
    if not fields.get("GSB 理由"):
        problems.append("缺 GSB 理由（必须由人写，用 --gsb-reason-file 或 meta.json 的 gsb.reason）")

    init = (meta.get("initial_snapshot") or {}).get("permalink") or ""
    if not SHA40.search(init):
        problems.append("初始环境快照不是 40 位完整 SHA 的 permalink")

    for role in ("A", "B"):
        entry = (meta.get("runs") or {}).get(role) or {}
        if not entry.get("session_id"):
            problems.append(f"缺 {role}-SessionID")
        snap = permalink_of(entry)
        if not SHA40.search(snap):
            problems.append(f"缺 {role}-产物快照（40 位完整 SHA 的 permalink）")
        if f"{role}-轨迹文件" not in attach:
            problems.append(f"找不到 {role}-轨迹文件（jsonl）")
        if f"{role}-运行录屏" not in attach:
            problems.append(f"找不到 {role}-运行录屏（mp4，90 秒内 / 720p）")

    # 产物快照的父提交必须是初始环境快照
    return problems


def parent_of(sha):
    proc = subprocess.run(["git", "rev-parse", f"{sha}^"], cwd=REPO,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.stdout.strip() if proc.returncode == 0 else ""


def check_parents(meta):
    """核验 A/B 产物快照的父提交确实是初始环境快照。"""
    init_sha = ((meta.get("initial_snapshot") or {}).get("sha") or "").strip()
    issues = []
    if not init_sha:
        return ["初始环境快照 SHA 为空，无法核验父提交"]
    for role in ("A", "B"):
        entry = (meta.get("runs") or {}).get(role) or {}
        sha = (entry.get("product_snapshot_sha") or "").strip()
        if not sha:
            issues.append(f"{role}-产物快照 SHA 为空，无法核验父提交")
            continue
        parent = parent_of(sha)
        if not parent:
            issues.append(f"{role}-产物快照 {sha[:12]} 在当前仓库里找不到")
        elif parent != init_sha:
            issues.append(
                f"{role}-产物快照的父提交是 {parent[:12]}，不是初始环境快照 "
                f"{init_sha[:12]} —— 会被判定两次跑不同起点"
            )
    return issues


# ---------------------------------------------------------------- 定位记录

def list_my_records(cfg, submitter_field="提交人"):
    """按提交人搜出本人在表里的行，返回 [{record_id, uid, snapshot}]。"""
    out, offset = [], 0
    name = cfg.get("submitter_name") or ""
    while True:
        data = lark([
            "base", "+record-search",
            "--base-token", cfg["base_token"],
            "--table-id", cfg["table_id"],
            "--keyword", name,
            "--search-field", submitter_field,
            "--field-id", "UID",
            "--field-id", "初始环境快照",
            "--field-id", "提交人",
            "--limit", "200",
            "--offset", str(offset),
            "--format", "json",
        ])
        d = data["data"]
        names = d.get("fields") or []
        rows = d.get("data") or []
        ids = d.get("record_id_list") or []
        idx_uid = names.index("UID") if "UID" in names else None
        idx_snap = names.index("初始环境快照") if "初始环境快照" in names else None
        for i, rid in enumerate(ids):
            row = rows[i] if i < len(rows) else []
            uid = row[idx_uid] if idx_uid is not None and idx_uid < len(row) else ""
            snap = row[idx_snap] if idx_snap is not None and idx_snap < len(row) else ""
            snap = snap or ""
            out.append({
                "record_id": rid,
                "uid": str(uid or "").strip(),
                "snapshot": snap,
            })
        if not d.get("has_more"):
            break
        offset += len(ids)
        if not ids:
            break
    return out


def strip_markdown_link(value):
    """[文本](url) → url；纯文本原样返回。"""
    if not value:
        return ""
    m = re.search(r"\]\((https?://[^)]+)\)", value)
    return m.group(1) if m else value


def resolve_record(cfg, meta, task_id, args):
    if args.record_id:
        return args.record_id, "命令行指定"
    pinned = (cfg.get("records") or {}).get(task_id.upper(), {}).get("record_id")
    if pinned:
        return pinned, "配置记录"

    records = list_my_records(cfg)
    if not records:
        raise SystemExit(
            f"在表里没搜到提交人「{cfg.get('submitter_name')}」的行。"
            "请确认 submit_config.json 里的 submitter_name / base_token / table_id。"
        )

    if args.uid:
        for rec in records:
            if rec["uid"] == str(args.uid):
                return rec["record_id"], f"UID={args.uid}"
        print(f"提示：UID={args.uid} 没在本人行里找到，可用行："
              + ", ".join(r["uid"] for r in records))

    init_sha = ((meta.get("initial_snapshot") or {}).get("sha") or "").strip()
    if init_sha:
        for rec in records:
            if init_sha in strip_markdown_link(rec["snapshot"]):
                return rec["record_id"], f"按初始环境快照 {init_sha[:12]} 匹配到"

    raise SystemExit(
        f"无法自动定位 {task_id} 对应的表行。请先用 --uid 指定。\n"
        "本人现有行：" + ", ".join(f"UID={r['uid']}({r['record_id']})" for r in records)
    )


# ---------------------------------------------------------------- 主流程

def preview(fields, attach, blocked, parent_issues, record_id, why):
    print("=" * 72)
    print(f"目标记录: {record_id}    （{why}）")
    print("=" * 72)
    print("\n[文本/单选字段]")
    for key, value in fields.items():
        if isinstance(value, list):
            value = value[0] if value else ""
        text = str(value)
        if len(text) > 200:
            text = text[:200] + f" …(共 {len(str(value))} 字)"
        print(f"  {key:12s} = {text}")

    print("\n[附件字段]")
    if attach:
        for key, paths in attach.items():
            for path in paths:
                size = os.path.getsize(path) / 1024
                print(f"  {key:12s} = {path}  ({size:.0f} KB)")
    else:
        print("  （无）")

    if parent_issues:
        print("\n[父提交核验] 有问题：")
        for issue in parent_issues:
            print(f"  ! {issue}")
    else:
        print("\n[父提交核验] A/B 产物快照的父提交都是初始环境快照 ✓")

    if blocked:
        print("\n[缺字段] 还不能提交：")
        for item in blocked:
            print(f"  - {item}")
    else:
        print("\n[缺字段] 无，字段齐了 ✓")
    print()


def main():
    parser = argparse.ArgumentParser(description="把题目提交字段推到飞书提交表（默认 dry-run）")
    parser.add_argument("id", help="题号，例如 T003")
    parser.add_argument("--uid", help="表里的 UID 行号")
    parser.add_argument("--record-id", dest="record_id", help="直接指定 record_id")
    parser.add_argument("--gsb-conclusion", dest="gsb_conclusion", help="A 更好 / Same / B 更好")
    parser.add_argument("--gsb-reason-file", dest="gsb_reason_file", help="人写好的 GSB 理由文件")
    parser.add_argument("--a-recording", dest="a_recording", help="A 的录屏 mp4 路径")
    parser.add_argument("--b-recording", dest="b_recording", help="B 的录屏 mp4 路径")
    parser.add_argument("--write", action="store_true", help="真正写入飞书表格")
    parser.add_argument("--yes", action="store_true", help="跳过二次确认")
    parser.add_argument("--allow-incomplete", action="store_true",
                        help="即使缺字段也写入（一般不要用）")
    args = parser.parse_args()

    task_id = args.id.upper()
    cfg = load_config()
    meta = load_meta(task_id)
    fields = build_fields(meta, task_id, args)
    attach = attachments(meta, task_id, args)
    blocked = check_blockers(meta, task_id, fields, attach)
    parent_issues = check_parents(meta)

    try:
        record_id, why = resolve_record(cfg, meta, task_id, args)
    except SystemExit as exc:
        if args.write:
            raise
        print(f"[dry-run] 未定位到表行：{exc}\n")
        record_id, why = "(未定位)", "dry-run"

    preview(fields, attach, blocked, parent_issues, record_id, why)

    if not args.write:
        print("这是 dry-run，没有写表。确认无误后加 --write 执行。")
        return 0

    if (blocked or parent_issues) and not args.allow_incomplete:
        raise SystemExit("存在缺字段或父提交问题，已中止写入。确认要强写请加 --allow-incomplete。")

    if not args.yes:
        answer = input(f"确认把以上内容写入 {record_id}？输入 yes 继续：").strip().lower()
        if answer != "yes":
            print("已取消。")
            return 1

    payload = json.dumps(fields, ensure_ascii=False)
    lark([
        "base", "+record-upsert",
        "--base-token", cfg["base_token"],
        "--table-id", cfg["table_id"],
        "--record-id", record_id,
        "--json", payload,
    ])
    print(f"字段已写入 {record_id}")

    for field_name, paths in attach.items():
        lark([
            "base", "+record-upload-attachment",
            "--base-token", cfg["base_token"],
            "--table-id", cfg["table_id"],
            "--record-id", record_id,
            "--field-id", field_name,
            *[arg for path in paths for arg in ("--file", path)],
        ])
        print(f"附件已上传 {field_name}: {', '.join(os.path.basename(p) for p in paths)}")

    print("\n字段写完了。")
    print("「提交」是按钮字段，接口不能代点 —— 请到表里确认内容后自己点「提交」。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
