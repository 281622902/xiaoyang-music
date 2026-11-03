const os=require('node:os');
function privateIPv4(host){const p=String(host).split('.');if(p.length!==4||p.some(v=>!/^\d{1,3}$/.test(v)||Number(v)>255||String(Number(v))!==v))return false;const n=p.map(Number);return n[0]===10||n[0]===192&&n[1]===168||n[0]===172&&n[1]>=16&&n[1]<=31;}
function configuration(env=process.env,interfaces=os.networkInterfaces()){
 const lan=[];const add=(host,label)=>{if(privateIPv4(host)&&!lan.some(x=>x.host===host))lan.push({host,label,url:'http://'+host+':3000'});};
 for(const host of (env.XY_ANDROID_LAN_HOSTS||'').split(',').filter(Boolean)){if(!privateIPv4(host.trim()))throw Error('XY_ANDROID_LAN_HOSTS 只接受私有 IPv4 地址');add(host.trim(),'指定电脑地址');}
 if(!env.CI)for(const [label,entries] of Object.entries(interfaces))for(const item of entries||[])if(!item.internal&&item.family==='IPv4')add(item.address,label);
 const rank=item=>item.label==='指定电脑地址'?0:/vgate|virtual|vmware|vethernet|docker|wsl|loopback|mumu|hyper-v/i.test(item.label)?2:1;lan.sort((a,b)=>rank(a)-rank(b));
 let defaultBackend='';if(env.XY_MUSIC_API_BASE){const u=new URL(env.XY_MUSIC_API_BASE);if(u.username||u.password||u.search||u.hash||u.protocol!=='https:')throw Error('XY_MUSIC_API_BASE 必须是无凭据的 HTTPS 服务地址');defaultBackend=u.href.replace(/\/+$/,'');}
 return{defaultBackend,lan,cleartextHosts:['localhost','127.0.0.1','10.0.2.2','10.0.3.2',...lan.map(x=>x.host)]};
}
function securityXML(config){return '<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n    <base-config cleartextTrafficPermitted="false" />\n    <!-- Only packaged development/PC LAN hosts; public backends require HTTPS. -->\n    <domain-config cleartextTrafficPermitted="true">\n'+config.cleartextHosts.map(host=>'        <domain>'+host+'</domain>').join('\n')+'\n    </domain-config>\n</network-security-config>\n';}
module.exports={configuration,privateIPv4,securityXML};
