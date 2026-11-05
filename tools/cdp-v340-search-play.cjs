// v3.4.0 手机端「搜索 → 播放」端到端验证（MuMu 实机）
// 覆盖：搜索真实返回结果、点第一条起播、原生播放器真实出声（position 前进）
const http = require('http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listTargets = () => new Promise((res, rej) => http.get('http://127.0.0.1:9222/json/list', (r) => {
  let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
}).on('error', rej));

(async () => {
  const t = (await listTargets()).find((x) => x.type === 'page');
  if (!t) { console.log(JSON.stringify({ error: 'no page target' })); process.exit(1); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.resolve(m.result); }
  };
  const evalJs = (expression) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('eval timeout #' + id)); }, 40000);
    pending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r?.result?.value); }, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  const val = async (e) => evalJs(e);
  const json = async (e) => { try { return JSON.parse(await val(e) || '{}'); } catch { return {}; } };

  const out = { steps: [] };
  const log = (name, ok, detail) => { out.steps.push({ name, ok, detail }); console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : '')); };

  ws.onopen = async () => {
    try {
      // 1) 定位到搜索页
      await val(`location.hash='#search'; 1`); await sleep(1500);

      // 2) 输入关键词并提交
      const submitted = await val(`(()=>{
        const inp=document.getElementById('mobileSearchInput');
        if(!inp)return 'NO_INPUT';
        inp.value='发如雪';
        document.getElementById('mobileSearchForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
        return 'ok';
      })()`);
      log('提交搜索', submitted === 'ok', String(submitted));

      // 3) 等结果渲染
      let rows = 0, summary = '';
      for (let i = 0; i < 25; i++) {
        await sleep(1000);
        const s = await json(`JSON.stringify({
          summary: document.getElementById('searchSummary')?.textContent||'',
          rows: document.querySelectorAll('#mobileResults .track-row').length,
          names: [...document.querySelectorAll('#mobileResults .track-row strong')].slice(0,5).map(e=>e.textContent.trim())
        })`);
        rows = s.rows; summary = s.summary;
        if (rows > 0 && !/正在|寻找|搜索中/.test(summary)) { out.names = s.names; break; }
        out.names = s.names;
      }
      log('搜索返回真实结果', rows > 0, `rows=${rows} summary=${summary} 样例=${(out.names || []).join('/')}`);

      // 4) 点第一条起播
      const clicked = await val(`(()=>{
        const first=document.querySelector('#mobileResults .track-row .track-main');
        if(!first)return 'NO_RESULT_ITEM';
        first.click();
        return 'clicked';
      })()`);
      log('点击第一条结果', clicked === 'clicked', String(clicked));

      // 5) 等播放器起来，记录两次位置看是否在走
      await sleep(6000);
      const s1 = await json(`(()=>{
        const st=window.Player?.getState?.()||{};
        const a=window.XYAudio||document.getElementById('audio');
        return JSON.stringify({
          cur: st.current?(st.current.vendor+' | '+st.current.name+' | '+st.current.artist):null,
          url:(st.current?.url||'').slice(0,90)||null,
          paused: a?a.paused:null,
          pos: a?Math.round(a.currentTime||0):null,
          dur: a?Math.round(a.duration||0):null,
          err: a&&a.error?(a.error.code+'/'+(a.error.nativeCode||'')):null
        });
      })()`);
      log('播放器已载入曲目', !!s1.cur, `cur=${s1.cur} url=${s1.url} err=${s1.err}`);

      await sleep(6000);
      const s2 = await json(`(()=>{
        const a=window.XYAudio||document.getElementById('audio');
        return JSON.stringify({pos:a?Math.round(a.currentTime||0):null,paused:a?a.paused:null,err:a&&a.error?(a.error.code+'/'+(a.error.nativeCode||'')):null});
      })()`);
      const advanced = (s2.pos || 0) > (s1.pos || 0);
      log('音频真实在播放（进度前进）', advanced && !s2.err, `pos ${s1.pos}s → ${s2.pos}s paused=${s2.paused} err=${s2.err}`);

      // 6) 歌词面板
      const lyric = await json(`JSON.stringify({
        hasLyricBtn: !!document.getElementById('lyricToggle'),
        hasTransBtn: !!document.getElementById('lyricTrans'),
        lyricRows: document.querySelectorAll('#lyricPanel .lyric-line, #lyricPanel p').length
      })`);
      log('播放器歌词区可用', lyric.hasLyricBtn === true, `歌词按钮=${lyric.hasLyricBtn} 翻译按钮=${lyric.hasTransBtn} 行数=${lyric.lyricRows}`);

      out.ok = out.steps.every((s) => s.ok);
      console.log('\n结果：' + (out.ok ? '✓ 搜索与播放端到端全部通过' : '✗ 有失败项'));
    } catch (e) {
      out.fatal = e.message;
      console.log('FATAL', e.message);
    }
    ws.close();
    process.exit(out.ok ? 0 : 1);
  };
})().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
