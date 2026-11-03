'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const exists = file => !!file && fs.existsSync(file);
function run(exe, args, { cwd = ROOT, env = process.env, capture = false } = {}) {
  const result = cp.spawnSync(exe, args, { cwd, env, encoding: 'utf8', shell: false, stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit' });
  if (result.error) throw new Error('无法执行 ' + path.basename(exe) + '：' + result.error.message);
  if (result.status !== 0) throw new Error(path.basename(exe) + ' 执行失败（' + result.status + '）' + (capture ? '\n' + result.stderr : '，请查看上面的日志'));
  return (result.stdout || '').trim();
}
function installedMumu() {
  const homes = [process.env.MUMU_HOME];
  if (process.platform === 'win32') try {
    const text = run('powershell.exe', ['-NoProfile', '-Command', "$p=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -match 'MuMu'} | ForEach-Object {$_.InstallLocation}"], { capture: true });
    homes.push(...text.split(/\r?\n/));
  } catch {}
  homes.push(path.join(process.env.ProgramFiles || 'C:/Program Files', 'Netease/MuMu'), 'D:/Program Files/Netease/MuMu');
  return [...new Set(homes.filter(exists))];
}
function sdkDirectory(env = process.env) {
  const candidates = [env.ANDROID_SDK_ROOT, env.ANDROID_HOME, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android/Sdk')];
  const local = path.join(ROOT, 'android/local.properties');
  if (exists(local)) {
    const value = /^sdk\.dir=(.+)$/m.exec(fs.readFileSync(local, 'utf8'))?.[1];
    if (value) candidates.push(value.trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\'));
  }
  return candidates.find(p => exists(p) && exists(path.join(p, 'platform-tools/adb.exe')));
}
function javaHome(env = process.env) {
  const localJdks = path.join(ROOT, '.toolchain/jdk17');
  const candidates = [env.JAVA_HOME, ...(exists(localJdks) ? fs.readdirSync(localJdks).map(name => path.join(localJdks, name)) : []), path.join(env.ProgramFiles || 'C:/Program Files', 'Android/Android Studio/jbr'), path.join(env.LOCALAPPDATA || '', 'Programs/Android Studio/jbr')];
  try { candidates.push(...run('where.exe', ['java.exe'], { capture: true }).split(/\r?\n/).map(file => path.dirname(path.dirname(file)))); } catch {}
  for (const candidate of candidates.filter(Boolean)) {
    const exe = path.join(candidate, 'bin/java.exe'); if (!exists(exe)) continue;
    const result = cp.spawnSync(exe, ['-version'], { encoding: 'utf8', shell: false });
    const major = Number(/version\s+"(?:1\.)?(\d+)/.exec(result.stderr + result.stdout)?.[1]);
    if (result.status === 0 && major >= 17 && major <= 21) return candidate;
  }
  return null;
}
function mumuPorts(home) {
  const directory = path.join(home, 'vms'); if (!exists(directory)) return [];
  const ports = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const config = JSON.parse(fs.readFileSync(path.join(directory, entry.name, 'configs/vm_config.json'), 'utf8').replace(/^\uFEFF/, ''));
      const port = Number(config.vm?.nat?.port_forward?.adb?.host_port ?? config.port_forward?.adb?.host_port);
      if (Number.isInteger(port) && port > 0 && port <= 65535) ports.push(port);
    } catch {}
  }
  return [...new Set(ports)];
}
function connectMumu() {
  const homes = installedMumu(), sdk = sdkDirectory();
  const adb = [process.env.ADB_PATH, sdk && path.join(sdk, 'platform-tools/adb.exe'), ...homes.map(home => path.join(home, 'nx_main/adb.exe'))].find(exists);
  if (!adb) throw new Error('未找到 ADB。请安装 Android Studio 的 Android SDK Platform-Tools，或设置 MUMU_HOME / ADB_PATH。');
  let address = process.env.MUMU_ADB_ADDRESS;
  if (!address && !process.env.ANDROID_SERIAL) {
    const ports = [...new Set(homes.flatMap(mumuPorts))];
    if (ports.length === 1) address = '127.0.0.1:' + ports[0];
  }
  if (address) {
    if (!/^[A-Za-z0-9_.-]+:\d{1,5}$/.test(address)) throw new Error('MUMU_ADB_ADDRESS 应为 主机:端口');
    run(adb, ['connect', address]);
  }
  const devices = run(adb, ['devices'], { capture: true }).split(/\r?\n/).map(line => /^(\S+)\s+device\b/.exec(line)?.[1]).filter(Boolean);
  const requested = process.env.ANDROID_SERIAL || address;
  const serial = requested ? devices.find(item => item === requested) : devices.length === 1 ? devices[0] : null;
  if (!serial) throw new Error(devices.length > 1 ? '有多个安卓设备，请设置 ANDROID_SERIAL 或 MUMU_ADB_ADDRESS。' : '未发现就绪的 MuMu。请先打开 MuMu并启用 ADB；必要时设置 MUMU_ADB_ADDRESS=127.0.0.1:实际端口。');
  run(adb, ['-s', serial, 'reverse', 'tcp:3000', 'tcp:3000']);
  console.log('已连接 ' + serial + '；安卓后端 http://localhost:3000；请保留电脑后端窗口。');
  return { adb, serial };
}
function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--sync-only', '--connect-only', '--install'].includes(arg))) throw new Error('支持参数：--sync-only、--connect-only、--install');
  if (args.includes('--connect-only')) return connectMumu();
  const cap = path.join(ROOT, 'node_modules/@capacitor/cli/bin/capacitor');
  const required = ['@capacitor/cli', '@capacitor/core', '@capacitor/android', '@capacitor/browser', '@capacitor/app', '@capacitor/keyboard', '@capacitor/status-bar', '@supabase/supabase-js', 'esbuild'];
  if (required.some(name => !exists(path.join(ROOT, 'node_modules', name, 'package.json')))) run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm.cmd', 'ci']);
  run(process.execPath, ['scripts/prepare-android.cjs']);
  if (!exists(path.join(ROOT, 'android/app/build.gradle'))) run(process.execPath, [cap, 'add', 'android']);
  run(process.execPath, ['scripts/prepare-android.cjs']);
  run(process.execPath, [cap, 'sync', 'android']);
  if (args.includes('--sync-only')) { console.log('安卓资源和插件同步完成。'); return; }
  const jdk = javaHome(), sdk = sdkDirectory();
  if (!jdk) throw new Error('未找到 JDK 17 或 21。请先安装 Android Studio 默认组件，或在 Studio 的 Gradle JDK 设置下载 JDK 17/21。工程已同步。');
  if (!sdk || !exists(path.join(sdk, 'platforms/android-34/android.jar'))) throw new Error('未安装 Android SDK 34。打开 Android Studio → More Actions → SDK Manager，安装 Android 14 / API 34、Build-Tools 34.0.0 和 Platform-Tools。工程已同步。');
  fs.writeFileSync(path.join(ROOT, 'android/local.properties'), '# Local Android SDK (not committed)\nsdk.dir=' + sdk.replace(/\\/g, '/').replace(/:/g, '\\:') + '\n');
  fs.mkdirSync(path.join(ROOT, 'android/.gradle'), { recursive: true });
  const propertyJdk = jdk.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/[^\x20-\x7e]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  fs.writeFileSync(path.join(ROOT, 'android/.gradle/config.properties'), 'java.home=' + propertyJdk + '\n');
  const ideGradle = path.join(ROOT, 'android/.idea/gradle.xml');
  if (!exists(ideGradle)) {
    fs.mkdirSync(path.dirname(ideGradle), { recursive: true });
    fs.writeFileSync(ideGradle, '<?xml version="1.0" encoding="UTF-8"?>\n<project version="4"><component name="GradleSettings"><option name="linkedExternalProjectsSettings"><GradleProjectSettings><option name="externalProjectPath" value="$PROJECT_DIR$" /><option name="gradleJvm" value="#GRADLE_LOCAL_JAVA_HOME" /></GradleProjectSettings></option></component></project>\n');
  }
  const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, PATH: path.join(jdk, 'bin') + path.delimiter + process.env.PATH };
  run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat', 'assembleDebug'], { cwd: path.join(ROOT, 'android'), env });
  const apk = path.join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');
  if (!exists(apk)) throw new Error('Gradle 未生成预期 APK，请检查日志');
  console.log('APK 已生成：' + apk);
  if (args.includes('--install')) {
    const { adb, serial } = connectMumu();
    run(adb, ['-s', serial, 'install', '-r', apk]);
    run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', 'com.xiaoyang.musicplayer/.MainActivity', '--es', 'xy_backend', 'http://localhost:3000']);
  }
}
if (require.main === module) {
  try { main(); } catch (error) { console.error('安卓任务未完成：' + error.message); process.exitCode = 1; }
}
module.exports = { main, sdkDirectory, javaHome, mumuPorts, installedMumu };
