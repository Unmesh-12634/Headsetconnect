@echo off
title HeadsetConnect Launcher
color 0A

echo.
echo  ============================================
echo    HeadsetConnect  ^|  Multi-Headset Sync
echo  ============================================
echo.

:: Resolve absolute paths from the script's own location
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

:: ── Sanity checks ────────────────────────────────────────────────────────────

where python >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python not found in PATH.
    echo  Install Python 3.10+ from https://python.org and enable "Add to PATH".
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js / npm not found in PATH.
    echo  Install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: ── Optional: install Node deps if missing ───────────────────────────────────
if not exist "%FRONTEND%\node_modules" (
    echo  [Setup] node_modules not found. Running npm install...
    cd /d "%FRONTEND%"
    npm install
    if errorlevel 1 (
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo  [Setup] npm install done.
    echo.
)

:: ── Launch each service in its own window ────────────────────────────────────
:: Using helper bat files keeps quoting simple and reliable.

echo  Starting Backend  (port 8000)...
start "HeadsetConnect Backend" "%BACKEND%\run_backend.bat"

echo  Waiting for backend to initialise...
timeout /t 3 /nobreak >nul

echo  Starting Frontend (port 5180)...
start "HeadsetConnect Frontend" "%FRONTEND%\run_frontend.bat"

echo  Waiting for Vite to start...
timeout /t 4 /nobreak >nul

:: ── Open browser ─────────────────────────────────────────────────────────────
echo  Opening browser...
start "" "http://localhost:5180"

:: ── Summary ──────────────────────────────────────────────────────────────────
echo.
echo  ============================================
echo    Services are running in separate windows.
echo.
echo    Frontend  ->  http://localhost:5180
echo    Backend   ->  http://localhost:8000
echo    API Docs  ->  http://localhost:8000/docs
echo.
echo    To STOP: close the Backend and Frontend
echo    console windows, then close this one.
echo  ============================================
echo.
pause
