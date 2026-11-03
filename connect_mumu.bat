@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0"
node scripts\build-android.js --connect-only
set "XY_MUMU_EXIT=%ERRORLEVEL%"
popd
pause
exit /b %XY_MUMU_EXIT%

