@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 exit /b 1

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js。
  popd
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Git，请先安装 Git for Windows。
  popd
  pause
  exit /b 1
)

echo 小杨音乐 - 一键提交并发布版本
echo 输入版本后将更新版本、git add .、提交、创建 Tag，并推送分支和 Tag。
echo.
set "XY_RELEASE_VERSION="
set /p "XY_RELEASE_VERSION=请输入新版本号（例如 3.0.6，不带 v）："
rem 版本通过环境变量交给 Node.js，避免把用户输入拼进 CMD 命令。
node "%~dp0scripts\release.js"
set "XY_RELEASE_EXIT=%ERRORLEVEL%"
echo.
if not "%XY_RELEASE_EXIT%"=="0" echo [错误] 发布未完成，请查看上面的错误信息。
popd
pause
exit /b %XY_RELEASE_EXIT%
