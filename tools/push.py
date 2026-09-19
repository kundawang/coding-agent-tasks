#!/usr/bin/env python3
"""带退避重试的 git push。

这台机器直连 github.com:443 会间歇性断（`Failed to connect` / `Recv failure` /
`schannel: failed to receive handshake`），推一次失败不代表仓库有问题，隔几秒重试通常就过了。

用法:
    uv run python tools/push.py            # 推 main + 所有 tXXX/* 本地分支
    uv run python tools/push.py T004       # 只推这道题涉及的分支
    uv run python tools/push.py --tries 8 --delay 6

HTTPS 连不上 github.com:443 时会自动改走 SSH（ssh.github.com:443）。
走 SSH 需要先把自己的公钥加到 GitHub 账号的 SSH keys 里：https://github.com/settings/ssh/new
密钥路径默认取 ~/.ssh/id_ed25519，也可以用环境变量 GSB_SSH_KEY 指定。
"""

import argparse
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import task as task_mod  # noqa: E402

SSH_KEY = os.environ.get("GSB_SSH_KEY") or os.path.join(os.path.expanduser("~"), ".ssh", "id_ed25519")


def ssh_url():
    owner, name = task_mod.remote_slug()
    return f"git@github.com:{owner}/{name}.git" if owner else ""


def ssh_ready():
    return os.path.exists(SSH_KEY)


CONNECTION_ERRORS = ("Failed to connect", "Recv failure", "Connection was reset",
                     "Could not connect to server")


def is_connection_error(output):
    return any(mark in output for mark in CONNECTION_ERRORS)


def push_once(refs, via_ssh=False):
    cmd = ["git"]
    if via_ssh:
        cmd += ["-c", f"core.sshCommand=ssh -i {SSH_KEY} -o HostName=ssh.github.com "
                      f"-o Port=443 -o StrictHostKeyChecking=accept-new"]
    cmd += ["push", "-u", "origin" if not via_ssh else ssh_url(), *refs]
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

    if args.ssh and not ssh_ready():
        print(f"想走 SSH 但没找到 {SSH_KEY}。")
        return 1

    ssh_blocked = False
    for attempt in range(1, args.tries + 1):
        # 每一轮都先试 HTTPS；只有确实连不上（不是权限问题）才顺带试一次 SSH
        routes = [True] if args.ssh else [False]
        if not args.ssh and ssh_ready() and not ssh_blocked:
            routes.append(True)

        for via_ssh in routes:
            code, output = push_once(refs, via_ssh=via_ssh)
            label = "SSH" if via_ssh else "HTTPS"
            if code == 0:
                print(f"第 {attempt} 次成功（{label}）。")
                if output:
                    print(output)
                owner, name = task_mod.remote_slug()
                if owner:
                    print(f"https://github.com/{owner}/{name}")
                return 0

            lines = [ln for ln in (output or "").splitlines() if ln.strip()]
            tail = lines[-4:] if lines else ["(无输出)"]
            print(f"第 {attempt} 次 {label} 失败:")
            for line in tail:
                print(f"    {line}")
            if via_ssh and ("Permission denied" in output or "repository exists" in output):
                ssh_blocked = True
                print("  SSH 被拒：公钥还没加到 GitHub 账号（https://github.com/settings/ssh/new）。")
            if not via_ssh and not is_connection_error(output):
                break        # 不是网络问题（权限之类），换通道也没用

        if attempt < args.tries:
            time.sleep(args.delay)

    print(f"\n{args.tries} 轮都没推上去。")
    print("本地提交是安全的，等网络好一点再跑一次 push.cmd 就行。")
    print(f"想彻底绕开 github.com:443：把 {SSH_KEY}.pub 贴到 "
          f"https://github.com/settings/ssh/new ，之后 push.cmd 会自动走 SSH。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
