const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { configuration, securityXML } = require('./android-network-config.cjs');
const ROOT = path.resolve(__dirname, '..');
function writeIfChanged(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
}
function androidVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) throw new Error('项目版本不是有效的 X.Y.Z 版本');
  const [major, minor, patch] = match.slice(1).map(Number);
  const code = major * 1000000 + minor * 1000 + patch;
  if (minor > 999 || patch > 999 || !Number.isSafeInteger(code) || code < 1 || code > 2100000000) throw new Error('Android versionCode 超出支持范围');
  return { name: version, code };
}
function patchAndroid(root = ROOT) {
  const android = path.join(root, 'android');
  if (!fs.existsSync(path.join(android, 'app/build.gradle'))) return false;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = androidVersion(pkg.version);
  const gradle = path.join(android, 'app/build.gradle');
  let source = fs.readFileSync(gradle, 'utf8');
  source = source.replace(/\n\s*\/\/ XY_ANDROID_BEGIN[\s\S]*?\/\/ XY_ANDROID_END\s*\n/g, '\n');
  source = source.replace(/defaultConfig\s*\{/, `defaultConfig {\n        // XY_ANDROID_BEGIN\n        ndk { abiFilters 'x86_64', 'arm64-v8a' }\n        // XY_ANDROID_END`);
  source = source.replace(/versionCode\s+\d+/, 'versionCode ' + version.code).replace(/versionName\s+"[^"]*"/, 'versionName "' + version.name + '"');
  writeIfChanged(gradle, source);
  const wrapper = path.join(android, 'gradle/wrapper/gradle-wrapper.properties');
  source = fs.readFileSync(wrapper, 'utf8').replace(/gradle-[\d.]+-(?:all|bin)\.zip/g, 'gradle-8.7-bin.zip').replace(/networkTimeout=\d+/, 'networkTimeout=120000');
  writeIfChanged(wrapper, source);
  const properties = path.join(android, 'gradle.properties');
  source = fs.readFileSync(properties, 'utf8');
  if (!/^android\.overridePathCheck=true\s*$/m.test(source)) source += '\n# Windows workspace paths may contain Chinese characters.\nandroid.overridePathCheck=true\n';
  writeIfChanged(properties, source);
  const manifest = path.join(android, 'app/src/main/AndroidManifest.xml');
  source = fs.readFileSync(manifest, 'utf8');
  if (!source.includes('android:networkSecurityConfig=')) source = source.replace('<application', '<application\n        android:networkSecurityConfig="@xml/network_security_config"');
  if (source.includes('android:windowSoftInputMode=')) source = source.replace(/android:windowSoftInputMode="[^"]*"/, 'android:windowSoftInputMode="adjustResize"');
  else source = source.replace('<activity', '<activity\n            android:windowSoftInputMode="adjustResize"');
  writeIfChanged(manifest, source);
  writeIfChanged(path.join(android, 'app/src/main/res/xml/network_security_config.xml'), securityXML(configuration()));
  console.log('Android 已配置 x86_64 + arm64-v8a、键盘 resize、Gradle 8.7、版本 ' + version.name);
  return true;
}
function prepareAssets(root = ROOT) {
  const vendor = path.join(root, 'app/vendor'); fs.mkdirSync(vendor, { recursive: true });
  writeIfChanged(path.join(vendor, 'android-config.js'), 'window.XYAndroidConfig = '+JSON.stringify(configuration())+';\n');
  const sdkRoot = path.join(root, 'node_modules/@supabase/supabase-js');
  const sdk = path.join(sdkRoot, 'dist/umd/supabase.js');
  if (!fs.existsSync(sdk)) throw new Error('缺少 Supabase SDK，请先 npm install');
  fs.copyFileSync(sdk, path.join(vendor, 'supabase.min.js'));
  for (const name of ['LICENSE', 'LICENSE.md']) if (fs.existsSync(path.join(sdkRoot, name))) fs.copyFileSync(path.join(sdkRoot, name), path.join(vendor, 'supabase.LICENSE.txt'));
  require('esbuild').buildSync({ entryPoints: [path.join(root, 'scripts/native-entry.js')], outfile: path.join(vendor, 'native-platform.js'),
    bundle: true, format: 'iife', globalName: 'XYNative', platform: 'browser', target: ['es2020'], minify: true, legalComments: 'linked' });
  const packages = {};
  for (const name of ['@supabase/supabase-js', '@capacitor/core', '@capacitor/browser', '@capacitor/app', '@capacitor/keyboard', '@capacitor/status-bar']) packages[name] = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'))).version;
  writeIfChanged(path.join(vendor, 'versions.json'), JSON.stringify({ packages,
    sha256: Object.fromEntries(['supabase.min.js', 'native-platform.js', 'android-config.js'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(vendor, file))).digest('hex')])) }, null, 2) + '\n');
  console.log('本地 Supabase SDK 与官方 Capacitor 插件桥已生成（无 CDN）');
  const mobileWeb = path.join(root, 'capacitor/www');
  for (const file of ['android.html', 'icon.svg', 'css/android.css', 'js/android.js', 'js/android-network.js', 'js/native-audio.js', 'js/player.js', 'js/api.js', 'js/supabase-client.js', 'js/cloud-features.js', 'js/cloud-state.js', 'js/favorite-button.js']) {
    const target = path.join(mobileWeb, file === 'android.html' ? 'index.html' : file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, 'app', file), target);
  }
  fs.cpSync(vendor, path.join(mobileWeb, 'vendor'), { recursive: true });
  console.log('安卓独立页面已生成：capacitor/www/index.html');
}
if (require.main === module) {
  try { prepareAssets(); patchAndroid(); }
  catch (error) { console.error('安卓准备失败：' + error.message); process.exitCode = 1; }
}
module.exports = { prepareAssets, patchAndroid, androidVersion };
