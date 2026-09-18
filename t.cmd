@echo off
rem python is not on PATH on this machine, so run through uv.
rem usage: t list | t report T003 | t new T004 --workspace D:\work\T004 --prompt-file p.txt
chcp 65001 >nul
cd /d "%~dp0"
uv run python tools\task.py %*
