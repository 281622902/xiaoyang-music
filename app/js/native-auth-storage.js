(function(global){
 'use strict';
 if(!global.XYNative?.isAndroid)return;
 const plugin=global.XYNative.NativeMusic;
 global.XYAuthStorage={
  async getItem(key){const {value}=await plugin.authStorageGet({key});if(value!=null)return value;
   const legacy=global.localStorage.getItem(key);if(legacy!=null){await plugin.authStorageSet({key,value:legacy});global.localStorage.removeItem(key);}return legacy;
  },
  async setItem(key,value){await plugin.authStorageSet({key,value});global.localStorage.removeItem(key);},
  async removeItem(key){await plugin.authStorageRemove({key});global.localStorage.removeItem(key);}
 };
})(window);
