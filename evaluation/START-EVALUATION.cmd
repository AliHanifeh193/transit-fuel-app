@echo off
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-evaluation.ps1"
if errorlevel 1 (
  echo.
  echo Evaluation server did not start. Check the error above.
  pause
)
