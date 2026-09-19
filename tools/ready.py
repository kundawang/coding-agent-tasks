"""看哪些题的两轮（A/B）都跑完了、还没回填，并且可以一键记账 + 推送 + 回填飞书表。

    uv run python tools/ready.py              # 只看，不动任何东西
    uv run python tools/ready.py --submit     # 记账 + 推分支 + 回填提交表

判断"跑完了"的依据（三个条件都要满足）：
  1. 这个 A / B 目录有对应的 CLI 会话（说明真的跑过）
  2. 对应窗口已经关掉（没有启动时间对得上的 codex 进程）
  3. 轨迹文件 60 秒内没有新写入（已经停下来）

已经回填过的题会跳过（记在 tasks/<题号>/meta.json 的 submit 字段里）。
"""

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import submit as submit_mod  # noqa: E402
import task as task_mod  # noqa: E402

HOME = os.path.expanduser("~")
SESSION_ROOTS = [
    os.path.join(HOME, ".codex-cli", "sessions"),
    os.path.join(HOME, ".codex", "sessions"),
]
SETTLE_SECONDS = 60      # 轨迹多久没动才算停下来
WINDOW_MATCH_SECONDS = 30  # 会话开始时间和进程启动时间差多少算同一个窗口
SUSPECT_LINES = 80       # 轨迹行数少于这个数，多半是中断的那一轮，不自动回填


def session_start(name):
    m = re.search(r"rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})", name)
    if not m:
        return None
    try:
        return dt.datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}:{m.group(3)}:{m.group(4)}")
    except ValueError:
        return None


def collect_sessions():
    """把所有 CLI 会话按目录归好：cwd -> 最近一条。"""
    newest = {}
    for root in SESSION_ROOTS:
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
                if not cwd:
                    continue
                key = os.path.normcase(os.path.abspath(cwd))
                mtime = os.path.getmtime(path)
                if key not in newest or mtime > newest[key]["mtime"]:
                    newest[key] = {
                        "path": path,
                        "session": meta.get("session_id") or name,
                        "started": session_start(name),
                        "mtime": mtime,
                    }
    return newest


def live_codex_starts():
    """还在跑的 codex / node 进程的启动时间。"""
    script = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'codex' } | "
              "ForEach-Object { '{0:yyyy-MM-ddTHH:mm:ss}' -f $_.CreationDate }")
    try:
        proc = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                              capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=25)
    except (OSError, subprocess.SubprocessError):
        return []
    out = []
    for line in (proc.stdout or "").splitlines():
        try:
            out.append(dt.datetime.fromisoformat(line.strip()))
        except ValueError:
            continue
    return out


def window_open(session, starts):
    if not session.get("started"):
        return False
    return any(abs((session["started"] - t).total_seconds()) <= WINDOW_MATCH_SECONDS for t in starts)


def task_ids():
    root = task_mod.TASKS
    if not os.path.isdir(root):
        return []
    return sorted(n for n in os.listdir(root)
                  if not n.startswith("_") and os.path.isdir(os.path.join(root, n)))


def product_workspace(task_id, side):
    """这一轮的产物在哪：工作区里还有就跑工作区，否则用最近一次存档。"""
    root = task_mod.task_root(task_id)
    live = os.path.join(root, side) if root else ""
    if live and task_mod.workspace_dirty(live):
        return live, "工作区"
    runs = os.path.join(HOME, ".coding-agent-tasks", "runs", task_id.upper())
    if os.path.isdir(runs):
        cands = sorted(d for d in os.listdir(runs) if d.upper().startswith(side.upper() + "-"))
        if cands:
            return os.path.join(runs, cands[-1]), "存档"
    return "", ""


def survey():
    sessions = collect_sessions()
    starts = live_codex_starts()
    now = dt.datetime.now()
    ready, pending, done = [], [], []

    # 表里已经出现过这些初始快照的题，就不再回填一遍（可能是别人填的）
    already = set()
    try:
        cfg = submit_mod.load_config()
        for rec in submit_mod.list_my_records(cfg):
            sha = submit_mod.strip_markdown_link(rec["snapshot"])
            m = re.search(r"\b[0-9a-f]{40}\b", sha or "")
            if m:
                already.add(m.group(0))
    except SystemExit:
        pass

    for task_id in task_ids():
        try:
            meta = task_mod.load_meta(task_id)
        except SystemExit:
            continue
        root = task_mod.task_root(task_id)
        if not root:
            continue
        info = {"task_id": task_id, "meta": meta, "root": root, "sides": {}}
        complete = True
        suspect = []
        for side in task_mod.SIDES:
            key = os.path.normcase(os.path.abspath(os.path.join(root, side)))
            sess = sessions.get(key)
            entry = {"session": sess, "closed": False, "settled": False, "recorded": False,
                     "lines": 0}
            if sess:
                entry["closed"] = not window_open(sess, starts)
                entry["settled"] = (now - dt.datetime.fromtimestamp(sess["mtime"])).total_seconds() >= SETTLE_SECONDS
                entry["recorded"] = (meta["runs"][side].get("session_id") == sess["session"])
                entry["lines"] = sum(1 for _ in open(sess["path"], encoding="utf-8", errors="replace"))
                if entry["lines"] < SUSPECT_LINES:
                    suspect.append(f"{side} 只有 {entry['lines']} 行")
            info["sides"][side] = entry
            if not (entry["session"] and entry["closed"] and entry["settled"]):
                complete = False

        info["suspect"] = suspect
        if meta.get("submit") or (meta["initial_snapshot"]["sha"] in already):
            done.append(info)
        elif complete and not suspect:
            ready.append(info)
        else:
            pending.append(info)
    return ready, pending, done


def describe(info):
    lines = [f"{info['task_id']}  {info['meta'].get('title','')}"]
    for side in task_mod.SIDES:
        e = info["sides"][side]
        s = e["session"]
        if not s:
            lines.append(f"  {side}: 没找到会话")
            continue
        rows = e["lines"] or sum(1 for _ in open(s["path"], encoding="utf-8", errors="replace"))
        size = round(os.path.getsize(s["path"]) / 1024)
        state = "已结束" if e["closed"] else "窗口还开着"
        lines.append(f"  {side}: {s['session']}  {state}  {rows} 行 / {size} KB"
                     + ("  [已记账]" if e["recorded"] else ""))
    return lines


def first_free_uid(cfg):
    """本人行里，初始快照还空着的第一行。"""
    for rec in submit_mod.list_my_records(cfg):
        if not submit_mod.strip_markdown_link(rec["snapshot"]).strip():
            return rec["uid"], rec["record_id"]
    return "", ""


def state_path():
    return os.path.join(HOME, ".coding-agent-tasks", "ready-state.json")


def load_state():
    try:
        with open(state_path(), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_state(state):
    path = state_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def backfill(task_id, cfg, uid, record_id):
    """记账 A / B → 推分支 → 写表。返回一段结果说明。"""
    out = []
    meta = task_mod.load_meta(task_id)
    for side, role in zip(task_mod.SIDES, ("a", "b")):
        ws, where = product_workspace(task_id, side)
        sess = meta_sid = None
        sessions = collect_sessions()
        root = task_mod.task_root(task_id)
        key = os.path.normcase(os.path.abspath(os.path.join(root, side)))
        sess = sessions.get(key)
        if not ws or not sess:
            out.append(f"  {side}: 找不到产物（{where or '无'}）或会话，跳过")
            continue
        br, sha = task_mod.sync_workspace_to_branch(task_id, role, ws)
        info = meta["runs"][side.upper()]
        info.update({"session_id": sess["session"], "branch": br,
                     "product_snapshot_sha": sha,
                     "product_snapshot_permalink": task_mod.permalink(sha),
                     "trajectory_local": "", "trajectory_source": sess["path"],
                     "trajectory_url": ""})
        traj_dir = os.path.join(task_mod.task_dir(task_id), "trajectories")
        os.makedirs(traj_dir, exist_ok=True)
        dest = os.path.join(traj_dir, f"{side.upper()}-{sess['session']}.jsonl")
        import shutil
        shutil.copy2(sess["path"], dest)
        info["trajectory_local"] = dest
        out.append(f"  {side}: 产物快照 {sha[:10]}（{where}）")
    task_mod.save_meta(task_id, meta)

    # 推分支（失败不阻塞，提醒即可）
    refs = [b for b in task_mod.branches(task_id).values()
            if task_mod.git("rev-parse", "--verify", "--quiet", b, check=False)]
    push = subprocess.run(["git", "push", "origin", *refs], cwd=task_mod.REPO,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    out.append("  分支推送: " + ("成功" if push.returncode == 0 else "失败（链接可能暂时打不开，稍后重推）"))

    fields = submit_mod.build_fields(meta, task_id,
                                     argparse.Namespace(gsb_conclusion=None, gsb_reason_file=None,
                                                        a_recording=None, b_recording=None))
    attach = submit_mod.attachments(meta, task_id,
                                    argparse.Namespace(a_recording=None, b_recording=None))
    payload = json.dumps(fields, ensure_ascii=False)
    try:
        submit_mod.lark(["base", "+record-upsert", "--base-token", cfg["base_token"],
                         "--table-id", cfg["table_id"], "--record-id", record_id, "--json", payload])
        out.append("  字段: 整批写入成功")
    except SystemExit:
        failed = []
        for k, v in fields.items():
            try:
                submit_mod.lark(["base", "+record-upsert", "--base-token", cfg["base_token"],
                                 "--table-id", cfg["table_id"], "--record-id", record_id,
                                 "--json", json.dumps({k: v}, ensure_ascii=False)])
            except SystemExit:
                failed.append(k)
        out.append(f"  字段: 逐字段写入，写不进去的: {failed or '无'}")

    for field_name, paths in attach.items():
        try:
            submit_mod.lark(["base", "+record-upload-attachment", "--base-token", cfg["base_token"],
                             "--table-id", cfg["table_id"], "--record-id", record_id,
                             "--field-id", field_name,
                             *[a for p in paths for a in ("--file", p)]])
            out.append(f"  附件 {field_name}: {len(paths)} 个已上传")
        except SystemExit as exc:
            out.append(f"  附件 {field_name}: 失败 {str(exc).splitlines()[0]}")

    meta["submit"] = {"uid": uid, "record_id": record_id,
                      "at": dt.datetime.now().isoformat(timespec="seconds")}
    task_mod.save_meta(task_id, meta)
    task_mod.commit_all(f"{task_id} backfill -> UID {uid}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submit", action="store_true", help="真的记账、推送并回填表格")
    args = ap.parse_args()

    ready, pending, done = survey()
    print(f"扫描完成：可以回填 {len(ready)} 道，还没跑完 {len(pending)} 道，已回填 {len(done)} 道")

    # 疑似没跑完的，只提醒"新出现的"，免得每十分钟刷一遍同样的内容
    state = load_state()
    known = set(state.get("suspects") or [])
    now_suspects = []
    for info in pending:
        if not info.get("suspect"):
            continue
        key = info["task_id"] + "|" + "；".join(info["suspect"])
        now_suspects.append(key)
        if key in known:
            continue
        print()
        print("=" * 66)
        print("  疑似没跑完，需要你自己确认（不会自动回填）：")
        for line in describe(info):
            print("    " + line)
        print("    " + "；".join(info["suspect"]))
    state["suspects"] = now_suspects
    save_state(state)

    if not ready:
        return 0

    cfg = submit_mod.load_config()
    for info in ready:
        print()
        print("=" * 66)
        for line in describe(info):
            print("  " + line)
        if not args.submit:
            print("  （只看模式，没有回填）")
            continue
        uid, record_id = first_free_uid(cfg)
        if not uid:
            print("  没有空闲行了，停在这里")
            return 1
        print(f"  → 回填到 UID {uid}  ({record_id})")
        for line in backfill(info["task_id"], cfg, uid, record_id):
            print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
