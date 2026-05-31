@echo off
title HeadsetConnect - Frontend
color 0E
cd /d "%~dp0"
echo.
echo  ==========================================
echo   HeadsetConnect Frontend [port 5180]
echo  ==========================================
echo.
echo  Starting Vite dev server...
echo  Press Ctrl+C to stop.
echo.
npm run dev
echo.
echo  [Frontend stopped]
pause
