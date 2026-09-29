@echo off
setlocal
cd /d "%~dp0"

echo [PirateLegend] Validating source...
call npm run check
if errorlevel 1 (
  echo.
  echo [PirateLegend] Validation failed. Build cancelled.
  pause
  exit /b 1
)

echo.
echo [PirateLegend] Building compact Windows portable release...
node scripts\build-release.js
if errorlevel 1 (
  echo.
  echo [PirateLegend] Build failed.
  pause
  exit /b 1
)

echo.
echo [PirateLegend] Build complete.
echo [PirateLegend] dist\ now keeps only the latest release ZIP.
pause
