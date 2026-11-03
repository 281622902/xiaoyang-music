# Tag 自动打包与 Supabase 同步

已修改主项目；实际 electron-builder 配置位于 `electron/package.json`，项目根目录的 `package.json` 用于命令和发布脚本依赖。原生播放器继续使用 CDN SDK，新增 npm 依赖只供 Node.js 发布脚本使用。

## 安装与 Secrets

在项目根目录执行：

```powershell
npm install @supabase/supabase-js
```

这会安装发布脚本依赖并生成/更新根目录 package-lock.json；生成后请一并提交。CI 根目录使用 `npm install`，后端和 Electron 使用各自的 `npm ci`。本机这次没有访问 npm registry 的网络权限，因此没有安装该依赖或生成根目录锁文件；脚本测试通过注入模拟客户端完成。

仓库的 Actions Secrets 使用以下名称（你已配置后无需把值写到代码中）：

| Secret | 用途 |
| --- | --- |
| GH_TOKEN | 创建和正式发布 GitHub Release、上传安装包、验证附件 |
| SUPABASE_URL | Supabase 项目 URL |
| SUPABASE_SERVICE_ROLE_KEY | 仅在同步步骤运行的服务端密钥 |

GH_TOKEN 需要目标仓库 Contents 写权限。若使用 classic PAT，公共仓库需适用的 public_repo/repo 权限，私有仓库需 repo；若发布涉及工作流文件的权限检查，还需相应的 workflow/Workflows 写权限。不要使用普通 Publishable Key 替代服务端密钥，也不要把服务端密钥放进 app/、HTML、客户端配置或安装包。

## 自动执行的步骤

推送 `v*` Tag 后，`.github/workflows/build-and-release.yml` 在 windows-latest、Node.js 22 上依次：

1. 检出 Tag 对应的提交，通过 `node scripts/update-supabase.js --prepare` 从当前 Tag 提取版本；现有版本不同只输出 Warning，随后在 Runner 中同步根目录、Electron、锁文件和前端回退版本。
2. 安装根目录 SDK、后端运行依赖和 Electron 打包依赖，运行发布测试。
3. 在 `electron/` 执行 `npx electron-builder --win nsis --x64 --publish always`，通过 GH_TOKEN 创建正式 Release 并上传产物。
4. 保存 Actions 安装包 artifact。
5. 执行 `gh release edit ... --draft=false --prerelease=false`，保证对应 Release 已正式发布；兼容 electron-builder 复用同 Tag 已有草稿的情况。
6. 在根目录执行 `node scripts/update-supabase.js`；通过 GitHub API 确认该 Tag 是已发布的正式版、安装包上传完成，取得实际的 browser_download_url 后写入 Supabase。

根目录和 electron/package.json 已明确填写作者“小杨”及仓库 `https://github.com/281622902/xiaoyang-music.git`。Electron 的 build.publish 明确配置 `owner: "281622902"`、`repo: "xiaoyang-music"`、`releaseType: "release"`，不再依赖 `.git/config` 自动识别。工作流的 EP_DRAFT 为 false；请在该仓库中运行发布流程。

为了让上传名和下载链接一致，NSIS 安装包名固定为：

```text
xiaoyang-music-${version}-${arch}-setup.exe
```

例如当前版本 3.0.1、仓库 owner/repo 对应：

```text
https://github.com/owner/repo/releases/download/v3.0.1/xiaoyang-music-3.0.1-x64-setup.exe
```

这避免默认中文/空格文件名在上传时被 electron-builder 转换，导致数据库地址与实际附件不一致。之前已生成的本地中文安装包不受此次配置修改影响；下一次构建使用新命名。

本机升级包扫描和局域网发布工具也已兼容新英文文件名，并继续接受旧中文名。

## 全自动正式发布与公开下载

提交本次配置并推送包含修复的新 Tag 后，Actions 自动构建、上传、正式发布，再同步 Supabase，**不需要手动点击 Publish release**。原有 UI 测试放行策略和动态 Tag 版本准备保留。

当前 electron-builder 24 如果找到同 Tag 的已有草稿，可能直接复用；因此工作流在所有上传完成后补一次 GitHub CLI 正式发布操作。这只处理当前工作流对应的 Tag，不批量修改历史草稿。本次只修改文件，没有直接发布现有草稿或推送 Tag。

同步脚本始终验证 `draft === false`、`prerelease === false`、有效的 `published_at` 和安装包上传状态；任何一项不满足就停止写库。数据库下载链接来自 GitHub 附件实际的 `browser_download_url`，同时校验仓库、Tag 与文件名，避免使用猜测或错误附件链接。正式版和草稿的 URL 格式本身相同，区分依据是发布状态。

## 同步脚本行为

- CI 优先使用 RELEASE_TAG（来自 github.ref_name），也兼容 GITHUB_REF_NAME/GITHUB_REF；本机未传入 Tag 时，才读取根 package.json。数据库版本不带 v，Release Tag 带 v。
- 默认写 `platform: 'windows'`、`release_notes: '新版本发布'`。
- 使用 `upsert`：首次插入，同一版本重跑更新同一条记录，避免唯一约束导致失败。依赖之前 app_versions.sql 中的 `(platform, version)` 唯一约束。
- Supabase Auth 持久会话与自动刷新关闭；服务端密钥只读取环境变量，不输出到日志。
- GitHub 正式发布、附件校验或数据库写入失败会返回非零退出码，让 Actions 标红。可修正问题后重跑工作流；不会删除 Release 或其他版本记录。
- `.env` 已加入忽略规则；工作流和安装包不写入 Secret 值。

可选环境变量：

| 变量 | 默认/作用 |
| --- | --- |
| RELEASE_REPOSITORY | 工作流传入 owner/repo；本机也可设置，或使用 GITHUB_REPOSITORY |
| RELEASE_TAG | 工作流传入 Tag；本机未设置时默认为 v + package.json 版本 |
| RELEASE_ARCH | 默认 x64，当前仅支持 Windows x64 |
| RELEASE_ASSET_NAME | 可选；必须与 builder 配置解析出的名称一致 |

执行数据库同步时也必须提供 GH_TOKEN，发布状态与附件校验始终执行，不能通过取消环境变量跳过。`--prepare` 和 `--validate` 仍不访问 GitHub 或 Supabase，不需要凭证。

仅校验配置（不访问 GitHub、不访问 Supabase、不需要 SDK 或密钥；版本差异只 Warning，不会返回 exit 1）：

```powershell
$env:RELEASE_REPOSITORY = '你的用户名/你的仓库名'
$env:RELEASE_TAG = 'v3.0.1'
node scripts/update-supabase.js --validate
```

## 提交与触发

Windows 推荐使用仓库根目录的 `release.bat`：输入版本后自动同步各处版本、执行 git add .、commit、tag，并原子推送当前分支与 Tag。详情见 [一键发布说明](一键发布使用说明.md)。下方保留手动操作方式。

先将整个主项目中的改动放到你的 GitHub 仓库根目录；上传的不是上层 outputs 文件夹。需要包含 `.github/`、`scripts/`、根 package.json、`electron/package.json` 和测试文件。

发布时 CI 的 `--prepare` 自动同步以下版本：根 package.json、electron/package.json、两份 package-lock.json 顶层和 packages[""] 的 version，以及 app/js/supabase-client.js 的 appVersion。锁文件中依赖包自己的版本不变。这些修改只发生在 Runner，不自动提交、不移动 Tag。本机开发仍建议维护正确的版本元数据。

单独执行 `--validate` 仅报告差异；实际同步数据库时仍会检查 Electron 版本，避免未准备的安装包被标成更高版本。正常工作流先 prepare、再打包、再写库，因此不需要手动同步五处版本。

如果当前 v3.0.1 Tag 尚不存在，提交改动后可以运行：

```powershell
git tag v3.0.1
git push origin v3.0.1
```

若已有该 Tag，请提交修复后创建一个未使用的新版本 Tag；不需要覆盖已有 Tag。普通分支/PR 检查仍保留，且明确使用 `--publish never`，避免意外发布。Tag 仅由新发布工作流打包。

## v3.0.3 预检失败的原因与修复

2026-11-03 检查了 GitHub 上 `v3.0.3` 的根 package.json，其 version 仍为 `3.0.1`；该 Tag 的旧脚本读取根版本后严格比较，因此要求 v3.0.1。脚本中没有把 3.0.1 写为版本常量。只改默认分支上的文件，不会改变已有 Tag 所指提交的内容。

此修复包包含 `scripts/update-supabase.js`、`.github/workflows/build-and-release.yml`、`test/release.test.cjs` 和本说明。请全部提交，测试文件也需要更新，否则旧测试仍期待“版本差异必须失败”。

推荐操作：

1. 将修复文件覆盖到仓库根目录对应路径并提交、推送。
2. 从包含修复的提交创建新 Tag，例如未使用过的 `v3.0.4`：`git tag v3.0.4`，再执行 `git push origin v3.0.4`。
3. 检查新的 Actions 运行，其预检步骤应名为 `Prepare build version from tag (version drift is a warning)`，日志显示 `CI 发布版本已同步：v3.0.4`。

不要只点击旧 v3.0.3 运行的 Re-run jobs；那会继续使用旧 Tag 的脚本与工作流。如确实必须复用 v3.0.3，需要先将该 Tag 指向包含修复的提交，这涉及重写远端 Tag，本次没有替你执行，建议使用新 Tag。

原因证据：[v3.0.3 的 package.json](https://github.com/281622902/xiaoyang-music/blob/v3.0.3/package.json)、[v3.0.3 的旧同步脚本](https://github.com/281622902/xiaoyang-music/blob/v3.0.3/scripts/update-supabase.js)。

## 本次验证

已通过 25 项本地测试，覆盖动态 Tag、版本准备、正式版配置、发布步骤顺序、实际附件下载链接、草稿/预发布/未发布拒绝写库、错误链接拒绝写库、重跑幂等和批处理发布中的 Git 操作顺序与失败处理。另通过隔离的本地 bare Git 仓库验证了真实提交、Tag、原子推送和 cmd.exe 批处理输入流程。没有推送真实 GitHub Tag、创建或发布真实 GitHub Release、读取仓库 Secrets 或写入正式 Supabase。

参考：[electron-builder 发布配置](https://www.electron.build/docs/publish/)、[GitHub Releases API 与草稿可见性](https://docs.github.com/en/rest/releases/releases)、[Supabase SDK 安装](https://supabase.com/docs/reference/javascript/installing)。
