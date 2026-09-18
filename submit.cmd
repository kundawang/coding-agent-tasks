@echo off
rem usage: submit T003            (dry-run, preview only)
rem        submit T003 --write    (actually write to the Feishu table)
chcp 65001 >nul
cd /d "%~dp0"
uv run python tools\submit.py %*
