@echo off
cd /d "%~dp0"
if not exist node_modules\electron\path.txt (
  echo Runtime desktop assente. Eseguire npm ci e npx install-electron come descritto nel README.
  pause
  exit /b 1
)
if not exist dist\index.html call npm.cmd run build
call npm.cmd start
