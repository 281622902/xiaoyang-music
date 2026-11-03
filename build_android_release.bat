@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
node scripts/android-signing.cjs --build
if errorlevel 1 (
  echo 正式签名构建未完成，请查看上方错误。
  pause
  exit /b 1
)
echo 正式 APK 已生成，路径见上方。
pause
