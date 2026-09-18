"""A/B 双工作区：每道题固定铺两份内容一致的初始环境，A、B 各跑一个窗口。

    python tools/ab.py status                  # 看所有题 A/B 的状态（是否干净、是否和初始快照一致）
    python tools/ab.py setup T007              # 按初始快照铺出 T007/A 和 T007/B
    python tools/ab.py clean T007 b            # B 跑废了：删掉重建回初始环境
    python tools/ab.py verify T007             # 只校验，不改动

目录约定：<task root>/A、<task root>/B，默认 task root 是
C:\\Users\\Administrator\\Documents\\Codex\\task-workdirs\\<题号>（可用 --root 改）。
两个目录都会被注册进 task.py 的工作区台账，所以 record/reset 直接用路径就能找到。
"""

import argparse
import hashlib
import os
import stat
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)

import task  # noqa: E402

AB_BASE = os.environ.get("TASK_AB_BASE") or r"C:\Users\Administrator\Documents\Codex\task-workdirs"
ROLES = ("A", "B")


def all_tasks():
    if not os.path.isdir(task.TASKS):
        return []
    return [
        name for name in sorted(os.listdir(task.TASKS))
        if not name.startswith("_") and os.path.isdir(os.path.join(task.TASKS, name))
    ]


def ab_root(task_id):
    """A/B 放在哪个目录下：优先看台账里已经登记过的 .../A、.../B。"""
    for path in reversed(task.read_workspace_records(task_id)):
        if os.path.basename(path.rstrip("\\/")).upper() in ROLES:
            return os.path.dirname(path)
    return os.path.join(AB_BASE, task_id.upper())


def role_workspace(task_id, role, root=None):
    return os.path.join(root or ab_root(task_id), role.upper())


def force_remove(path):
    """Windows 下 .git 里的对象文件是只读的，直接 rmtree 会失败。"""
    if not os.path.exists(path):
        return
    for dirpath, dirnames, filenames in os.walk(path, topdown=False):
        for name in filenames:
            target = os.path.join(dirpath, name)
            try:
                os.chmod(target, stat.S_IWRITE)
            except OSError:
                pass
            os.remove(target)
        for name in dirnames:
            target = os.path.join(dirpath, name)
            try:
                os.chmod(target, stat.S_IWRITE)
            except OSError:
                pass
            os.rmdir(target)
    os.chmod(path, stat.S_IWRITE)
    os.rmdir(path)


def tree_state(root):
    """返回 (文件数, 内容指纹)。指纹用来和初始快照比对。"""
    if not os.path.isdir(root):
        return None
    items = []
    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root).replace("\\", "/")
            digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
            items.append(f"{rel}:{digest}")
            count += 1
    return count, hashlib.sha256("\n".join(sorted(items)).encode()).hexdigest()[:12]


def snapshot_state(task_id):
    branch = task.ref(task.branches(task_id)["base"])
    if not branch:
        return None
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        archive = subprocess.run(["git", "archive", branch], cwd=task.REPO, capture_output=True)
        if archive.returncode != 0:
            return None
        subprocess.run(["tar", "-x", "-C", tmp], input=archive.stdout, capture_output=True)
        return tree_state(tmp)


def is_dirty(path):
    if not os.path.isdir(os.path.join(path, ".git")):
        return "no-git"
    out = subprocess.run(["git", "status", "--porcelain"], cwd=path,
                         capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    return "dirty" if out.strip() else "clean"


def describe(task_id, role, root=None):
    path = role_workspace(task_id, role, root)
    state = tree_state(path)
    if state is None:
        return f"{role}: 不存在 ({path})"
    snap = snapshot_state(task_id)
    same = "= 初始快照" if snap and state == snap else "≠ 初始快照"
    return f"{role}: {state[0]} 个文件 {same} {is_dirty(path)}  {path}"


def materialize(task_id, role, root=None):
    """按初始快照铺一份（已存在就删掉重建）。"""
    branch = task.ref(task.branches(task_id)["base"])
    if not branch:
        raise SystemExit(f"{task_id}: 找不到初始快照分支 {task.branches(task_id)['base']}")
    path = role_workspace(task_id, role, root)
    force_remove(path)
    os.makedirs(path, exist_ok=True)
    archive = subprocess.run(["git", "archive", branch], cwd=task.REPO, capture_output=True)
    extract = subprocess.run(["tar", "-x", "-C", path], input=archive.stdout, capture_output=True)
    if archive.returncode != 0 or extract.returncode != 0:
        raise SystemExit(f"{task_id}/{role}: 解包初始快照失败")
    task.git("init", "-q", "-b", "main", cwd=path)
    task.git("config", "user.name", "kundawang", cwd=path)
    task.git("config", "user.email", "kundawang@users.noreply.github.com", cwd=path)
    task.commit_all("initial environment", cwd=path)
    task.write_workspace_record(task_id, path)
    return path


def cmd_status(args):
    tasks = [args.id.upper()] if args.id else all_tasks()
    for task_id in tasks:
        print(f"=== {task_id} ===")
        for role in ROLES:
            print("  " + describe(task_id, role, args.root))
    return 0


def cmd_setup(args):
    root = os.path.abspath(args.root) if args.root else None
    for role in ROLES:
        path = materialize(args.id.upper(), role, root)
        print(f"{args.id.upper()}/{role} 已铺好: {path}")
    return 0


def cmd_clean(args):
    path = materialize(args.id.upper(), args.role.upper(), os.path.abspath(args.root) if args.root else None)
    print(f"{args.id.upper()}/{args.role.upper()} 已重建回初始环境: {path}")
    return 0


def cmd_verify(args):
    task_id = args.id.upper()
    snap = snapshot_state(task_id)
    ok = True
    for role in ROLES:
        path = role_workspace(task_id, role, args.root)
        state = tree_state(path)
        if state is None:
            print(f"{role}: 不存在  {path}")
            ok = False
            continue
        if state != snap:
            print(f"{role}: 和初始快照不一致（{state[0]} 个文件 vs 快照 {snap[0]} 个）  {path}")
            ok = False
        elif is_dirty(path) == "dirty":
            print(f"{role}: 内容一致，但 git 工作区是脏的  {path}")
        else:
            print(f"{role}: 一致且干净  {path}")
    print("结果:", "OK" if ok else "有问题")
    return 0 if ok else 1


def build_parser():
    parser = argparse.ArgumentParser(description="A/B 双工作区管理")
    sub = parser.add_subparsers(dest="cmd", required=True)

    st = sub.add_parser("status", help="看所有题 A/B 的状态")
    st.add_argument("id", nargs="?")
    st.add_argument("--root")
    st.set_defaults(func=cmd_status)

    su = sub.add_parser("setup", help="铺出 A/B 两份初始环境")
    su.add_argument("id")
    su.add_argument("--root")
    su.set_defaults(func=cmd_setup)

    cl = sub.add_parser("clean", help="把某一份删掉重建回初始环境")
    cl.add_argument("id")
    cl.add_argument("role", choices=["a", "b"])
    cl.add_argument("--root")
    cl.set_defaults(func=cmd_clean)

    ve = sub.add_parser("verify", help="校验 A/B 是否等于初始快照")
    ve.add_argument("id")
    ve.add_argument("--root")
    ve.set_defaults(func=cmd_verify)
    return parser


if __name__ == "__main__":
    arguments = build_parser().parse_args()
    sys.exit(arguments.func(arguments) or 0)
