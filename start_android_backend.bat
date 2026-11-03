@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js。
  pause
  exit /b 1
)
if not exist "server\node_modules\music-metadata\package.json" (
  call npm ci --prefix server
  if errorlevel 1 exit /b 1
)
set "PORT=3000"
echo 电脑端音乐后端已准备启动，请保留此窗口。
echo 请双击 connect_mumu.bat，自动连接MuMu并建立 adb reverse。
echo 安卓内默认后端地址：http://localhost:3000
node server\index.js
set "XY_BACKEND_EXIT=%ERRORLEVEL%"
popd
pause
exit /b %XY_BACKEND_EXIT%

