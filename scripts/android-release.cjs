'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {verifyGitHubAsset,safeMessage}=require('./update-supabase');
const ROOT=path.resolve(__dirname,'..');
function config(env=process.env,root=ROOT){
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const tag=env.RELEASE_TAG||env.GITHUB_REF_NAME||'v'+pkg.version;
 if(!/^v\d+\.\d+\.\d+$/.test(tag))throw Error('安卓正式发布标签应为 v主版本.次版本.修订号');
 const version=tag.slice(1),repository=env.RELEASE_REPOSITORY||env.GITHUB_REPOSITORY||'281622902/xiaoyang-music';
 if(!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository)||repository.split('/').some(part=>part==='.'||part==='..'))throw Error('GitHub 仓库格式错误');
 const assetName='xiaoyang-music-'+version+'-android.apk';
 return{tag,version,repository,assetName,rootVersion:pkg.version,row:{platform:'android',version,download_url:'https://github.com/'+repository+'/releases/download/'+tag+'/'+assetName,release_notes:'安卓新版：独立手机界面、原生后台播放与本地音乐'}};
}
function prepare(env=process.env,root=ROOT){const c=config(env,root);for(const file of ['package.json','package-lock.json']){const target=path.join(root,file);if(!fs.existsSync(target))continue;const p=JSON.parse(fs.readFileSync(target,'utf8'));p.version=c.version;if(p.packages?.[''])p.packages[''].version=c.version;fs.writeFileSync(target,JSON.stringify(p,null,2)+'\n');}const client=path.join(root,'app/js/supabase-client.js');const text=fs.readFileSync(client,'utf8').replace(/(appVersion:\s*)'[^']*'/,"$1'"+c.version+"'");fs.writeFileSync(client,text);return c;}
function checkApk(file,env=process.env){const c=config(env);const sdk=env.ANDROID_HOME||env.ANDROID_SDK_ROOT;const aapt=path.join(sdk||'', 'build-tools/34.0.0',process.platform==='win32'?'aapt.exe':'aapt');const output=cp.execFileSync(aapt,['dump','badging',path.resolve(file)],{encoding:'utf8'});const line=output.split('\n').find(l=>l.startsWith('package:'))||'';if(!line.includes("name='com.xiaoyang.musicplayer'")||!line.includes("versionName='"+c.version+"'"))throw Error('APK 包名或版本与发布标签不符');return c;}
async function sync({env=process.env,createClient,fetchImpl=fetch}={}){
 const c=config(env);if(c.rootVersion!==c.version)throw Error('请先按标签准备安卓版本再打包');
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('缺少 Supabase 发布 Secrets');
 const project=new URL(env.SUPABASE_URL);if(project.protocol!=='https:'||project.username||project.password||project.search||project.hash||!['','/'].includes(project.pathname))throw Error('Supabase 项目地址无效');
 const release=await verifyGitHubAsset(c,env,fetchImpl);c.row.download_url=release.download_url;
 if(!createClient)({createClient}=require('@supabase/supabase-js'));
 const client=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await client.from('app_versions').upsert(c.row,{onConflict:'platform,version'});if(error)throw Error(error.message);return c.row;
}
if(require.main===module)(async()=>{let result;if(process.argv.includes('--prepare'))result=prepare();else if(process.argv.includes('--check-apk'))result=checkApk(process.argv[process.argv.indexOf('--check-apk')+1]);else result=await sync();console.log(JSON.stringify(result));})().catch(e=>{console.error('安卓发布失败：'+safeMessage(e));process.exitCode=1;});
module.exports={config,prepare,checkApk,sync};
