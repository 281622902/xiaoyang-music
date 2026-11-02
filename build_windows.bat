@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
echo ============================================================
echo   uzz 音乐播放器 - Windows 安装包一键构建
echo   uzz Music Player - Windows installer build (one-click)
echo ============================================================
echo.
echo  [提示] 本脚本会联网下载依赖（Electron ~280MB + NSIS 工具链）。
echo        已内置国内镜像源（npmmirror），国内网络可正常拉取。
echo.

:: ============================================================
:: 0) 国内镜像源（避免从 GitHub 直连卡死 / 失败）
:: ============================================================
set "npm_config_registry=https://registry.npmmirror.com/"
set "ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
set "NPX_NPM_REGISTRY=https://registry.npmmirror.com/"

:: 1) 检查 Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [X] 未检测到 Node.js。请先安装 LTS 版本（v18+）：https://nodejs.org
  echo     [X] Node.js not found. Install LTS (v18+) from https://nodejs.org
  pause
  exit /b 1
)
for /f %%v in ('node -v') do set NV=%%v
echo [OK] 检测到 Node.js：%NV%
echo.

:: 后端依赖也必须先安装，否则全新解压后缺少 music-metadata 无法启动。
cd /d "%~dp0server"
call npm ci --omit=dev --registry=https://registry.npmmirror.com/
if errorlevel 1 (
  echo [X] 后端依赖安装失败。
  pause
  exit /b 1
)
:: 2) 安装 Electron + electron-builder（首次约 280MB，自动走镜像）
cd /d "%~dp0electron"
echo [1/3] 正在安装 Electron + electron-builder（需联网，走国内镜像）...
call npm install --registry=https://registry.npmmirror.com/
if errorlevel 1 (
  echo [X] 依赖安装失败。请检查网络后重试；若仍失败可手动：
  echo        cd electron 后执行  npm install
  echo     [X] npm install failed. Check network and retry.
  pause
  exit /b 1
)
echo.

:: 3) 构建 NSIS 安装包（首次会下载 NSIS 工具链，自动走镜像）
echo [2/3] 正在构建 Windows NSIS 安装包（首次会下载 NSIS 工具链）...
call npm run dist
if errorlevel 1 (
  echo [X] 构建失败。常见原因：NSIS 下载超时。可重试，或手动 cd electron 执行 npm run dist
  echo     [X] Build failed. Retry, or run "npm run dist" inside electron/.
  pause
  exit /b 1
)
echo.

:: 4) 完成
echo [3/3] 完成！安装包位于：
echo        %~dp0electron\dist\
echo        例如：uzz 音乐播放器 Setup 1.0.0.exe
echo.
echo     - 安装后桌面与开始菜单均有快捷方式。
echo     - 桌面版自带音乐解析后端，打开即搜即用，无需任何配置。
echo     - 若杀毒软件误报，属 Electron 应用常见现象，允许运行即可。
echo.
pause
