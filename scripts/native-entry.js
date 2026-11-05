// 只打包平台插件，不改播放器的原生 HTML/JS 架构。
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
export { Capacitor, CapacitorHttp, Browser, App, Keyboard, StatusBar };
export const NativeMusic = registerPlugin('NativeMusic');
export const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function openUpdate(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:') throw new Error('更新下载地址必须使用 HTTPS');
  if (isAndroid) {
    // 后端 /api/release-file 代理地址不带 .apk 后缀（流式转发），放行自家音乐服务的下载代理
    const apiBase = (localStorage.getItem('uzz.apiBase') || '').replace(/\/+$/, '');
    const viaProxy = !!apiBase && url.href.startsWith(apiBase + '/api/release-file');
    if (!viaProxy && !url.pathname.toLowerCase().endsWith('.apk')) throw new Error('安卓更新需要 .apk 安装包下载链接');
    // Android 使用系统浏览器的 Custom Tab，下载交由浏览器完成。
    await Browser.open({ url: url.href, toolbarColor: '#0c151c' });
  } else window.open(url.href, '_blank', 'noopener,noreferrer');
}

if (isAndroid) {
  document.documentElement.classList.add('native-android');
  Promise.allSettled([
    StatusBar.setOverlaysWebView({ overlay: false }),
    StatusBar.setStyle({ style: Style.Dark }),
    StatusBar.setBackgroundColor({ color: '#f7faf8' })
  ]).then(results => {
    if (results.some(result => result.status === 'rejected')) console.info('状态栏使用原生主题回退');
  });
}
