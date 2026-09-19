"""告诉当前窗口对应哪一轮：SessionID、开始时间、跑的目录、prompt 开头。

原理：本窗口的 shell → 它下面的 node/codex 子进程 → 用它们的启动时间去匹配会话文件
（rollout-<时间>-<sessionid>.jsonl）。所以不依赖窗口标题，也不需要记 SessionID。
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


def processes():
    script = (
        "Get-CimInstance Win32_Process | "
        "Select-Object ProcessId,ParentProcessId,Name,CreationDate | "
        "ForEach-Object { '{0}|{1}|{2}|{3:yyyy-MM-ddTHH:mm:ss}' -f "
        "$_.ProcessId, $_.ParentProcessId, $_.Name, $_.CreationDate }"
    )
    proc = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                          capture_output=True, text=True, encoding="utf-8", errors="replace",
                          timeout=30)
    out = []
    for line in (proc.stdout or "").splitlines():
        parts = line.strip().split("|")
        if len(parts) != 4 or not parts[0].isdigit():
            continue
        try:
            created = dt.datetime.fromisoformat(parts[3])
        except ValueError:
            created = None
        out.append({"pid": int(parts[0]), "ppid": int(parts[1]) if parts[1].isdigit() else 0,
                    "name": parts[2], "created": created})
    return out


def ancestors(procs, pid, depth=8):
    by_pid = {p["pid"]: p for p in procs}
    chain = []
    current = by_pid.get(pid)
    while current and depth > 0:
        chain.append(current)
        current = by_pid.get(current["ppid"])
        depth -= 1
    return chain


def descendants(procs, pid):
    out, frontier = [], [pid]
    while frontier:
        current = frontier.pop()
        for p in procs:
            if p["ppid"] == current:
                out.append(p)
                frontier.append(p["pid"])
    return out


def sessions():
    rows = []
    for label, root in ROOTS:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                if not name.endswith(".jsonl"):
                    continue
                match = re.search(r"rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})", name)
                started = None
                if match:
                    try:
                        started = dt.datetime.fromisoformat(
                            f"{match.group(1)}T{match.group(2)}:{match.group(3)}:{match.group(4)}")
                    except ValueError:
                        started = None
                path = os.path.join(dirpath, name)
                head = ""
                try:
                    with open(path, encoding="utf-8", errors="ignore") as fh:
                        for _ in range(300):
                            line = fh.readline()
                            if not line:
                                break
                            if '"role"' not in line or '"user"' not in line:
                                continue
                            item = json.loads(line)
                            if item.get("payload", {}).get("role") != "user":
                                continue
                            chunks = [part.get("text", "") for part in item["payload"].get("content", [])
                                      if isinstance(part, dict) and part.get("type") in ("input_text", "text")]
                            text = " ".join(chunks).strip().replace("\n", " ")
                            if text and not text.startswith("<environment_context>"):
                                head = text[:50]
                                break
                except (OSError, ValueError):
                    pass
                sid = name
                try:
                    sid = json.loads(open(path, encoding="utf-8", errors="ignore").readline())["payload"]["session_id"]
                except Exception:
                    sid = re.sub(r"^rollout-.*?-(?=[0-9a-f]{8}-)", "", name).replace(".jsonl", "")
                rows.append({"started": started, "session": sid, "head": head, "label": label, "file": path})
    return rows


def main():
    procs = processes()
    me = os.getpid()
    chain = ancestors(procs, me)
    shells = [p for p in chain if p["name"].lower() in ("cmd.exe", "pwsh.exe", "powershell.exe")]
    anchor = shells[-1] if shells else (chain[-1] if chain else None)

    launch = None
    if anchor:
        kids = descendants(procs, anchor["pid"])
        runners = [p for p in kids if p["created"] and re.search(r"codex|node", p["name"], re.I)]
        if runners:
            launch = min(p["created"] for p in runners)
    if launch is None and anchor:
        launch = anchor["created"]

    if launch is None:
        print("没识别出这个窗口跑了什么（拿不到进程启动时间）")
        return 1

    rows = [r for r in sessions() if r["started"]]
    rows.sort(key=lambda r: abs((r["started"] - launch).total_seconds()))
    best = rows[0] if rows else None
    gap = abs((best["started"] - launch).total_seconds()) if best else None

    print(f"这个窗口的会话开始时间约 {launch.strftime('%m-%d %H:%M:%S')}")
    if not best or gap > 180:
        print("没找到时间对得上的会话（可能这一轮还没开始，或者用的是别的客户端）")
        return 1

    print(f"→ SessionID : {best['session']}")
    print(f"  开始时间  : {best['started'].strftime('%m-%d %H:%M:%S')}  （差 {gap:.0f} 秒）")
    print(f"  客户端    : {best['label']}")
    if best["head"]:
        print(f"  prompt    : {best['head']}")
    print(f"  轨迹文件  : {best['file']}")
    print()
    print("把上面这行 SessionID 连同题号、A/B 发给助手即可。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
