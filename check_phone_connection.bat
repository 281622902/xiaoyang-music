@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
node scripts\phone-connection.cjs
set "XY_PHONE_CHECK_EXIT=%ERRORLEVEL%"
popd
pause
exit /b %XY_PHONE_CHECK_EXIT%
