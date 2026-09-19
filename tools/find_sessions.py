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
                    "label": label,
                    "session": meta.get("session_id") or name,
                    "cli": meta.get("cli_version") or "",
                    "cwd": meta.get("cwd") or "",
                    "prompt": prompt_head(path),
                    "file": path,
                })
    rows.sort(key=lambda r: -r["when"])
    return rows


def main(limit=12):
    rows = collect()
    print(f"最近 {min(limit, len(rows))} 个会话（按时间倒序）\n")
    for row in rows[:limit]:
        when = dt.datetime.fromtimestamp(row["when"]).strftime("%m-%d %H:%M")
        print(f"[{when}] {row['session']}")
        print(f"    跑的目录 : {row['cwd'] or '(未知)'}")
        if row["cli"]:
            print(f"    客户端   : {row['label']} cli={row['cli']}")
        if row["prompt"]:
            print(f"    prompt   : {row['prompt']}")
        print(f"    轨迹文件 : {row['file']}")
        print()
    print("SessionID 就是上面第一行的 UUID。发给助手时写成：题号 + 轮次 + SessionID（例如 T007 B 01a0b488-...）。")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 12)
