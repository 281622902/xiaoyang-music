const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {config,prepare,sync}=require('../scripts/android-release.cjs');
test('Android tag and download links are dynamic, without Windows metadata dependency',()=>{
 const c=config({RELEASE_TAG:'v3.0.9',GITHUB_REPOSITORY:'281622902/xiaoyang-music'});assert.equal(c.version,'3.0.9');assert.equal(c.assetName,'xiaoyang-music-3.0.9-android.apk');assert.equal(c.row.platform,'android');assert.match(c.row.download_url,/v3\.0\.9\/xiaoyang-music-3\.0\.9-android\.apk$/);assert.throws(()=>config({RELEASE_TAG:'v3.0.9-beta'}));assert.throws(()=>config({RELEASE_REPOSITORY:'../bad'}));
});
test('CI preparation synchronizes package, lock and client versions in an isolated copy',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xy-android-release-'));try{fs.mkdirSync(path.join(root,'app/js'),{recursive:true});fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'1.0.0'}));fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify({version:'1.0.0',packages:{'':{version:'1.0.0'}}}));fs.writeFileSync(path.join(root,'app/js/supabase-client.js'),"const cloud={appVersion: '1.0.0'};");prepare({RELEASE_TAG:'v4.2.1'},root);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'4.2.1');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'))).packages[''].version,'4.2.1');assert.match(fs.readFileSync(path.join(root,'app/js/supabase-client.js'),'utf8'),/appVersion: '4.2.1'/);}finally{assert.ok(path.basename(root).startsWith('xy-android-release-')&&path.dirname(root)===os.tmpdir());fs.rmSync(root,{recursive:true,force:true});}
});
test('Only the formally published APK is synchronized; draft and wrong assets are rejected',async()=>{
 const c=config(),env={GH_TOKEN:'fake-token',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fake-key'};let writes=[];
 const makeClient=()=>({from:table=>({upsert:async(row,options)=>{writes.push({table,row,options});return{error:null};}})});
 const fetchRelease=draft=>async url=>({ok:true,json:async()=>url.includes('/assets?')?[{name:c.assetName,state:'uploaded',size:123,browser_download_url:c.row.download_url}]:{id:9,tag_name:c.tag,draft,prerelease:false,published_at:'2026-11-03T00:00:00Z'}});
 await assert.rejects(()=>sync({env,createClient:makeClient,fetchImpl:fetchRelease(true)}),/尚未正式发布/);assert.equal(writes.length,0);
 await sync({env,createClient:makeClient,fetchImpl:fetchRelease(false)});assert.equal(writes.length,1);assert.equal(writes[0].row.platform,'android');assert.match(writes[0].row.download_url,/\.apk$/);assert.equal(writes[0].options.onConflict,'platform,version');
});
