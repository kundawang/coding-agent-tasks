"""打印某个工作目录最近一次 CLI 会话的 SessionID 与轨迹路径。

    python tools/last_session.py <工作目录>
"""

import datetime as dt
import json
import os
import sys

HOME = os.path.expanduser("~")
ROOTS = [
    os.path.join(HOME, ".codex-cli", "sessions"),
    os.path.join(HOME, ".codex", "sessions"),
]


def main():
    if len(sys.argv) < 2:
        print("用法: python tools/last_session.py <工作目录>")
        return 1
    want = os.path.normcase(os.path.abspath(sys.argv[1]))

    best = None
    for root in ROOTS:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                if not name.endswith(".jsonl"):
                    continue
                path = os.path.join(dirpath, name)
                try:
                    with open(path, encoding="utf-8", errors="ignore") as fh:
                        meta = json.loads(fh.readline()).get("payload", {})
                except (OSError, ValueError):
                    continue
                cwd = meta.get("cwd") or ""
                if os.path.normcase(os.path.abspath(cwd)) != want:
                    continue
                mtime = os.path.getmtime(path)
                if best is None or mtime > best[0]:
                    best = (mtime, meta.get("session_id") or name, meta.get("cli_version") or "", path)

    if not best:
        print(f"没找到 {sys.argv[1]} 目录下的会话（这一轮可能还没开始）")
        return 1

    when = dt.datetime.fromtimestamp(best[0]).strftime("%m-%d %H:%M:%S")
    print("这个窗口最近一轮：")
    print(f"  SessionID : {best[1]}")
    print(f"  开始/写入 : {when}   CLI {best[2]}")
    print(f"  轨迹文件  : {best[3]}")
    print("把这行 SessionID 连同题号、A/B 发给助手即可。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
