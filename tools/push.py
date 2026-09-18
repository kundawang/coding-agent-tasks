#!/usr/bin/env python3
"""带退避重试的 git push。

这台机器直连 github.com:443 会间歇性断（`Failed to connect` / `Recv failure` /
`schannel: failed to receive handshake`），推一次失败不代表仓库有问题，隔几秒重试通常就过了。

用法:
    uv run python tools/push.py            # 推 main + 所有 tXXX/* 本地分支
    uv run python tools/push.py T004       # 只推这道题涉及的分支
    uv run python tools/push.py --tries 8 --delay 6
"""

import argparse
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import task as task_mod  # noqa: E402


def push_once(refs):
    proc = subprocess.run(
        ["git", "push", "-u", "origin", *refs],
        cwd=task_mod.REPO, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def main():
    parser = argparse.ArgumentParser(description="带重试的 git push")
    parser.add_argument("id", nargs="?", help="题号，例如 T004；不给就推所有分支")
    parser.add_argument("--tries", type=int, default=6)
    parser.add_argument("--delay", type=float, default=5.0)
    args = parser.parse_args()

    if args.id:
        task_id = args.id.upper()
        refs = [b for b in task_mod.branches(task_id).values()
                if task_mod.git("rev-parse", "--verify", "--quiet", b, check=False)]
        refs.append("main")
    else:
        refs = []
        for name in task_mod.git("branch", "--format=%(refname:short)").splitlines():
            refs.append(name.strip())
        refs = [r for r in refs if r]

    if not refs:
        raise SystemExit("没有可推的分支")
    print("准备推送:", ", ".join(refs))

    for attempt in range(1, args.tries + 1):
        code, output = push_once(refs)
        if code == 0:
            print(f"第 {attempt} 次成功。")
            if output:
                print(output)
            owner, name = task_mod.remote_slug()
            if owner:
                print(f"https://github.com/{owner}/{name}")
            return 0
        print(f"第 {attempt} 次失败: {output.splitlines()[-1] if output else '(无输出)'}")
        if attempt < args.tries:
            time.sleep(args.delay)

    print(f"\n{args.tries} 次都没推上去。多半是网络，隔一会儿再跑一次同样的命令即可。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
