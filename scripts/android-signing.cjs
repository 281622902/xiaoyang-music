'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),directory=path.join(ROOT,'.toolchain/signing');
const credentials=path.join(directory,'credentials.json'),keystore=path.join(directory,'xiaoyang-release.keystore');
function signingEnvironment(){
 if(!fs.existsSync(credentials)||!fs.existsSync(keystore))throw Error('正式签名备份缺失；请恢复原 .toolchain/signing 目录。仅首次建立发布身份时才使用 --create');
 const data=JSON.parse(fs.readFileSync(credentials,'utf8'));
 return {...process.env,XY_ANDROID_KEYSTORE:keystore,XY_ANDROID_STORE_PASSWORD:data.storePassword,XY_ANDROID_KEY_ALIAS:data.alias,XY_ANDROID_KEY_PASSWORD:data.keyPassword};
}
function create(){
 if(fs.existsSync(credentials)||fs.existsSync(keystore)){signingEnvironment();console.log('沿用现有正式签名，不会重新生成。');return;}
 fs.mkdirSync(directory,{recursive:true});
 const {javaHome}=require('./build-android');const java=javaHome();if(!java)throw Error('需要 JDK 17 或 21');
 const data={alias:'xiaoyang-release',storePassword:crypto.randomBytes(32).toString('base64url'),keyPassword:crypto.randomBytes(32).toString('base64url')};
 // Write recovery material first. A partially completed run never silently replaces a signing key.
 fs.writeFileSync(credentials,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
 const result=cp.spawnSync(path.join(java,'bin/keytool.exe'),['-genkeypair','-keystore',keystore,'-storetype','JKS','-alias',data.alias,'-storepass:env','XY_ANDROID_STORE_PASSWORD','-keypass:env','XY_ANDROID_KEY_PASSWORD','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Xiaoyang Music, O=Xiaoyang, C=CN'],{env:{...process.env,XY_ANDROID_STORE_PASSWORD:data.storePassword,XY_ANDROID_KEY_PASSWORD:data.keyPassword},encoding:'utf8',windowsHide:true});
 if(result.error||result.status!==0)throw Error('签名生成失败；保留恢复资料，请核查 JDK 后重试，未发布任何 APK');
 console.log('正式签名已保存到 .toolchain/signing（Git 忽略）。请私下备份整个目录。');
}
function configureGitHub(){
 const env=signingEnvironment();const repo=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).repository.url.replace(/^https:\/\/github.com\//,'').replace(/\.git$/,'');
 if(!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('仓库地址无效');
 const check=cp.spawnSync('gh',['auth','status'],{stdio:'ignore',windowsHide:true});if(check.error||check.status!==0)throw Error('GitHub CLI 未安装或未登录；签名已保留，配置 Secrets 后可继续');
 const values={ANDROID_KEYSTORE_BASE64:fs.readFileSync(keystore).toString('base64'),ANDROID_STORE_PASSWORD:env.XY_ANDROID_STORE_PASSWORD,ANDROID_KEY_ALIAS:env.XY_ANDROID_KEY_ALIAS,ANDROID_KEY_PASSWORD:env.XY_ANDROID_KEY_PASSWORD};
 for(const [name,value] of Object.entries(values)){const result=cp.spawnSync('gh',['secret','set',name,'--repo',repo],{input:value,encoding:'utf8',windowsHide:true});if(result.error||result.status!==0)throw Error('设置 '+name+' 失败；修复权限后可安全重试（沿用同一签名）');console.log('已配置 '+name);}
}
function build(){
 const signing=signingEnvironment();const {javaHome,sdkDirectory}=require('./build-android');const env={...signing,JAVA_HOME:javaHome(),ANDROID_HOME:sdkDirectory()};
 if(!env.JAVA_HOME||!env.ANDROID_HOME)throw Error('需要 JDK 17 和 Android SDK 34');
 const run=(exe,args,cwd=ROOT)=>{const result=cp.spawnSync(exe,args,{cwd,env,stdio:'inherit',windowsHide:true});if(result.error||result.status!==0)throw Error('正式构建命令失败：'+path.basename(exe));};
 run(process.execPath,['scripts/build-android.js','--sync-only']);
 run(process.env.ComSpec||'cmd.exe',['/d','/c','gradlew.bat','assembleRelease','--console=plain'],path.join(ROOT,'android'));
 const file=path.join(ROOT,'android/app/build/outputs/apk/release/app-release.apk');
 run(path.join(env.JAVA_HOME,'bin/java.exe'),['-jar',path.join(env.ANDROID_HOME,'build-tools/34.0.0/lib/apksigner.jar'),'verify',file]);
 const version=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version,destination=path.join(path.dirname(file),'xiaoyang-music-'+version+'-android.apk');fs.copyFileSync(file,destination);console.log('正式签名 APK：'+destination);return destination;
}
if(require.main===module)try{if(process.argv.includes('--create'))create();else if(process.argv.includes('--configure-github'))configureGitHub();else if(process.argv.includes('--build'))build();else throw Error('参数：--create、--configure-github 或 --build');}catch(e){console.error(e.message);process.exitCode=1;}
module.exports={signingEnvironment,create,configureGitHub,build};
