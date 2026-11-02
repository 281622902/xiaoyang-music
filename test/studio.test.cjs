const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const {once}=require('node:events');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xy-v3-'));process.env.UZZ_USER_DATA=temp;process.env.MOCK='1';
const {server}=require('../server/index');const {listenAvailable}=require('../electron/backend-start');let base,occupied;
test.before(async()=>{occupied=http.createServer((q,s)=>s.end('other application'));occupied.listen(0,'127.0.0.1');await once(occupied,'listening');const port=await listenAvailable(server,occupied.address().port);base='http://127.0.0.1:'+port;});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await new Promise(r=>occupied.close(r));fs.rmSync(temp,{recursive:true,force:true});});
let token,revision=0;
async function api(action,method='GET',data,auth=token){const r=await fetch(base+'/api/account/'+action,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,json:await r.json()};}
test('occupied backend port falls back without attaching to another application',async()=>{assert.notEqual(server.address().port,occupied.address().port);assert.equal((await (await fetch(base+'/api/health')).json()).code,200);});
test('register creates an account without persisting a plaintext password',async()=>{const r=await api('register','POST',{username:'studio_user',password:'a-long-test-password'});assert.equal(r.status,200);token=r.json.token;assert.ok(token);const raw=fs.readFileSync(path.join(temp,'accounts/accounts.json'),'utf8');assert.ok(!raw.includes('a-long-test-password'));assert.ok(!raw.includes(token));assert.equal((await api('me')).json.user.username,'studio_user');});
test('duplicate registration and invalid login are rejected',async()=>{assert.equal((await api('register','POST',{username:'studio_user',password:'a-long-test-password'})).status,409);assert.equal((await api('login','POST',{username:'studio_user',password:'wrong-password'})).status,401);});
test('backup strips local audio paths and credentials',async()=>{const r=await api('state','PUT',{revision:0,state:{favorites:[{id:'1',vendor:'netease',name:'Song',path:'D:\\private.wav',url:'secret-url'},{id:'local',vendor:'local',name:'Local',path:'D:\\private.wav'}],settings:{'uzz.volume':'0.5','password':'secret','uzz.proxyUrl':'secret'},playlists:[]}});assert.equal(r.status,200);revision=r.json.revision;const state=(await api('state')).json.state;assert.equal(state.favorites.length,1);assert.equal(state.favorites[0].path,undefined);assert.equal(state.favorites[0].url,undefined);assert.deepEqual(state.settings,{'uzz.volume':'0.5'});});
test('stale backup revision cannot overwrite a newer backup',async()=>{assert.equal((await api('state','PUT',{revision:0,state:{}})).status,409);assert.equal((await api('state')).json.revision,revision);});
test('account states are isolated between users',async()=>{const other=await api('register','POST',{username:'second_user',password:'another-test-password'});const state=await api('state','GET',null,other.json.token);assert.equal(state.json.state.favorites.length,0);});
test('logout invalidates a session and a new login restores access',async()=>{assert.equal((await api('logout','POST',{})).status,200);assert.equal((await api('me')).status,401);const result=await api('login','POST',{username:'studio_user',password:'a-long-test-password'});assert.equal(result.status,200);token=result.json.token;assert.equal((await api('state')).json.state.favorites.length,1);});
test('foreign websites cannot create or access accounts',async()=>{const r=await fetch(base+'/api/account/me',{headers:{Origin:'https://foreign.example',Authorization:'Bearer '+token}});assert.equal(r.status,403);});
test('account UI and settings layouts work at multiple window widths',async()=>{
  let pw;try{pw=require('playwright');}catch{pw=require('../electron/node_modules/playwright');}
  const browser=await pw.chromium.launch({executablePath:process.env.BROWSER_PATH||undefined});const page=await browser.newPage({viewport:{width:1180,height:820}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**',route=>route.abort());
  await page.route('**/api/**',route=>{if(/\/api\/(local|account)\//.test(route.request().url()))return route.continue();return route.fulfill({json:{code:200,tracks:[],list:[],charts:[],hot:[],info:{}}});});
  try{
    await page.goto(base);await page.click('#accountOpen');await page.locator('#legacyAccount summary').click();await page.click('#accountRegisterTab');await page.fill('#accountUsername','ui_user');await page.fill('#accountPassword','ui-test-password');await page.click('#accountSubmit');await page.waitForFunction(()=>!document.getElementById('accountMember').classList.contains('hidden'));assert.equal(await page.locator('#accountName').textContent(),'ui_user');
    await page.click('#accountBackup');await page.waitForFunction(()=>document.getElementById('accountStatus').textContent.includes('已备份'));await page.click('#accountClose');
    await page.click('#tbSettings');
    for(const width of [940,1180,1440])for(const theme of ['dark','light']){
      await page.setViewportSize({width,height:820});await page.evaluate(theme=>{localStorage.setItem('uzz.theme.mode',theme);document.dispatchEvent(new CustomEvent('xy:libraryRestore'));},theme);
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
      await page.waitForTimeout(220);
      const layout=await page.evaluate(()=>{const button=document.getElementById('stOpenDefApps'),hint=document.getElementById('stDefaultTip');return {buttonWidth:button.clientWidth,overflow:button.scrollWidth>button.clientWidth+1,hintWidth:hint.clientWidth,height:hint.getBoundingClientRect().height};});
      assert.ok(layout.buttonWidth>90&&!layout.overflow,JSON.stringify(layout));assert.ok(layout.hintWidth>200&&layout.height<100,JSON.stringify(layout));
      if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`settings-${theme}-${width}.png`)});}
    }
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('uzz:view',{detail:'discover'})));if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'studio-home.png')});assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
