/* HTMLAudio-compatible adapter backed by the Android MediaSessionService. */
(function(global){
 'use strict';
 if(!global.XYNative?.isAndroid || !document.documentElement.classList.contains('mobile-app'))return;
 const plugin=global.XYNative.NativeMusic;
 class NativeAudio extends EventTarget {
  constructor(){super();this.nativeQueue=true;this._src='';this._time=0;this.duration=0;this.paused=true;this.readyState=0;this.error=null;this._volume=1;this.epoch=0;this.tail=Promise.resolve();this.generation=0;this.initial=true;this.connected=false;
   this.listener=plugin.addListener('state',s=>this.update(s));
   this.connection=this.connect();
   document.addEventListener('xy:player',e=>{if(e.detail.kind==='queue'&&this._src)this.syncQueue();});
   global.addEventListener('pagehide',()=>{this.listener.then(l=>l.remove()).catch(()=>{});},{once:true});
  }
  async connect(){for(let i=0;i<20;i++){try{const s=await plugin.getState();if(s.connected){this.connected=true;this.update(s);return;}}catch{}await new Promise(r=>setTimeout(r,150));}throw Error('原生播放服务连接失败，请重新打开应用');}
  command(method,options={}){const task=this.tail.catch(()=>{}).then(()=>this.connection).then(()=>plugin[method](options));this.tail=task;task.catch(()=>{});return task;}
  get src(){return this._src;}get currentSrc(){return this._src;}set src(value){this._src=String(value||'');this.error=null;this.readyState=0;this._time=0;this.duration=0;this.generation++;this.initial=false;this.epoch++;const state=global.Player?.getState();if(!this._src||!state?.current)return;
   const tracks=state.queue.map(t=>({...t})),epoch=this.epoch;this.command('setQueue',{tracks,index:state.index,base:UzzApi.getApiBase(),url:this._src,position:0,play:false,mode:state.mode,quality:localStorage.getItem('uzz.quality')||'standard',epoch}).catch(e=>{if(epoch===this.epoch)this.fail(e);});
  }
  syncQueue(){const s=global.Player?.getState();if(!s?.current||!s.queue.length)return;this.command('setQueue',{tracks:s.queue.map(t=>({...t})),index:s.index,base:UzzApi.getApiBase(),url:this._src,position:this._time,play:!this.paused,preserve:true,mode:s.mode,quality:localStorage.getItem('uzz.quality')||'standard',epoch:this.epoch}).catch(e=>this.fail(e));}
  get currentTime(){return this._time;}set currentTime(value){this._time=Math.max(0,Number(value)||0);this.command('seek',{position:this._time}).catch(e=>this.fail(e));}
  get volume(){return this._volume;}set volume(value){this._volume=Math.max(0,Math.min(1,Number(value)||0));this.command('setVolume',{volume:this._volume}).catch(e=>this.fail(e));}
  // 倍速（v3.2.0）：转发到原生 Media3 setPlaybackSpeed（变速不变调）；还原用 1.0
  get playbackRate(){return this._rate||1;}set playbackRate(value){this._rate=Math.max(0.25,Math.min(4,Number(value)||1));if(this._rate!==1)this.command('setSpeed',{speed:this._rate}).catch(()=>{});else this.command('setSpeed',{speed:1}).catch(()=>{});}
  get defaultPlaybackRate(){return this._defRate||1;}set defaultPlaybackRate(value){this._defRate=Math.max(0.25,Math.min(4,Number(value)||1));if(this._rate===undefined){this._rate=this._defRate;this.command('setSpeed',{speed:this._defRate}).catch(()=>{});}}
  async play(){this.error=null;const generation=this.generation;await this.command('play');if(generation!==this.generation)return;this.paused=false;this.dispatchEvent(new Event('play'));}
  async retry(){const generation=this.generation;this.error=null;this.readyState=1;await this.command('retry',{base:UzzApi.getApiBase(),quality:localStorage.getItem('uzz.quality')||'standard'});if(generation!==this.generation)return;this.paused=false;this.dispatchEvent(new Event('play'));}
  replayState(){if(this.lastState?.queue?.length){const event=new Event('nativeTrack');event.state=this.lastState;this.dispatchEvent(event);}}
  pause(){this.paused=true;this.command('pause').catch(e=>this.fail(e));this.dispatchEvent(new Event('pause'));}
  load(){if(!this._src){const epoch=++this.epoch;this.command('stop',{epoch}).catch(e=>this.fail(e));this.dispatchEvent(new Event('emptied'));}}
  removeAttribute(name){if(name==='src'){this._src='';this.generation++;this.initial=false;}}
  next(){this.command('next').catch(e=>this.fail(e));}previous(){this.command('previous').catch(e=>this.fail(e));}
  setMode(mode){this.command('setMode',{mode}).catch(e=>this.fail(e));}
  fail(error){const code=String(error.message||'');let message=code;if(code.startsWith('ERROR_CODE_'))message=/TIMEOUT/.test(code)?'音源响应超时，请重试或切换歌曲':/NETWORK/.test(code)?'网络连接失败，请检查网络后重试':/FILE_NOT_FOUND|NO_PERMISSION/.test(code)?'无法读取本地文件，请重新选择授权':/DECODING|PARSING/.test(code)?'暂时无法解码此音频，请尝试其他格式':'音源暂时不可用，请重试或切换歌曲';this.error={code:4,nativeCode:code,message};this.dispatchEvent(new Event('error'));}
  update(s){if(!s.connected)return;this.connected=true;
   if(this.initial){this.epoch=s.epoch||0;this.initial=false;if(s.queue?.length)this._src='native:'+s.queue[s.index]?.id;}
   if((s.epoch||0)!==this.epoch)return;
   this.lastState={...this.lastState,...s};
   const hadError=!!this.error;
   if(!s.error)this.error=null;
   const wasPaused=this.paused,oldDuration=this.duration,oldTime=this._time,oldReadyState=this.readyState;
   this._time=s.position||0;this.duration=s.duration||0;this.paused=!!s.paused;this.readyState=s.readyState||0;
   if(s.queue?.length){const track=s.queue[s.index];const key=track?.vendor+'|'+track?.id;// 安卓直连国内 meting/CDN 直链（不经海外 /api/stream 转流）
const playable=track?.vendor==='device'?track.url:track?.url?track.url:'native:'+key;if(key!==this.mediaId){this.mediaId=key;this._src=playable;}else if(track?.url&&this._src.startsWith('native:'))this._src=playable;const event=new Event('nativeTrack');event.state=s;this.dispatchEvent(event);}
   if(this.duration&&this.duration!==oldDuration)this.dispatchEvent(new Event('loadedmetadata'));
   if(wasPaused!==this.paused)this.dispatchEvent(new Event(this.paused?'pause':'play'));
   if(oldTime!==this._time||oldDuration!==this.duration||wasPaused!==this.paused||oldReadyState!==this.readyState||hadError!==!!this.error)this.dispatchEvent(new Event('timeupdate'));
   if(s.error&&this.error?.nativeCode!==s.error)this.fail(Error(s.error));
  }
 }
 global.XYAudio=new NativeAudio();
 global.XYAudio.connection.catch(e=>global.XYAudio.fail(e));
})(window);
