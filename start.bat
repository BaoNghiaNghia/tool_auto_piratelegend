@echo off
setlocal
cd /d "%~dp0"

echo [PirateLegend] Checking source...
call npm run check
if errorlevel 1 (
  echo.
  echo [PirateLegend] Source check failed. Tool was not started.
  pause
  exit /b 1
)

echo.
node scripts\start-local.js

if errorlevel 1 (
  echo.
  echo [PirateLegend] Launcher stopped with an error.
  pause
)
