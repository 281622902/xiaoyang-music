'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),cp=require('node:child_process');
const {config,prepare,sync}=require('./android-release.cjs'),{verifyGitHubAsset,safeMessage}=require('./update-supabase');
async function repair(env=process.env){
 const c=config(env);await verifyGitHubAsset(c,env);
 const response=await fetch('https://api.github.com/repos/'+c.repository+'/releases/tags/'+c.tag,{headers:{Authorization:'Bearer '+env.GH_TOKEN,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('读取正式 APK 校验信息失败');const release=await response.json();const asset=release.assets.find(a=>a.name===c.assetName);
 if(!/^sha256:[a-f0-9]{64}$/.test(asset?.digest||''))throw Error('GitHub 未提供正式附件的 SHA-256；未同步');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xy-formal-apk-'));try{
  const downloaded=cp.spawnSync('gh',['release','download',c.tag,'--repo',c.repository,'--pattern',c.assetName,'--dir',directory],{env,stdio:'inherit',windowsHide:true});if(downloaded.status!==0)throw Error('下载正式 APK 失败');
  const file=path.join(directory,c.assetName),digest=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');if('sha256:'+digest!==asset.digest)throw Error('APK 与 GitHub 正式附件 SHA-256 不匹配');
  prepare(env);const row=await sync({env:{...env,ANDROID_PUBLIC_DOWNLOAD_MODE:'supabase',ANDROID_APK_PATH:file}});console.log(JSON.stringify({version:row.version,download_url:row.download_url,sha256:digest,verifiedFormalAttachment:true}));return row;
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
if(require.main===module)repair().catch(e=>{console.error(safeMessage(e));process.exitCode=1;});module.exports={repair};
