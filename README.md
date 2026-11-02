# 小杨音乐 3.0.1

当前安装包版本为 3.0.1，已包含 Supabase 登录、云端收藏与云端版本检测。改动与回滚见 [云端合并说明](云端合并说明.md)。

推送 Tag 自动构建并正式发布 GitHub Release，校验正式版附件后同步 Supabase，见 [自动发布说明](GitHub自动发布说明.md)。

3.0.0 的设计与基础升级见 [升级与工程建议](v3.0.0升级与工程建议.md)。3.0.1 已在此基础上接入 Supabase 云端账户、收藏和版本检测。

# 小杨音乐（uzz 复刻增强版）

## 历史版本：v2.14.0（2026-11-02）

本轮修复与升级详见 [v2.14.0升级说明.md](v2.14.0升级说明.md)。Windows 安装包为 安装包/小杨音乐 Setup 2.14.0.exe。

### 历史修复 v2.13.4

本目录是从原始 v2.13.3 包建立的独立修复项目。修复清单、测试结果与下一版本计划见 [修复说明与下一版本建议.md](修复说明与下一版本建议.md)。原始桌面目录未被覆盖。

Windows 用户直接使用 `安装包/小杨音乐 Setup 2.13.4.exe`。开发运行需要 Node.js 18 或更新版本，首次使用先执行 `npm ci --prefix server`，再执行 `npm run dev`。后端依赖包含 `music-metadata`，不是零依赖。

自动回归：先 `npm ci --prefix electron`；`npm test` 运行后端与浏览器回归，`npm run test:electron` 运行原生桌面回归。浏览器测试需要 Playwright Chromium，或将 `BROWSER_PATH` 设置为本机 Chrome/Edge 可执行文件路径。原生测试可用 `ELECTRON_PATH` 指定 Electron 可执行文件。全部测试使用临时媒体库和用户目录。

Windows PowerShell 运行离线链路测试：`$env:MOCK='1'; npm run test:flow`。此测试不会验证真实在线音源可用性。

多音源在线音乐播放器（灵感来自 [uzz.me](https://m.uzz.me)），配套**你自建的**音乐解析后端。
功能：推荐页（每日推荐/抖音热歌/热门歌曲/新歌速递/推荐歌单）、搜索+热搜榜+搜索建议、桌面歌词、歌单管理（创建/收藏/加歌）、我喜欢的音乐/最近播放/下载管理、深浅色主题+主题色切换、黑胶歌词播放页；音乐内容由你自己的后端提供，合规可控。

> ⚠️ 本项目仅提供「播放器 + 解析后端」代码，不内置任何受版权保护的音乐资源。请仅用于个人学习、试听与本地管理，遵守所在地区法律法规与各音乐平台服务条款。

---

## 目录结构

```
uzz-player/
├─ app/                  # 前端播放器（纯原生 HTML/CSS/JS，零依赖，可直接被 Electron / Capacitor / 浏览器加载）
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/api.js          # 与后端通信
│  ├─ js/player.js       # 播放引擎（队列/模式/歌词/收藏）
│  ├─ js/app.js          # 搜索与结果渲染
│  ├─ manifest.webmanifest  # PWA 安装配置
│  └─ icon.svg
├─ server/               # 音乐解析后端（Node，零运行时依赖，仅用内置 crypto + fetch）
│  ├─ index.js           # HTTP 服务 + /api 路由 + 静态托管
│  ├─ common.js          # weapi 加密与 HTTP 工具
│  └─ providers/         # netease / tencent(QQ) / kugou / kuwo
├─ electron/             # 桌面版封装（Windows 安装包 NSIS）
│  ├─ main.js / preload.js / package.json / generate_icon.js / build/icon.ico
├─ capacitor.config.json # 安卓版封装配置
└─ package.json          # 根脚本（dev / 构建桌面 / 构建安卓）
```

## 技术栈

- **前端**：原生 JS + HTML5 Audio，移动优先、暗色调，UZZ 风格。无任何前端框架依赖。
- **后端**：Node.js 内置 `http` + `crypto`，零第三方依赖。网易云用社区公开 `weapi` 加密（RSA 公钥内置）；QQ/酷狗/酷我走各自公开接口。
- **桌面**：Electron + electron-builder → Windows `.exe` 安装程序（NSIS）。
- **安卓**：Capacitor → Android APK。同一套前端代码复用。
- **PWA**：前端自带 manifest，安卓/iOS/桌面 Chrome 均可「添加到主屏幕」当 App 用。

---

## 一、本地运行（开发 / 自托管后端）

```bash
# 1) 启动后端（同时托管前端），默认端口 3000
cd uzz-player/server
node index.js
# 浏览器打开 http://localhost:3000
```

可选环境变量：

- `PORT`：后端端口（默认 3000）
- `DEFAULT_VENDOR`：默认音源 `netease|tencent|kugou|kuwo`（默认 netease）

设置里可切换音源、填写后端地址（移动端/网页端需要把 apiBase 指向你部署的后端，桌面版留空即可同源）。

### 多音源播放兜底（重要）

后端 `/api/url`、`/api/song`、`/api/download` 已内置**多音源兜底**：当主音源取不到可播放地址时，会自动按「歌名 + 歌手」去其他音源（netease / tencent / kugou / kuwo）搜索并取首个可播地址返回。这样某音源临时抽风/被限流时，播放不会直接失败。前端搜索结果点击播放时会自动带上歌名与歌手以触发兜底。

> ⚠️ 音源可用性现状（2026-10）：
> - **网易云（默认）**：最稳定，搜索/播放/歌词完整。
> - **QQ / 酷我**：接口可能随官方策略变动，偶发失败会自动走兜底。
> - **酷狗**：搜索接口可用；但其 `play/getdata` 播放地址接口已加风控（返回 `err_code 30020`），纯服务端脚本难以稳定取得播放地址，**故酷狗在后端里主要作为「搜索 + 兜底来源」**，不建议作为唯一播放源。

---

## 二、构建 Windows 桌面安装包

> 不想手敲命令？直接**双击根目录的 `build_windows.bat`** 即可一键完成下面三步（自动检测 Node、安装依赖、出包）。

```bash
cd uzz-player/electron
npm install        # 安装 electron + electron-builder
npm run dist       # 产出 dist/uzz 音乐播放器 Setup *.exe（NSIS）
```

说明：
- 桌面版会把后端与前端一起打包，安装后**离线即可运行**（音乐需联网向后端请求）。
- 图标由 `generate_icon.js` 生成 `build/icon.ico`，可替换为你自己的图标。
- 若想改窗口尺寸，编辑 `electron/main.js` 中的 `width/height`。

---

## 三、构建 Android APK

> 不想手敲命令？双击根目录的 `build_android.bat` 自动完成「装依赖 → 初始化 → 添加安卓平台 → 同步前端」四步；最后一步（签名出 APK）需在 Android Studio 内完成。

安卓 App 不能内嵌 Node 后端，因此手机端需在「设置」里填写你**远程部署的后端地址**（https 推荐）。

```bash
cd uzz-player
npm install                         # 安装 @capacitor/cli / core / android
npx cap add android                # 生成 android/ 原生工程
npx cap sync                       # 把 app/ 同步进原生工程
npx cap build android              # 需本机安装 Android Studio + Android SDK
# 或：npx cap open android 用 Android Studio 打开，Build → Generate Signed Bundle / APK
```

构建产物：`android/app/build/outputs/apk/release/app-release.apk`。

> 若没有 Android SDK，可在 Android Studio 内用「Build → Generate Signed Bundle or APK」完成签名出包。

---

## 四、部署后端到服务器（供手机端 / 网页端使用）

把 `server/` 与 `app/` 部署到一台有公网/内网访问能力的机器：

```bash
cd uzz-player/server
PORT=3000 DEFAULT_VENDOR=netease node index.js
```

建议用 nginx / caddy 反代并配置 HTTPS（Capacitor 安卓端要求 https 后端以避免混合内容拦截）。
防火墙放通对应端口即可。

---

## 五、功能对照（与原站 / 复刻目标）

| 功能 | 状态 |
|---|---|
| 移动优先暗色界面 | ✅ |
| 关键词搜索（单曲/歌手/专辑/歌单） | ✅（按所选音源） |
| 播放 / 暂停 / 上一首 / 下一首 | ✅ |
| 进度拖动、音量 | ✅ |
| 播放模式：列表循环 / 单曲循环 / 随机 | ✅ |
| 全屏播放页 + 滚动歌词 | ✅ |
| 播放列表 / 队列管理 | ✅ |
| 收藏 / 历史（本地持久化，可导出） | ✅ |
| 多音源切换（网易云/QQ/酷狗/酷我） | ✅ 前端；后端网易云最完整 |
| 下载到本地 | ✅（播放页 + 结果列表均有下载按钮，经后端 `/api/download` 同源代理，规避跨域直链下载失效） |
| 桌面安装包 (exe) | ✅ 配置完成，本机 `npm run dist` 出包 |
| 安卓安装包 (apk) | ✅ 配置完成，本机 `npx cap build android` 出包 |
| PWA 可安装 | ✅ |

---

## 六、已知事项与合规提示

1. **音源实现程度**：网易云（netease）按社区公开 `weapi` 加密实现，最完整；QQ/酷狗/酷我走各自公开接口，其签名 / Cookie / token 策略会随官方变化，若某音源失效，请参考对应 provider 文件更新参数（或把前端 apiBase 指向你部署的 [music-api](https://github.com/nettlibs/music-api) 等成熟解析服务）。
2. **网络要求**：播放需后端能访问各音乐平台公网接口；本沙箱环境禁止出网，故未能在此做端到端播放验证，请在你的联网环境验证。
3. **版权与合规**：本项目不托管、不分发任何音乐文件，仅作「播放器 + 个人解析后端」用途。请勿用于商业或大规模公开服务，遵守各平台服务条款与你所在地区法律。
4. **后端安全**：默认 `Access-Control-Allow-Origin: *`，仅供个人使用；若公网部署，建议加鉴权 / 限流 / 白名单。

## 七、搜索失败 / API 配置排错速查

搜索报「搜索失败」基本都是**前端没连到后端**。按下面三步走：

### ① 最推荐：用自带后端、同源访问（无需任何配置）
```bash
cd uzz-player/server
node index.js          # 默认监听 http://localhost:3000
```
然后用浏览器打开 **http://localhost:3000**（注意是 localhost，不是双击 html 文件）。
此时「设置」里后端地址**留空**即可，前端自动同源调用，音源默认网易云，直接搜索。

### ② 如果把前端单独部署 / 直接打开 html 文件
- 直接双击 `app/index.html`（`file://` 协议）打开时，前端没有后端可连，搜索必失败。
- 解决办法：打开 App 右下角 **⚙ 设置**，把「后端 API 地址」填成你的后端地址（例如 `http://localhost:3000` 或公网 `https://music.your.com`），失焦即自动保存；点「**测试连接**」看是否显示「已连接 ✓」。保存后回到首页重新搜索即可。

### ③ 常见失败原因对照
| 现象 | 原因 | 处理 |
|---|---|---|
| 打开即提示「请配置后端 API 地址」 | 用 `file://` 直接打开了 html，且无 apiBase | 改用 `http://localhost:3000` 访问，或在设置填后端地址 |
| 搜索失败：Failed to fetch / Network Error | 后端没启动，或 apiBase 填错 / 不可达 | 启动 `node index.js`；在设置填正确地址并点「测试连接」 |
| 测试连接显示「不可达 ✗」 | 后端地址写错、端口不符、或后端未运行 | 核对地址与端口；确认后端进程在跑 |
| 搜索有结果但点播放没声音 | 该音源接口变动 / 平台风控 | 换音源（设置里切 netease/tencent/kugou/kuwo）；或把 apiBase 指向成熟解析服务 |
| 桌面版（Electron 安装后）搜不到 | 内置后端未随窗口启动 | 重装 / 重启 App；桌面版默认同源，地址应留空 |

> 端口可用环境变量覆盖：`PORT=8080 node index.js`；默认音源 `DEFAULT_VENDOR=tencent node index.js`。

## 八、本地自测脚本（test/flow.js）

项目内置零依赖自测脚本：拉起后端，依次请求 `health / search / song / url / lyric` 五个端点，断言返回结构与前端 `normalizeTrack` 兼容，打印 PASS/FAIL 汇总。

```bash
cd uzz-player
# 真实音源（需联网，能访问 music.163.com 等；验证真实搜索/播放地址/歌词）
node test/flow.js

# 离线 / 受限网络环境（用内置 mock provider 返回示例数据，验证全链路逻辑）
MOCK=1 node test/flow.js
```

> 受限网络说明：本项目开发所在的沙箱环境**允许 GET 但拦截向 music.163.com 的 POST**（curl 实测：GET 首页 200、POST weapi 返回 200 但 body 为空），因此真实音源模式在此会返回 500。这是网络环境限制，并非代码问题——代码为标准 community weapi 实现。在普通联网机器上直接 `node index.js` 即可真实搜索与播放。
> 后端已内置 `MOCK=1` 开关（挂载 `server/providers/mock.js`），仅用于离线验证，不影响默认真实音源。
