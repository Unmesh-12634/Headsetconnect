@echo off
title HeadsetConnect - Backend
color 0B
cd /d "%~dp0"
echo.
echo  ==========================================
echo   HeadsetConnect Backend  [port 8000]
echo  ==========================================
echo.
echo  Starting FastAPI audio server...
echo  Press Ctrl+C to stop.
echo.
python main.py
echo.
echo  [Backend stopped]
pause
