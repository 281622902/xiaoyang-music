'use strict';
// 独立跑 gradlew（绕开 bash→cmd.exe 交互模式问题；与 build-android.js 同样的 spawnSync 方式）
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const JDK = path.join(ROOT, '.toolchain/jdk17/jdk-17.0.21+9');
const SDK = 'C:/Users/Administrator/AppData/Local/Android/Sdk';

const args = process.argv.slice(2);
const gradleArgs = args.length ? args : ['assembleDebug'];
const env = {
  ...process.env,
  JAVA_HOME: JDK,
  ANDROID_HOME: SDK,
  ANDROID_SDK_ROOT: SDK,
  PATH: path.join(JDK, 'bin') + path.delimiter + process.env.PATH,
  // 关键：清掉代理变量，避免 Gradle 解析依赖时走本机 Clash 代理卡死
  HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '',
  NO_PROXY: '127.0.0.1,localhost',
  // 注意：cmd.exe 会再解析一次参数，值里不能出现裸的 | 和 & （用 * 通配即可）
  GRADLE_OPTS: '-Dorg.gradle.daemon=false -Dhttp.proxyHost= -Dhttps.proxyHost= -Dhttp.nonProxyHosts=*',
};
const t0 = Date.now();
console.log('gradle ' + gradleArgs.join(' ') + ' 启动…');
const r = cp.spawnSync('cmd.exe', ['/d', '/c', 'gradlew.bat', ...gradleArgs, '--console=plain'], {
  cwd: ANDROID, env, encoding: 'utf8', shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const out = (r.stdout || '') + (r.stderr || '');
fs.writeFileSync(path.join(ROOT, 'tmp-test', 'gradle-build.log'), out);
console.log(out.split('\n').filter(l => /Task :|BUILD |error:|FAILURE|warning:|What went wrong|Caused by|\.java:\d+/i.test(l)).slice(-60).join('\n'));
console.log('\n退出码 ' + r.status + '，耗时 ' + Math.round((Date.now() - t0) / 1000) + ' 秒');
if (r.status !== 0) process.exitCode = 1;
