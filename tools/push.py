#!/usr/bin/env python3
"""带退避重试的 git push。

这台机器直连 github.com:443 会间歇性断（`Failed to connect` / `Recv failure` /
`schannel: failed to receive handshake`），推一次失败不代表仓库有问题，隔几秒重试通常就过了。

用法:
    uv run python tools/push.py            # 推 main + 所有 tXXX/* 本地分支
    uv run python tools/push.py T004       # 只推这道题涉及的分支
    uv run python tools/push.py --tries 8 --delay 6

HTTPS 连不上 github.com:443 时会自动改走 SSH（ssh.github.com:443）。
走 SSH 需要先把 ~/.ssh/id_ed25519_kundawang.pub 加到 GitHub 账号的 SSH keys 里：
    https://github.com/settings/ssh/new
"""

import argparse
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import task as task_mod  # noqa: E402

SSH_KEY = os.path.join(os.path.expanduser("~"), ".ssh", "id_ed25519_kundawang")
SSH_URL = "git@github.com:kundawang/coding-agent-tasks.git"


def ssh_ready():
    return os.path.exists(SSH_KEY)


def push_once(refs, via_ssh=False):
    cmd = ["git"]
    if via_ssh:
        cmd += ["-c", f"core.sshCommand=ssh -i {SSH_KEY} -o HostName=ssh.github.com "
                      f"-o Port=443 -o StrictHostKeyChecking=accept-new"]
    cmd += ["push", "-u", "origin" if not via_ssh else SSH_URL, *refs]
    proc = subprocess.run(
        cmd,
        cwd=task_mod.REPO, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def main():
    parser = argparse.ArgumentParser(description="带重试的 git push")
    parser.add_argument("id", nargs="?", help="题号，例如 T004；不给就推所有分支")
    parser.add_argument("--tries", type=int, default=6)
    parser.add_argument("--delay", type=float, default=5.0)
    parser.add_argument("--ssh", action="store_true", help="直接走 SSH（ssh.github.com:443）")
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

    use_ssh = args.ssh
    for attempt in range(1, args.tries + 1):
        if use_ssh and not ssh_ready():
            print(f"想走 SSH 但没找到 {SSH_KEY}，先按 README 的说明把公钥加到 GitHub。")
            return 1
        code, output = push_once(refs, via_ssh=use_ssh)
        if code == 0:
            print(f"第 {attempt} 次成功（{'SSH' if use_ssh else 'HTTPS'}）。")
            if output:
                print(output)
            owner, name = task_mod.remote_slug()
            if owner:
                print(f"https://github.com/{owner}/{name}")
            return 0
        print(f"第 {attempt} 次失败: {output.splitlines()[-1] if output else '(无输出)'}")

        # HTTPS 打在 github.com:443 上，这台机器会间歇性被掐；换 SSH 试
        if (not use_ssh and ssh_ready()
                and ("Failed to connect" in output or "Recv failure" in output
                     or "Connection was reset" in output)):
            print("HTTPS 连不上，改走 SSH（ssh.github.com:443）…")
            use_ssh = True
            continue

        if attempt < args.tries:
            time.sleep(args.delay)

    if not ssh_ready():
        print(f"\n{args.tries} 次都没推上去，多半是 github.com:443 又被掐了。"
              f"\n想彻底绕开：生成 SSH key 后加到 https://github.com/settings/ssh/new ，"
              f"再用 push.cmd --ssh。")
    else:
        print(f"\n{args.tries} 次都没推上去，隔一会儿再跑一次同样的命令。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
