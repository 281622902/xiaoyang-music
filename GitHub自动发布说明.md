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
| GH_TOKEN | 创建 GitHub 草稿 Release、上传安装包、验证附件 |
| SUPABASE_URL | Supabase 项目 URL |
| SUPABASE_SERVICE_ROLE_KEY | 仅在同步步骤运行的服务端密钥 |

GH_TOKEN 需要目标仓库 Contents 写权限。若使用 classic PAT，公共仓库需适用的 public_repo/repo 权限，私有仓库需 repo；若发布涉及工作流文件的权限检查，还需相应的 workflow/Workflows 写权限。不要使用普通 Publishable Key 替代服务端密钥，也不要把服务端密钥放进 app/、HTML、客户端配置或安装包。

## 自动执行的步骤

推送 `v*` Tag 后，`.github/workflows/build-and-release.yml` 在 windows-latest、Node.js 22 上依次：

1. 检出完整仓库，校验 Tag、根目录版本、Electron 版本和前端回退版本一致。
2. 安装根目录 SDK、后端运行依赖和 Electron 打包依赖，运行发布测试。
3. 在 `electron/` 执行 `npx electron-builder --win nsis --x64 --publish always`，通过 GH_TOKEN 创建草稿 Release 并上传产物。
4. 保存 Actions 安装包 artifact。
5. 在根目录执行 `node scripts/update-supabase.js`；先通过 GitHub API 确认该 Tag 的安装包确实上传完成，再写入 Supabase。

owner/repo 在 publish 配置中省略，不填写空字符串。当前固定使用的 electron-builder 24 在 `electron/` 子目录中不能直接找到仓库根目录的 `.git/config`；工作流因此在打包前从 `${{ github.repository }}` 自动填入临时的 Electron package.json `repository` 元数据，再由 builder 自动识别 owner/repo。该步骤不修改源仓库提交，也不需要额外仓库名 Secret。

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

## 草稿与公开下载

按本次要求，创建草稿后立即同步版本记录。**草稿附件在手动点击 Publish release 前不可公开下载**；因此此时播放器可能提示存在新版本，但普通用户尚不能下载。需要先在 GitHub 检查草稿并发布，链接随后才能供公开播放器使用。私有仓库的附件即使发布，也不适合匿名客户端直接下载。

若希望避免提前提示更新，下一步可把数据库同步改为 `release.published` 触发；当前文件保持你要求的“打包完成后同步”流程，没有自动将草稿转为公开发布。

## 同步脚本行为

- 版本从根 package.json 读取，例如数据库存 `3.0.1`，Tag 使用 `v3.0.1`。
- 默认写 `platform: 'windows'`、`release_notes: '新版本发布'`。
- 使用 `upsert`：首次插入，同一版本重跑更新同一条记录，避免唯一约束导致失败。依赖之前 app_versions.sql 中的 `(platform, version)` 唯一约束。
- Supabase Auth 持久会话与自动刷新关闭；服务端密钥只读取环境变量，不输出到日志。
- GitHub 附件校验或数据库写入失败会返回非零退出码，让 Actions 标红。可修正问题后重跑工作流；不会删除 Release 或其他版本记录。
- `.env` 已加入忽略规则；工作流和安装包不写入 Secret 值。

可选环境变量：

| 变量 | 默认/作用 |
| --- | --- |
| RELEASE_REPOSITORY | 工作流传入 owner/repo；本机也可设置，或使用 GITHUB_REPOSITORY |
| RELEASE_TAG | 工作流传入 Tag；本机未设置时默认为 v + package.json 版本 |
| RELEASE_ARCH | 默认 x64，当前仅支持 Windows x64 |
| RELEASE_ASSET_NAME | 可选；必须与 builder 配置解析出的名称一致 |
| VERIFY_GITHUB_ASSET | 工作流为 true；校验需 GH_TOKEN。本机不设置时可只执行数据库同步 |

仅校验配置（不访问 GitHub、不访问 Supabase、不需要 SDK 或密钥）：

```powershell
$env:RELEASE_REPOSITORY = '你的用户名/你的仓库名'
$env:RELEASE_TAG = 'v3.0.1'
node scripts/update-supabase.js --validate
```

## 提交与触发

先将整个主项目中的改动放到你的 GitHub 仓库根目录；上传的不是上层 outputs 文件夹。需要包含 `.github/`、`scripts/`、根 package.json、`electron/package.json` 和测试文件。

每次发布前同步以下版本：根 package.json、electron/package.json、electron/package-lock.json 顶层和 packages[""] 的 version，以及 app/js/supabase-client.js 的 appVersion。脚本会阻止不匹配的 Tag。

如果当前 v3.0.1 Tag 尚不存在，提交改动后可以运行：

```powershell
git tag v3.0.1
git push origin v3.0.1
```

若 v3.0.1 已发布，请更新到下一个版本并创建新的 Tag；不需要覆盖已有 Tag。普通分支/PR 检查仍保留，且明确使用 `--publish never`，避免意外发布。Tag 仅由新发布工作流打包。

## 本次验证

已通过 10 项本地测试，覆盖版本/Tag、上传名、原生与局域网安装包名称兼容、工作流 YAML 和 Secret 传递、GitHub 附件校验、缺失附件阻止写库、重跑幂等、凭证缺失、数据库失败和日志脱敏。没有推送 Tag、创建 GitHub Release、读取仓库 Secrets 或写入正式 Supabase。

参考：[electron-builder 发布配置](https://www.electron.build/docs/publish/)、[GitHub Releases API 与草稿可见性](https://docs.github.com/en/rest/releases/releases)、[Supabase SDK 安装](https://supabase.com/docs/reference/javascript/installing)。
