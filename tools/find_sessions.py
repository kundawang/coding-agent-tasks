"""列出最近跑过的会话：时间、SessionID、跑的目录、prompt 开头、轨迹文件路径。

    python tools/find_sessions.py [条数]

同时扫三个位置：
    ~/.codex-cli/sessions    隔离配置的 Codex CLI
    ~/.codex/sessions        桌面版 Codex
    ~/.claude/projects       Claude Code
"""

import datetime as dt
import json
import os
import re
import subprocess
import sys

HOME = os.path.expanduser("~")
ROOTS = [
    ("CLI", os.path.join(HOME, ".codex-cli", "sessions")),
    ("Desktop", os.path.join(HOME, ".codex", "sessions")),
    ("Claude", os.path.join(HOME, ".claude", "projects")),
]


def prompt_head(path, chars=60):
    """挑出第一条用户输入的前几个字，方便认是哪道题。"""
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            for _ in range(400):
                line = fh.readline()
                if not line:
                    break
                if '"role"' not in line or '"user"' not in line:
                    continue
                try:
                    item = json.loads(line)
                except ValueError:
                    continue
                payload = item.get("payload", {})
                if payload.get("role") != "user":
                    continue
                chunks = []
                for part in payload.get("content", []):
                    if isinstance(part, dict) and part.get("type") in ("input_text", "text"):
                        chunks.append(part.get("text", ""))
                text = " ".join(chunks).strip().replace("\n", " ")
                if text and not text.startswith("<environment_context>"):
                    return text[:chars]
    except OSError:
        return ""
    return ""


def start_time(name):
    """从文件名 rollout-2026-09-18T20-40-35-<uuid>.jsonl 里取会话开始时间。"""
    match = re.search(r"rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})", name)
    if not match:
        return None
    date, hour, minute, second = match.groups()
    try:
        return dt.datetime.fromisoformat(f"{date}T{hour}:{minute}:{second}")
    except ValueError:
        return None


def running_process_starts():
    """拿还在运行的 codex / claude 进程的启动时间，用来判断哪些会话的窗口还开着。"""
    script = (
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.Name -match 'codex|claude' } | "
        "ForEach-Object { '{0:yyyy-MM-ddTHH:mm:ss}' -f $_.CreationDate }"
    )
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=25,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    times = []
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        try:
            times.append(dt.datetime.fromisoformat(line))
        except ValueError:
            continue
    return times


def collect():
    rows = []
    for label, root in ROOTS:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                if not name.endswith(".jsonl"):
                    continue
                path = os.path.join(dirpath, name)
                meta = {}
                try:
                    with open(path, encoding="utf-8", errors="ignore") as fh:
                        meta = json.loads(fh.readline()).get("payload", {})
                except (OSError, ValueError):
                    pass
                rows.append({
                    "when": os.path.getmtime(path),
                    "started": start_time(name),
                    "label": label,
                    "session": meta.get("session_id") or name,
                    "cli": meta.get("cli_version") or "",
                    "cwd": meta.get("cwd") or "",
                    "prompt": prompt_head(path),
                    "file": path,
                })
    rows.sort(key=lambda r: -r["when"])
    return rows


def main(limit=6, since_minutes=None):
    rows = collect()
    now = dt.datetime.now()
    if since_minutes:
        rows = [r for r in rows if (now - dt.datetime.fromtimestamp(r["when"])).total_seconds() <= since_minutes * 60]

    procs = running_process_starts()
    rows = rows[:limit]
    live = [r for r in rows if (now - dt.datetime.fromtimestamp(r["when"])).total_seconds() <= 15 * 60]
    print(f"本机累计 {len(collect())} 个会话；现在还在跑的 codex/claude 进程 {len(procs)} 个")
    print("下面列最近的 %d 条：\n" % len(rows))

    for row in rows:
        last = dt.datetime.fromtimestamp(row["when"]).strftime("%m-%d %H:%M")
        begin = row["started"].strftime("%m-%d %H:%M:%S") if row["started"] else "(未知)"
        open_now = False
        if row["started"]:
            open_now = any(abs((row["started"] - t).total_seconds()) <= 15 for t in procs)
        tag = "[窗口还开着]" if open_now else "[已结束]"
        extra = "  刚刚还在写" if (now - dt.datetime.fromtimestamp(row["when"])).total_seconds() <= 15 * 60 else ""
        print(f"{tag} 开始 {begin}  最后写入 {last}{extra}")
        print(f"    SessionID: {row['session']}")
        print(f"    跑的目录 : {row['cwd'] or '(未知)'}")
        if row["cli"]:
            print(f"    客户端   : {row['label']} cli={row['cli']}")
        if row["prompt"]:
            print(f"    prompt   : {row['prompt']}")
        print(f"    轨迹文件 : {row['file']}")
        print()
    print("[窗口还开着] = 还有对应的 codex/claude 进程在跑（可能是空闲挂着）。")
    print("SessionID 就是上面那一行的 UUID。发给助手时写成：题号 + 轮次 + SessionID（例如 T007 B 01a0b488-...）。")
    print("只看最近 30 分钟：把参数写成  30 30   （第一个是条数，第二个是分钟数）")


if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    since = int(sys.argv[2]) if len(sys.argv) > 2 else None
    main(limit, since)
