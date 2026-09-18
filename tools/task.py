"""题目台账自动化：建题、记录 A/B、重置环境、生成提交字段。

    python tools/task.py new T001 --workspace <dir> --prompt-file <file> [选项]
    python tools/task.py record T001 a --workspace <dir> --session <SessionID>
    python tools/task.py set T001 --gsb-conclusion "A 更好" --gsb-reason-file reason.md
    python tools/task.py reset T001 --workspace <dir>
    python tools/task.py report T001
    python tools/task.py list
    python tools/task.py push [T001]

本机没装 Python 时用 uv 跑： uv run python tools/task.py ...
"""

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys

import find_trajectory

try:  # Windows 控制台/管道默认可能是 cp936，统一按 utf-8 输出避免中文乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TOOLS)
TASKS = os.path.join(REPO, "tasks")
WORKSPACE_RECORD = ".workspace"  # 记在仓库里（不进工作区，避免给模型任何"这是评测题"的暗示）

# 工作区里这些目录/文件属于"未跟踪的产物"，既不进快照也不参与重置
EXCLUDES = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "env",
    "dist",
    "build",
    "out",
    "target",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".next",
    ".nuxt",
    "coverage",
    ".gradle",
    ".cache",
    ".idea",
}


def git(*args, cwd=REPO, check=True):
    proc = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    if check and proc.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} 失败:\n{proc.stderr.strip()}")
    return proc.stdout.strip()


def remote_slug():
    url = git("remote", "get-url", "origin", check=False)
    if not url or "github.com" not in url:
        return None, None
    slug = url.rstrip("/")
    if slug.endswith(".git"):
        slug = slug[: -len(".git")]
    for prefix in (
        "https://github.com/",
        "http://github.com/",
        "git@github.com:",
        "ssh://git@github.com/",
    ):
        if slug.startswith(prefix):
            slug = slug[len(prefix):]
            break
    else:
        return None, None
    owner, _, name = slug.partition("/")
    if not owner or not name:
        return None, None
    return owner, name


def permalink(sha):
    owner, name = remote_slug()
    if not owner:
        return ""
    return f"https://github.com/{owner}/{name}/commit/{sha}"


def raw_url(sha, path):
    owner, name = remote_slug()
    if not owner:
        return ""
    return f"https://raw.githubusercontent.com/{owner}/{name}/{sha}/{path}"


def branches(task_id):
    key = task_id.lower()
    return {"base": f"{key}/base", "a": f"{key}/a", "b": f"{key}/b"}


def ref(branch):
    """分支引用：优先本地分支，退回 origin/<branch>。

    刚 clone 下来的仓库只有远端分支，直接写 t003/base 会解析不到。
    """
    if git("rev-parse", "--verify", "--quiet", branch, check=False):
        return branch
    remote = f"origin/{branch}"
    if git("rev-parse", "--verify", "--quiet", remote, check=False):
        return remote
    return ""


def task_dir(task_id):
    return os.path.join(TASKS, task_id.upper())


def load_meta(task_id):
    path = os.path.join(task_dir(task_id), "meta.json")
    if not os.path.exists(path):
        raise SystemExit(f"题目 {task_id} 不存在（缺 {path}）")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save_meta(task_id, meta):
    path = os.path.join(task_dir(task_id), "meta.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def main_branch():
    for candidate in ("main", "master"):
        if git("rev-parse", "--verify", "--quiet", candidate, check=False):
            return candidate
    return "main"


def clear_worktree(keep=()):
    """清空仓库工作区（保留 .git 与 keep 中的顶层项）。"""
    for name in os.listdir(REPO):
        if name == ".git" or name in keep:
            continue
        path = os.path.join(REPO, name)
        shutil.rmtree(path, ignore_errors=True) if os.path.isdir(path) else os.remove(path)


def copy_workspace(src, dst=REPO):
    if not os.path.isdir(src):
        raise SystemExit(f"工作区不存在: {src}")
    for name in os.listdir(src):
        if name in EXCLUDES:
            continue
        s, d = os.path.join(src, name), os.path.join(dst, name)
        if os.path.isdir(s):
            shutil.copytree(s, d, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns(*EXCLUDES))
        else:
            shutil.copy2(s, d)


def commit_all(message, cwd=REPO):
    git("add", "-A", cwd=cwd)
    if not git("status", "--porcelain", cwd=cwd):
        return git("rev-parse", "HEAD", cwd=cwd)
    git("commit", "-q", "-m", message, cwd=cwd)
    return git("rev-parse", "HEAD", cwd=cwd)


def ensure_workspace_repo(workspace):
    """工作区要是个 git 仓库：模型跑完可以自己提交产物，重置也能走 reset --hard。"""
    if not is_git_repo(workspace):
        git("init", "-q", "-b", "main", cwd=workspace)
        if not git("config", "user.name", cwd=workspace, check=False):
            git("config", "user.name", "kundawang", cwd=workspace)
            git("config", "user.email", "kundawang@users.noreply.github.com", cwd=workspace)
        commit_all("initial environment", cwd=workspace)
        return True
    return False


def is_git_repo(path):
    return bool(git("rev-parse", "--git-dir", cwd=path, check=False))


def workspace_git_reset(workspace):
    """把工作区 git 仓库硬重置到最初那次提交，并清掉未跟踪文件。"""
    if not is_git_repo(workspace):
        return False
    roots = git("rev-list", "--max-parents=0", "HEAD", cwd=workspace, check=False).split()
    if not roots:
        return False
    git("reset", "--hard", roots[-1], cwd=workspace)
    git("clean", "-fdx", cwd=workspace)
    return True


def write_workspace_record(task_id, workspace):
    path = os.path.join(task_dir(task_id), WORKSPACE_RECORD)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(os.path.abspath(workspace) + "\n")


def read_workspace_record(task_id):
    path = os.path.join(task_dir(task_id), WORKSPACE_RECORD)
    if not os.path.exists(path):
        return ""
    return open(path, encoding="utf-8").read().strip()


def same_path(left, right):
    return os.path.normcase(os.path.abspath(left)) == os.path.normcase(os.path.abspath(right))


def sync_workspace_to_branch(task_id, role, workspace):
    """把工作区内容做成代码分支（base/a/b）。"""
    br = branches(task_id)[role]
    base = branches(task_id)["base"]
    dirty = git("status", "--porcelain")
    if dirty:
        raise SystemExit(
            "仓库里有未提交的改动，先提交再执行（本操作会清空工作区）：\n" + dirty
        )
    if role == "base":
        git("checkout", "--orphan", br)
        git("rm", "-rf", "--cached", "-q", ".", check=False)
    else:
        start = ref(base)
        if not start:
            raise SystemExit(f"缺少初始快照分支 {base}，请先执行 new")
        git("checkout", "-B", br, start)
    clear_worktree()
    copy_workspace(workspace)
    sha = commit_all(f"{task_id.upper()} {role} ({dt.date.today().isoformat()})")
    return br, sha


# ---------------------------------------------------------------- commands


def cmd_new(args):
    task_id = args.id.upper()
    dest = task_dir(task_id)
    if os.path.exists(dest):
        raise SystemExit(f"{dest} 已存在")
    with open(args.prompt_file, encoding="utf-8") as fh:
        prompt = fh.read()

    if ensure_workspace_repo(args.workspace):
        print(f"已把工作区初始化为 git 仓库: {args.workspace}")

    # 先做代码分支：这一步会清空仓库工作区，台账文件必须等它之后再写
    original = git("rev-parse", "--abbrev-ref", "HEAD")
    br, sha = sync_workspace_to_branch(task_id, "base", args.workspace)
    git("checkout", "-q", original)

    template = os.path.join(TASKS, "_TEMPLATE")
    shutil.copytree(template, dest)
    with open(os.path.join(dest, "prompt.md"), "w", encoding="utf-8") as fh:
        fh.write(prompt if prompt.endswith("\n") else prompt + "\n")
    os.makedirs(os.path.join(dest, "trajectories"), exist_ok=True)

    meta = {
        "task_id": task_id,
        "title": args.title,
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
        "task_type": args.task_type,
        "difficulty": args.difficulty,
        "language_framework": args.lang,
        "harness": args.harness,
        "harness_version": args.harness_version,
        "os": args.os,
        "env_level": args.env_level,
        "prompt_file": "prompt.md",
        "initial_snapshot": {"branch": br, "sha": sha, "permalink": permalink(sha)},
        "runs": {
            "A": {"session_id": "", "trajectory_local": "", "trajectory_url": "",
                  "branch": branches(task_id)["a"], "product_snapshot_sha": "",
                  "product_snapshot_permalink": ""},
            "B": {"session_id": "", "trajectory_local": "", "trajectory_url": "",
                  "branch": branches(task_id)["b"], "product_snapshot_sha": "",
                  "product_snapshot_permalink": ""},
        },
        "notes": args.notes,
    }
    save_meta(task_id, meta)
    write_workspace_record(task_id, args.workspace)
    commit_all(f"{task_id} metadata")

    print(f"初始环境快照: {sha}")
    print(f"  branch    : {br}")
    print(f"  permalink : {permalink(sha)}")
    print("\n下一步：用同样的工作区跑 A（只跑首轮），跑完执行")
    print(f"  python tools/task.py record {task_id} a --workspace \"{args.workspace}\" --session <SessionID>")
    if args.push:
        cmd_push(argparse.Namespace(id=task_id))
    return 0


def cmd_record(args):
    task_id = args.id.upper()
    role = args.role.lower()
    meta = load_meta(task_id)
    base = branches(task_id)["base"]
    if not ref(base):
        raise SystemExit(f"缺少初始快照分支 {base}，请先执行 new")
    if not git("rev-parse", "--verify", "--quiet", meta["initial_snapshot"]["sha"], check=False):
        raise SystemExit("初始环境快照 commit 在当前仓库里找不到")

    original = git("rev-parse", "--abbrev-ref", "HEAD")
    br, sha = sync_workspace_to_branch(task_id, role, args.workspace)
    git("checkout", "-q", original)

    hits = find_trajectory.find(args.session)
    local_path = ""
    source_path = ""
    if hits:
        src = hits[0]["path"]
        source_path = src
        traj_dir = os.path.join(task_dir(task_id), "trajectories")
        os.makedirs(traj_dir, exist_ok=True)
        local_path = os.path.join(traj_dir, f"{role.upper()}-{args.session}.jsonl")
        shutil.copy2(src, local_path)

    info = meta["runs"][role.upper()]
    info.update({
        "session_id": args.session,
        "branch": br,
        "product_snapshot_sha": sha,
        "product_snapshot_permalink": permalink(sha),
        "trajectory_local": local_path,
        "trajectory_source": source_path,
    })
    save_meta(task_id, meta)
    commit_all(f"{task_id.upper()} record {role.upper()} ({args.session})")

    if local_path:
        rel = os.path.relpath(local_path, REPO).replace("\\", "/")
        info["trajectory_url"] = raw_url(git("rev-parse", "HEAD"), rel)
        save_meta(task_id, meta)
        commit_all(f"{task_id.upper()} trajectory url {role.upper()}")

    print(f"{role.upper()} 产物快照: {sha}")
    print(f"  branch    : {br}")
    if hits:
        print(f"  轨迹文件  : {hits[0]['path']}")
    else:
        print(f"  轨迹文件  : 未找到 SessionID {args.session} 的 jsonl，请确认 SessionID 或手动放入 trajectories/")
    if args.push:
        cmd_push(argparse.Namespace(id=task_id))
    return 0


def cmd_set(args):
    """补/改题目元数据：Harness 版本、GSB 结论与理由、录屏路径等。"""
    task_id = args.id.upper()
    meta = load_meta(task_id)
    changed = []

    for attr, key in (
        ("title", "title"),
        ("task_type", "task_type"),
        ("difficulty", "difficulty"),
        ("lang", "language_framework"),
        ("harness", "harness"),
        ("harness_version", "harness_version"),
        ("os", "os"),
        ("env_level", "env_level"),
        ("validity", "validity"),
        ("remark", "remark"),
    ):
        value = getattr(args, attr)
        if value is not None:
            meta[key] = value
            changed.append(key)

    if args.prompt_file:
        with open(args.prompt_file, encoding="utf-8") as fh:
            prompt = fh.read()
        if not prompt.endswith("\n"):
            prompt += "\n"
        with open(os.path.join(task_dir(task_id), "prompt.md"), "w", encoding="utf-8") as fh:
            fh.write(prompt)
        changed.append("prompt.md")

    if args.gsb_conclusion is not None or args.gsb_reason_file:
        gsb = meta.setdefault("gsb", {})
        if args.gsb_conclusion is not None:
            gsb["conclusion"] = args.gsb_conclusion
            changed.append("gsb.conclusion")
        if args.gsb_reason_file:
            with open(args.gsb_reason_file, encoding="utf-8") as fh:
                gsb["reason"] = fh.read().strip()
            gsb["reason_author"] = args.reason_author
            changed.append("gsb.reason")

    for role, path in (("A", args.a_recording), ("B", args.b_recording)):
        if path:
            meta["runs"][role]["recording_local"] = os.path.abspath(path)
            changed.append(f"runs.{role}.recording_local")

    # 轨迹 jsonl 不在本机时（例如跑在另一台机器上），至少要能把 SessionID 记下来
    for role, sid in (("A", args.a_session), ("B", args.b_session)):
        if sid:
            meta["runs"][role]["session_id"] = sid.strip()
            changed.append(f"runs.{role}.session_id")

    if not changed:
        raise SystemExit("没有要改的内容；用 python tools/task.py set --help 看可用参数")

    meta["updated_at"] = dt.datetime.now().isoformat(timespec="seconds")
    save_meta(task_id, meta)
    commit_all(f"{task_id} set: {', '.join(changed)}")
    print(f"已更新 {task_id}: {', '.join(changed)}")
    if args.push:
        cmd_push(argparse.Namespace(id=task_id))
    return 0


def cmd_reset(args):
    task_id = args.id.upper()
    recorded = read_workspace_record(task_id)
    if recorded and not same_path(recorded, args.workspace):
        raise SystemExit(
            f"拒绝操作：{task_id} 记录的工作区是 {recorded}，"
            f"与你传入的 {args.workspace} 不一致，已中止。"
        )

    if workspace_git_reset(args.workspace):
        print(f"工作区已 git reset --hard 回最初提交，未跟踪文件已清掉，可以跑 B 了。")
        return 0

    base = branches(task_id)["base"]
    base_ref = ref(base)
    if not base_ref:
        raise SystemExit(f"缺少初始快照分支 {base}，无法重置")
    tracked = {line for line in git("ls-tree", "-r", "--name-only", base_ref).splitlines() if line}

    # 1) 删掉不属于初始快照的文件（node_modules/venv/构建产物等一并清掉）
    #    自底向上遍历：先删文件，再把空掉的目录收掉，同时保留 .taskworkspace 标记
    for dirpath, _dirnames, filenames in os.walk(args.workspace, topdown=False):
        rel = os.path.relpath(dirpath, args.workspace).replace("\\", "/")
        rel = "" if rel == "." else rel
        if rel == ".git" or rel.startswith(".git/"):
            continue
        for name in filenames:
            full = f"{rel}/{name}" if rel else name
            if full not in tracked:
                os.remove(os.path.join(dirpath, name))
        if rel:
            still_needed = any(t == rel or t.startswith(rel + "/") for t in tracked)
            if not still_needed:
                try:
                    os.rmdir(dirpath)
                except OSError:
                    pass

    # 2) 用初始快照的内容覆盖回去
    archive = subprocess.run(["git", "archive", base_ref], cwd=REPO, capture_output=True)
    if archive.returncode != 0:
        raise SystemExit("git archive 失败")
    extract = subprocess.run(["tar", "-x", "-C", args.workspace], input=archive.stdout, capture_output=True)
    if extract.returncode != 0:
        raise SystemExit(f"解包失败: {extract.stderr.decode(errors='replace')[:300]}")

    print(f"工作区已重置到初始环境 {base} ({load_meta(task_id)['initial_snapshot']['sha']})")
    print("node_modules / venv / 构建产物等未跟踪文件已清掉，可以跑 B 了。")
    return 0


def cmd_report(args):
    if not args.id:
        ids = [name for name in sorted(os.listdir(TASKS))
               if not name.startswith("_") and os.path.isdir(os.path.join(TASKS, name))] \
            if os.path.isdir(TASKS) else []
        if not ids:
            print("还没有题目")
            return 0
        for i, name in enumerate(ids):
            if i:
                print("\n" + "-" * 72 + "\n")
            cmd_report(argparse.Namespace(id=name))
        return 0

    task_id = args.id.upper()
    meta = load_meta(task_id)
    init = meta["initial_snapshot"]
    a, b = meta["runs"]["A"], meta["runs"]["B"]
    gsb = meta.get("gsb") or {}

    def local_link(entry, label):
        out = []
        source = entry.get("trajectory_source") or ""
        local = entry.get("trajectory_local") or ""
        if source and os.path.exists(source):
            out.append(f"{label}（原始文件）: [{os.path.basename(source)}]({source})")
        if local and os.path.exists(local):
            out.append(f"{label}（仓库副本）: [{os.path.basename(local)}]({local})")
        return out or [f"{label}: （未找到本地文件）"]

    lines = [
        f"题目: {task_id} {meta.get('title') or ''}",
        f"任务类型: {meta.get('task_type')}",
        f"任务难度: {meta.get('difficulty')}",
        f"语言/框架: {meta.get('language_framework')}",
        f"Harness: {meta.get('harness')} {meta.get('harness_version')}",
        f"操作系统: {meta.get('os')}",
        f"环境可复现等级: {meta.get('env_level')}",
        f"初始环境快照: {init.get('permalink') or init.get('sha')}",
        f"A-SessionID: {a.get('session_id')}",
        f"A-轨迹文件: {a.get('trajectory_url') or '(待上传)'}",
        f"A-产物快照: {a.get('product_snapshot_permalink') or a.get('product_snapshot_sha')}",
        f"B-SessionID: {b.get('session_id')}",
        f"B-轨迹文件: {b.get('trajectory_url') or '(待上传)'}",
        f"B-产物快照: {b.get('product_snapshot_permalink') or b.get('product_snapshot_sha')}",
        f"GSB 结论: {gsb.get('conclusion') or ''}",
        f"GSB 理由: {len(gsb.get('reason') or '')} 字",
        *([f"          （作者：{gsb.get('reason_author')}）"] if gsb.get("reason_author") else []),
        f"有效性: {meta.get('validity') or '有效'}",
        f"备注: {meta.get('remark') or ''}",
    ]
    print("\n".join(lines))
    print("\n--- 轨迹文件（点一下直接打开本机文件） ---")
    for line in local_link(a, "A-轨迹文件") + local_link(b, "B-轨迹文件"):
        print(line)

    for role, entry in (("A", a), ("B", b)):
        rec = entry.get("recording_local") or ""
        if rec and os.path.exists(rec):
            print(f"{role}-运行录屏: [{os.path.basename(rec)}]({rec})")
    return 0


def cmd_list(_args):
    if not os.path.isdir(TASKS):
        print("还没有题目")
        return 0
    for name in sorted(os.listdir(TASKS)):
        if name.startswith("_") or not os.path.isdir(os.path.join(TASKS, name)):
            continue
        try:
            meta = load_meta(name)
        except SystemExit:
            continue
        a, b = meta["runs"]["A"], meta["runs"]["B"]
        state = "初始快照已建" if meta["initial_snapshot"]["sha"] else "未建快照"
        state += " | A✓" if a["product_snapshot_sha"] else " | A-"
        state += " | B✓" if b["product_snapshot_sha"] else " | B-"
        print(f"{meta['task_id']:6s} {state:32s} {meta.get('language_framework','')}  {meta.get('title','')}")
    return 0


def cmd_push(args):
    task_id = (args.id or "").upper()
    if task_id:
        refs = [
            branch
            for branch in branches(task_id).values()
            if git("rev-parse", "--verify", "--quiet", branch, check=False)
        ]
        refs.append("main")
    else:
        refs = ["--all"]
    result = subprocess.run(["git", "push", "-u", "origin", *refs], cwd=REPO,
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(result.stdout.strip() or result.stderr.strip())
    if result.returncode != 0:
        print("\n推送失败（多为网络问题）。稍后可重试： python tools/task.py push "
              + (task_id or ""))
        return 1
    owner, name = remote_slug()
    print(f"https://github.com/{owner}/{name}")
    return 0


def build_parser():
    p = argparse.ArgumentParser(description="Coding Agent 题目台账")
    sub = p.add_subparsers(dest="cmd", required=True)

    n = sub.add_parser("new", help="新建题目并提交初始环境快照")
    n.add_argument("id")
    n.add_argument("--workspace", required=True)
    n.add_argument("--prompt-file", required=True)
    n.add_argument("--title", default="")
    n.add_argument("--task-type", dest="task_type", default="")
    n.add_argument("--difficulty", default="困难")
    n.add_argument("--lang", default="")
    n.add_argument("--harness", default="Codex CLI")
    n.add_argument("--harness-version", dest="harness_version", default="")
    n.add_argument("--os", default="Windows")
    n.add_argument("--env-level", dest="env_level", default="")
    n.add_argument("--notes", default="")
    n.add_argument("--no-push", dest="push", action="store_false")
    n.set_defaults(push=True, func=cmd_new)

    r = sub.add_parser("record", help="记录 A/B 的产物快照与轨迹")
    r.add_argument("id")
    r.add_argument("role", choices=["a", "b"])
    r.add_argument("--workspace", required=True)
    r.add_argument("--session", required=True)
    r.add_argument("--no-push", dest="push", action="store_false")
    r.set_defaults(push=True, func=cmd_record)

    s = sub.add_parser("reset", help="把工作区重置回初始环境")
    s.add_argument("id")
    s.add_argument("--workspace", required=True)
    s.set_defaults(func=cmd_reset)

    st = sub.add_parser("set", help="补/改题目的元数据（Harness 版本、GSB、录屏等）")
    st.add_argument("id")
    st.add_argument("--title")
    st.add_argument("--task-type", dest="task_type")
    st.add_argument("--difficulty")
    st.add_argument("--lang")
    st.add_argument("--harness")
    st.add_argument("--harness-version", dest="harness_version")
    st.add_argument("--os")
    st.add_argument("--env-level", dest="env_level")
    st.add_argument("--validity", help="有效 / 作废-工程故障 / 作废-环境未重置 / 作废-其他")
    st.add_argument("--remark")
    st.add_argument("--prompt-file", dest="prompt_file")
    st.add_argument("--gsb-conclusion", dest="gsb_conclusion", help="A 更好 / Same / B 更好")
    st.add_argument("--gsb-reason-file", dest="gsb_reason_file",
                    help="人写好的 GSB 理由文件（本项目禁止 AI 代写）")
    st.add_argument("--reason-author", dest="reason_author", help="理由作者，默认本人")
    st.add_argument("--a-recording", dest="a_recording")
    st.add_argument("--b-recording", dest="b_recording")
    st.add_argument("--a-session", dest="a_session", help="A 的 SessionID（轨迹不在本机时用）")
    st.add_argument("--b-session", dest="b_session", help="B 的 SessionID")
    st.add_argument("--no-push", dest="push", action="store_false")
    st.set_defaults(push=True, func=cmd_set)

    rep = sub.add_parser("report", help="输出提交表字段")
    rep.add_argument("id", nargs="?", help="题号；不给就输出所有题目")
    rep.set_defaults(func=cmd_report)

    ls = sub.add_parser("list", help="列出所有题目")
    ls.set_defaults(func=cmd_list)

    pu = sub.add_parser("push", help="推送分支与台账")
    pu.add_argument("id", nargs="?")
    pu.set_defaults(func=cmd_push)
    return p


if __name__ == "__main__":
    sys.path.insert(0, TOOLS)
    arguments = build_parser().parse_args()
    sys.exit(arguments.func(arguments) or 0)
