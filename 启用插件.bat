@echo off
chcp 936 >nul
cd /d "%~dp0"
echo ============================================
echo   dsh-reply-forge-v2 启用
echo ============================================
echo.
echo 用于「已经装过、但被关闭了」的情况：把插件加回 bundles 列表。
echo 不需要重新安装，也不会执行 pnpm。
echo.
echo [提示] 请先完全退出 DSH 桌面端；改动要重启 DSH 才生效。
echo.
pause >nul
echo.

rem ---- 路径配置：一般不需要改 ----
if not defined DSH_HOME set "DSH_HOME=%USERPROFILE%\.dsh"
set "PROFILE_DIR=%DSH_HOME%\profiles\desktop"
rem --------------------------------

set "NODE="
where node >nul 2>&1 && set "NODE=node"
if not defined NODE if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if defined DSH_APP_DIR if exist "%DSH_APP_DIR%\resources\app.asar\dsh\node.exe" set "NODE=%DSH_APP_DIR%\resources\app.asar\dsh\node.exe"

if not defined NODE (
  echo [错误] 未找到 node.exe。请先运行「安装插件.bat」。
  echo.
  pause
  exit /b 1
)

"%NODE%" "%~dp0scripts\enable.mjs"
echo.
echo 完成后请重启 DSH 桌面端。
pause
