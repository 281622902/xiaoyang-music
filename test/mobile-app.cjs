const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events');
let pw;try{pw=require('playwright');}catch{pw=require(process.env.PLAYWRIGHT_MODULE || '../electron/node_modules/playwright');}
process.env.MOCK='1';const {server}=require('../server');
let browser,base,failures=0;
const songs=[{id:'one',name:'微风经过的地方',artist:'小杨乐队',album:'慢慢来',vendor:'netease',duration:30},{id:'two',name:'把日常调成喜欢',artist:'小杨乐队',album:'慢慢来',vendor:'netease',duration:30}];
const wav=Buffer.alloc(44+16000*30);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+'\n'+e.stack);}}
async function pageFor(width){
 const context=await browser.newContext({viewport:{width,height:820}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.abort());
 await page.route('**/test.wav',r=>r.fulfill({body:wav,contentType:'audio/wav'}));
 await page.route('**/api/**',async r=>{const u=new URL(r.request().url());let body={code:200};
  if(u.pathname==='/api/search'){if(u.searchParams.get('keyword')==='slow')await new Promise(r=>setTimeout(r,250));body={code:200,result:songs.map(t=>({...t,name:u.searchParams.get('keyword')==='fast'?'新结果':t.name})),total:2};}
  if(u.pathname==='/api/song')body={code:200,data:{...(songs.find(t=>t.id===u.searchParams.get('id'))||songs[0]),url:base+'/test.wav',lyric:'[00:00]每个日常都值得喜欢\n[00:10]把好声音装进口袋'}};
  if(u.pathname==='/api/lyric')body={code:200,lyric:'[00:00]每个日常都值得喜欢'};
  if(u.pathname==='/api/playlists')body={code:200,list:[{id:'list1',name:'给通勤的一封信',playCount:12000}]};
  if(u.pathname==='/api/charts')body={code:200,charts:[{id:'3778678',name:'热歌榜',desc:'此刻流行'}]};
  if(u.pathname==='/api/playlist')body={code:200,info:{name:'给通勤的一封信'},tracks:songs};
  if(u.pathname==='/api/suggest')body={code:200,hot:['晴天','晚风','纯音乐']};
  if(u.pathname==='/api/artist')body={code:200,tracks:songs};
  if(u.pathname==='/api/album')body={code:200,info:{name:'慢慢来'},tracks:songs};
  try{await r.fulfill({json:body});}catch{}
 });
 await page.goto(base+'/android.html');await page.waitForFunction(()=>!!window.XYMobileApp);return{page,context,errors};
}
(async()=>{
 await check('Android staged entry is independent from desktop',()=>{assert.equal(require('../capacitor.config.json').webDir,'capacitor/www');const html=fs.readFileSync(path.join(__dirname,'../capacitor/www/index.html'),'utf8');assert.match(html,/js\/android.js/);assert.doesNotMatch(html,/js\/app.js/);assert.match(fs.readFileSync(path.join(__dirname,'../app/index.html'),'utf8'),/js\/app.js/);});
 server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 browser=await pw.chromium.launch({executablePath:process.env.BROWSER_PATH,headless:true});
 for(const width of [360,390,768,1098])await check('dedicated navigation, discovery and layout at '+width+'px',async()=>{const p=await pageFor(width);try{
  await p.page.waitForSelector('.cover-card');assert.equal(await p.page.locator('.bottom-nav button').count(),4);assert.equal(await p.page.locator('.sidebar').count(),0);assert.ok(await p.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await p.page.click('.bottom-nav [data-nav="me"]');await p.page.waitForSelector('#page-me:not([hidden])');
  await p.page.click('[data-action="account"]');assert.equal(await p.page.locator('#accountBackdrop').isVisible(),true);assert.equal(await p.page.locator('#mobilePhone').inputValue(),'');
  await p.page.locator('#mobilePassword').focus();await p.page.setViewportSize({width,height:430});await p.page.waitForTimeout(350);const box=await p.page.locator('#mobilePassword').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=430,JSON.stringify(box));assert.deepEqual(p.errors,[]);
  if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await p.page.click('[data-action="closeAccount"]');await p.page.setViewportSize({width,height:820});await p.page.click('.bottom-nav [data-nav="discover"]');await p.page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'手机版首页-'+width+'.png')});}
 }finally{await p.context.close();}});
 await check('search, shared playback, lyrics, favorites and queue form a working flow',async()=>{const p=await pageFor(390);try{
  await p.page.click('.bottom-nav [data-nav="search"]');await p.page.fill('#mobileSearchInput','晚风');await p.page.click('#mobileSearchForm button');await p.page.waitForSelector('#mobileResults .track-main');await p.page.click('#mobileResults .track-main >> nth=0');
  await p.page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);assert.equal(await p.page.locator('#mobileMiniName').innerText(),songs[0].name);
  await p.page.click('.mini-song');assert.equal(await p.page.locator('#mobilePlayer').isVisible(),true);await p.page.click('#lyricToggle');await p.page.waitForSelector('[data-lyric-time]');assert.match(await p.page.locator('#mobileLyrics').innerText(),/每个日常/);
  await p.page.click('#mobilePlay');assert.equal(await p.page.evaluate(()=>document.querySelector('audio').paused),true);await p.page.click('#mobilePlay');await p.page.waitForFunction(()=>!document.querySelector('audio').paused);
  await p.page.click('[data-action="closePlayer"]');await p.page.click('#mobileResults [data-track-menu] >> nth=1');await p.page.click('[data-action="enqueue"]');assert.equal(await p.page.evaluate(()=>Player.getQueue().length),2);
  await p.page.click('#mobileResults [data-track-menu] >> nth=0');await p.page.click('[data-action="deviceFavorite"]');assert.equal(await p.page.evaluate(()=>Player.getFavorites().length),1);
  await p.page.click('.mini-song');await p.page.click('.player-controls [data-action="next"]');await p.page.waitForFunction(()=>Player.getState().current?.id==='two'&&document.querySelector('audio').currentTime>.1);assert.deepEqual(p.errors,[]);
 }finally{await p.context.close();}});
 await check('playlist create, add, rename, play and confirmed delete',async()=>{const p=await pageFor(390);try{
  await p.page.click('.bottom-nav [data-nav="library"]');await p.page.click('[data-action="createPlaylist"]');await p.page.fill('#newPlaylistName','通勤 <安全>');await p.page.click('#playlistCreateForm .primary');await p.page.waitForFunction(()=>document.querySelector('#detailTitle').textContent==='通勤 <安全>');
  await p.page.click('.bottom-nav [data-nav="search"]');await p.page.fill('#mobileSearchInput','晚风');await p.page.click('#mobileSearchForm button');await p.page.waitForSelector('#mobileResults .track-main');await p.page.click('#mobileResults [data-track-menu] >> nth=0');await p.page.click('[data-action="addToPlaylist"]');await p.page.click('[data-add-playlist]');
  await p.page.click('.bottom-nav [data-nav="library"]');await p.page.click('[data-local-playlist]');await p.page.waitForSelector('#detailTracks .track-main');await p.page.click('#detailRename');await p.page.fill('#renamePlaylistName','通勤新歌单');await p.page.click('#playlistRenameForm .primary');assert.equal(await p.page.locator('#detailTitle').innerText(),'通勤新歌单');
  await p.page.click('#detailPlayAll');await p.page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);await p.page.click('[data-action="closePlayer"]');await p.page.click('#detailRename');await p.page.click('#deletePlaylist');assert.equal(await p.page.evaluate(()=>JSON.parse(localStorage.getItem('uzz.playlists')).length),1);await p.page.click('#confirmDeletePlaylist');await p.page.waitForFunction(()=>JSON.parse(localStorage.getItem('uzz.playlists')).length===0);assert.deepEqual(p.errors,[]);
 }finally{await p.context.close();}});
 await check('late search cannot replace newer results and failures offer retry',async()=>{const p=await pageFor(390);try{
  await p.page.evaluate(()=>XYMobileApp.navigate('search'));await p.page.fill('#mobileSearchInput','slow');await p.page.click('#mobileSearchForm button');await p.page.fill('#mobileSearchInput','fast');await p.page.click('#mobileSearchForm button');await p.page.waitForSelector('#mobileResults .track-main');await p.page.waitForTimeout(350);assert.match(await p.page.locator('#mobileResults').innerText(),/新结果/);assert.deepEqual(p.errors,[]);
  await p.page.route('**/api/search?**',r=>r.abort());await p.page.fill('#mobileSearchInput','network failure');await p.page.click('#mobileSearchForm button');await p.page.waitForSelector('[data-action="retrySearch"]');assert.match(await p.page.locator('#searchSummary').innerText(),/失败/);
 }finally{await p.context.close();}});
 await check('playback error offers retry and clears its recovery message',async()=>{const p=await pageFor(390);try{
  await p.page.click('[data-online="3778678"]');await p.page.waitForSelector('#detailTracks .track-main');await p.page.click('#detailPlayAll');await p.page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  await p.page.evaluate(()=>{const a=document.querySelector('audio');Object.defineProperty(a,'error',{configurable:true,value:{message:'网络连接失败，请检查网络后重试'}});a.retry=async()=>{window.__retryCount=(window.__retryCount||0)+1;Object.defineProperty(a,'error',{configurable:true,value:null});a.dispatchEvent(new Event('timeupdate'));};a.dispatchEvent(new Event('error'));});
  await p.page.waitForSelector('#playbackRecovery:not([hidden])');assert.match(await p.page.locator('#playbackRecoveryMessage').innerText(),/网络连接失败/);await p.page.click('[data-action="retryPlayback"]');await p.page.waitForFunction(()=>window.__retryCount===1&&document.querySelector('#playbackRecovery').hidden);assert.deepEqual(p.errors,[]);
 }finally{await p.context.close();}});
 await check('cloud heart opens login without writing while guest',async()=>{const p=await pageFor(390);try{
  await p.page.click('[data-online="3778678"]');await p.page.waitForSelector('#detailTracks .track-main');await p.page.click('#detailPlayAll');await p.page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);await p.page.waitForFunction(()=>!document.querySelector('#favoriteBtn').disabled);await p.page.click('#favoriteBtn');assert.equal(await p.page.locator('#accountBackdrop').isVisible(),true);assert.match(await p.page.locator('#mobileAuthStatus').innerText(),/登录后/);assert.equal(await p.page.locator('#mobilePassword').inputValue(),'');assert.deepEqual(p.errors,[]);
 }finally{await p.context.close();}});
})().catch(e=>{failures++;console.error(e);}).finally(async()=>{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));process.exitCode=failures?1:0;});
