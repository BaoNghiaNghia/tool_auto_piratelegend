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
echo [PirateLegend] Starting local tool at http://127.0.0.1:3210
echo [PirateLegend] Press Ctrl+C in this window to stop the server.
node src\server.js

if errorlevel 1 (
  echo.
  echo [PirateLegend] Server stopped with an error.
  pause
)
