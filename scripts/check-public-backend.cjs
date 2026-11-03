const assert=require('node:assert/strict');
async function inspect(value,{fetchImpl=fetch}={}){
 const base=new URL(value);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('请输入无凭据的 HTTPS 音乐后端地址');
 const root=base.href.replace(/\/+$/,'');
 const get=async pathname=>{const response=await fetchImpl(root+pathname,{signal:AbortSignal.timeout(45000),redirect:'error'});return response;};
 const health=await get('/api/health');if(!health.ok)throw Error('健康接口 HTTP '+health.status);const data=await health.json();assert.equal(data.service,'xiaoyang-music-api','返回的不是小杨音乐公网 API');assert.equal(data.publicMode,true,'服务未开启公网模式');
 const tests=['/api/local/session','/api/account/login','/index.html','/api/stream?url='+encodeURIComponent('http://127.0.0.1/')];
 for(const pathname of tests){const r=await get(pathname);if(![403,404].includes(r.status))throw Error('公网隔离检查未通过：'+pathname);await r.body?.cancel();}
 return{base:root,health:'ok',publicMode:true,localEndpoints:'blocked'};
}
if(require.main===module)inspect(process.argv[2]||'').then(value=>console.log(JSON.stringify(value,null,2))).catch(error=>{console.error('公网后端检查失败：'+error.message);process.exitCode=1;});
module.exports={inspect};
