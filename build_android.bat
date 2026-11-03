@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 22 或更新版本。
  pause
  exit /b 1
)
node scripts\build-android.js %*
set "XY_ANDROID_EXIT=%ERRORLEVEL%"
popd
if not "%XY_ANDROID_EXIT%"=="0" echo 安卓任务未完成，请按上面的提示处理。
pause
exit /b %XY_ANDROID_EXIT%
