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

echo ============================================================
echo   小杨音乐 一键发版（双端独立发版准则 v3.6.0）
echo ------------------------------------------------------------
echo   请选择本次发布目标：
echo     [1] 手机端 Mobile   -^> Tag: mobile-vX.Y.Z  只打包 Android
echo     [2] 电脑端 PC       -^> Tag: pc-vX.Y.Z      只打包 Windows
echo     [3] 双端同步 All    -^> Tag: all-vX.Y.Z     两端同时打包
echo.
echo   ⚠ 除非明确要「双端同步更新」，请只选 1 或 2。
echo   ⚠ 数据库里的版本号自动剥离前缀，只会写入 X.Y.Z。
echo ============================================================
echo.
set "XY_RELEASE_TARGET=mobile"
set /p "XY_PICK=请输入 1 / 2 / 3（默认 1 手机端）："
if "%XY_PICK%"=="2" set "XY_RELEASE_TARGET=pc"
if "%XY_PICK%"=="3" set "XY_RELEASE_TARGET=all"

echo.
set "XY_RELEASE_VERSION="
set /p "XY_RELEASE_VERSION=请输入新版本号（例如 3.6.0，不带 v 和前缀）："
rem 版本与目标都通过环境变量交给 Node.js，避免把用户输入拼进 CMD 命令。
node "%~dp0scripts\release.js"
set "XY_RELEASE_EXIT=%ERRORLEVEL%"
echo.
if not "%XY_RELEASE_EXIT%"=="0" echo [错误] 发布未完成，请查看上面的错误信息。
popd
pause
exit /b %XY_RELEASE_EXIT%
