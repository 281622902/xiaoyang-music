'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const OLD_CERT='9784e36065b5ad69d2a81fd45166d39e1a9eb41d31f1e8ecd1688c008c5afedc';
const RELEASE_CERT='660f3e4b6a9771a2711cd6dc3c05abcb0f09212012c6ffa69439bf2efd3e4cf4';
function buildMigration(apk,output){
 const {signingEnvironment}=require('./android-signing.cjs'),{javaHome,sdkDirectory}=require('./build-android.js');
 const sdk=sdkDirectory(),jdk=javaHome();if(!sdk||!jdk)throw Error('需要已安装的 Android SDK 34 和 JDK 17');
 const env={...signingEnvironment(),ANDROID_HOME:sdk,XY_LEGACY_STORE_PASSWORD:process.env.XY_LEGACY_STORE_PASSWORD||'android',XY_LEGACY_KEY_PASSWORD:process.env.XY_LEGACY_KEY_PASSWORD||'android'};
 const config=require('./android-release.cjs').checkApk(apk,env);
 const input=path.resolve(apk),destination=path.resolve(output||path.join(path.dirname(input),config.assetName.replace('.apk','-legacy-migration-android9.apk')));
 if(input===destination||!destination.toLowerCase().endsWith('.apk'))throw Error('迁移包必须使用不同的 .apk 输出文件');
 const java=path.join(jdk,'bin/java.exe'),jar=path.join(sdk,'build-tools/34.0.0/lib/apksigner.jar');
 const run=args=>cp.execFileSync(java,['-jar',jar,...args],{env,encoding:'utf8'});
 const fingerprint=text=>/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/.exec(text)?.[1];
 if(fingerprint(run(['verify','--print-certs',input]))!==RELEASE_CERT)throw Error('输入不是本项目固定正式证书签名的 APK');
 const legacy=process.env.XY_LEGACY_KEYSTORE||path.join(os.homedir(),'.android/debug.keystore');
 if(!fs.existsSync(legacy))throw Error('缺少本项目原始 debug 密钥，不能创建无损迁移证明');
 const oldPublic=cp.execFileSync(path.join(jdk,'bin/keytool.exe'),['-exportcert','-rfc','-keystore',legacy,'-alias','androiddebugkey','-storepass:env','XY_LEGACY_STORE_PASSWORD'],{env,encoding:'utf8'});
 if(new crypto.X509Certificate(oldPublic).fingerprint256.replaceAll(':','').toLowerCase()!==OLD_CERT)throw Error('旧密钥与本项目早期安装证书不符；不能生成迁移包');
 const lineage=path.join(ROOT,'.toolchain/signing/legacy-debug-to-release.lineage');
 const signer=['--ks',env.XY_ANDROID_KEYSTORE,'--ks-key-alias',env.XY_ANDROID_KEY_ALIAS,'--ks-pass','env:XY_ANDROID_STORE_PASSWORD','--key-pass','env:XY_ANDROID_KEY_PASSWORD'];
 run(['rotate','--out',lineage,'--old-signer','--ks',legacy,'--ks-key-alias','androiddebugkey','--ks-pass','env:XY_LEGACY_STORE_PASSWORD','--key-pass','env:XY_LEGACY_KEY_PASSWORD','--set-rollback','false','--new-signer',...signer]);
 run(['sign','--v1-signing-enabled','false','--v2-signing-enabled','false','--v3-signing-enabled','true','--v4-signing-enabled','false','--min-sdk-version','28','--rotation-min-sdk-version','28','--lineage',lineage,...signer,'--out',destination,input]);
 if(fingerprint(run(['verify','--min-sdk-version','28','--verbose','--print-certs',destination]))!==RELEASE_CERT)throw Error('迁移包验证失败');
 const result={migrationApk:destination,minimumSupportedAndroidApi:28,legacyCertificate:OLD_CERT,releaseCertificate:RELEASE_CERT,usesOfficialSigningRotation:true,privateKeysIncluded:false};console.log(JSON.stringify(result,null,2));return result;
}
if(require.main===module)try{const args=process.argv.slice(2),i=args.indexOf('--apk'),o=args.indexOf('--out');if(i<0||!args[i+1])throw Error('用法：node scripts/migrate-android-signature.cjs --apk 当前正式包.apk [--out 迁移包.apk]；仅 Android 9+ 使用一次');buildMigration(args[i+1],o<0?undefined:args[o+1]);}catch(error){console.error(error.message);process.exitCode=1;}
module.exports={buildMigration};