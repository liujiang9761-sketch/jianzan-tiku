@echo off
chcp 65001 >nul
echo ========================================
echo   一建题库后台服务
echo ========================================

:: 用 PowerShell 检测端口 3000 是否已在监听
powershell -NoProfile -Command "if ((Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) { exit 0 } else { exit 1 }" >nul 2>&1

if %errorlevel% == 0 (
    echo [已运行] 后台服务已经在运行中！
    echo.
    echo 正在打开管理后台...
    start "" "http://localhost:3000/admin"
    echo.
    echo 按任意键关闭此窗口...
    pause >nul
    exit /b 0
)

:: 未运行，则启动
echo 正在启动服务器...
cd /d "%~dp0backend"
"C:\Program Files\nodejs\node.exe" app.js
pause
