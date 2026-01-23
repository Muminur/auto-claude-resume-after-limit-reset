@echo off
REM AutoResume GUI Dashboard Launcher - Windows
REM Opens the dashboard in your default browser

echo.
echo  ============================================
echo   AutoResume GUI Dashboard Launcher
echo  ============================================
echo.
echo  Opening dashboard in your default browser...
echo.

REM Get the directory of this script
set SCRIPT_DIR=%~dp0

REM Open index.html in default browser
start "" "%SCRIPT_DIR%index.html"

echo  Dashboard opened!
echo.
echo  Note: For full functionality (WebSocket support),
echo  serve the GUI via HTTP server:
echo.
echo    cd gui
echo    python -m http.server 8080
echo.
echo  Then open: http://localhost:8080
echo.
pause
