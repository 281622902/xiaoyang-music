@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
echo ============================================================
echo   uzz Music Player - Android APK build (project generation)
echo   uzz 音乐播放器 - Android APK 构建（工程生成阶段）
echo ============================================================
echo.

:: 1) check Node.js and Java
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js not found. Install LTS from https://nodejs.org
  echo     [X] 未检测到 Node.js，请先安装。
  pause
  exit /b 1
)
where java >nul 2>nul
if errorlevel 1 (
  echo [!] Java (JDK 17 recommended) not found. Final APK signing needs
  echo     Android Studio + JDK. You can still generate the project now.
  echo     [!] 未检测到 Java(JDK 17 推荐)。最终出包需在 Android Studio 内完成。
)

:: 2) install capacitor deps
cd /d "%~dp0"
set "npm_config_registry=https://registry.npmmirror.com/"
echo [1/4] Installing Capacitor dependencies (needs internet, 走国内镜像)...
call npm install --registry=https://registry.npmmirror.com/
if errorlevel 1 (
  echo [X] npm install failed. Check your network and retry.
  echo     [X] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)
echo.

:: 3) init capacitor (skip if already configured)
echo [2/4] Initializing Capacitor...
if not exist "capacitor.config.json" (
  call npx cap init com.uzz.musicplayer "uzz 音乐播放器" --web-dir app
)
echo.

:: 4) add android platform
echo [3/4] Adding Android platform...
call npx cap add android
if errorlevel 1 (
  echo [X] Failed to add Android platform (install Android Studio / SDK first).
  echo     [X] 添加 Android 平台失败，请先安装 Android Studio / SDK。
  pause
  exit /b 1
)
echo.

:: 5) sync web assets
echo [4/4] Syncing frontend into Android project...
call npx cap sync
if errorlevel 1 (
  echo [X] Sync failed.
  echo     [X] 同步失败。
  pause
  exit /b 1
)
echo.

echo [OK] Android project generated at: %~dp0android\
echo      Next: open "android\" in Android Studio, then
echo      Build > Generate Signed Bundle / APK > APK, follow the wizard.
echo      Or in android\ run: gradlew assembleRelease (after signing config).
echo.
echo      IMPORTANT: The Android app cannot bundle the Node backend.
echo      In the app, open Settings and enter your deployed backend URL
echo      (https), e.g. https://music.your.com
echo.
echo      [重要] 安卓 App 无法内置后端。请在 App「设置」里填入你部署的
echo      后端 https 地址（如 https://music.your.com）才能搜索/播放。
echo.
pause
