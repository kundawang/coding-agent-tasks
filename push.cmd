@echo off
rem usage: push            (push main + all task branches, with retries)
rem        push T004       (push only that task's branches)
chcp 65001 >nul
cd /d "%~dp0"
uv run python tools\push.py %*
