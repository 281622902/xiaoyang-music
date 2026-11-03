'use strict';
const fs=require('node:fs'),path=require('node:path');

// A private GitHub repository's browser_download_url requires a GitHub login.
// Mirror only the signed application package, never a GitHub token, into public Storage.
async function publishAndroidDownload({client,config,env,fetchImpl=fetch}) {
 const file=path.resolve(env.ANDROID_APK_PATH||'android/app/build/outputs/apk/release/'+config.assetName);
 if(path.basename(file)!==config.assetName)throw Error('公开下载包名称与当前正式版本不符');
 const size=fs.statSync(file).size;
 if(size<4||size>128*1024*1024)throw Error('APK 大小异常');
 const bytes=fs.readFileSync(file);
 if(bytes.readUInt32LE(0)!==0x04034b50)throw Error('待发布文件不是 APK/ZIP');
 const bucket=env.ANDROID_PUBLIC_STORAGE_BUCKET||'app-releases';
 if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket))throw Error('公开下载存储桶名称无效');
 const existing=await client.storage.getBucket(bucket);
 if(existing.error) {
  // Only a missing bucket may be created. Permission/network errors must stop publication.
  if(!['404','NoSuchBucket','not_found'].includes(String(existing.error.statusCode||existing.error.code)))throw Error('读取 APK 下载存储桶失败：'+existing.error.message);
  // Inherit the project's global limit; a larger bucket limit is rejected on free projects.
  const created=await client.storage.createBucket(bucket,{public:true,allowedMimeTypes:['application/vnd.android.package-archive']});
  if(created.error)throw Error('创建 APK 下载存储桶失败：'+created.error.message);
 } else if(existing.data?.public!==true)throw Error('APK 下载存储桶不是公开桶；未修改现有桶权限');
 const object=config.tag+'/'+config.assetName,storage=client.storage.from(bucket);
 const uploaded=await storage.upload(object,bytes,{contentType:'application/vnd.android.package-archive',cacheControl:'3600',upsert:true});
 if(uploaded.error)throw Error('发布 APK 下载文件失败：'+uploaded.error.message);
 const url=new URL(storage.getPublicUrl(object).data.publicUrl),project=new URL(env.SUPABASE_URL);
 if(url.origin!==project.origin||url.pathname!=='/storage/v1/object/public/'+bucket+'/'+object||url.search||url.hash)throw Error('APK 公开下载地址无效');
 // This request deliberately has no Authorization header: validate the same path the phone uses.
 const probe=await fetchImpl(url.href,{method:'HEAD',signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!probe.ok||Number(probe.headers.get('content-length'))!==size)throw Error('APK 匿名下载校验失败；未写入版本表');
 return url.href;
}
module.exports={publishAndroidDownload};
