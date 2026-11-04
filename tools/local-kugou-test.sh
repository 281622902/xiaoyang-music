#!/bin/bash
# 强制验证酷狗跨源路径：vendor=kugou 的曲目 → GDStudio 跨源 → 网易可播地址
cd "$(dirname "$0")/.." || exit 1
mkdir -p tmp-test
XY_PUBLIC_API=1 XY_SEARCH_TIMEOUT=8000 XY_PROBE_TIMEOUT=6000 XY_RESOLVE_TIMEOUT=25000 PORT=3806 node server/index.js &
SRV=$!
sleep 2
echo "== 1. 搜酷狗源拿「发如雪」ID =="
curl -s -m 40 "http://localhost:3806/api/search?keyword=%E5%8F%91%E5%A6%82%E9%9B%AA&type=song&page=1&limit=5&vendor=kugou" -o tmp-test/k1.json -w "http:%{http_code}\n"
node -e "const j=require('./tmp-test/k1.json');(j.result||[]).slice(0,3).forEach(t=>console.log(t.vendor,t.id,t.name,'|',t.artist))"
ID=$(node -e "const j=require('./tmp-test/k1.json');const t=(j.result||[]).find(x=>x.name.includes('发如雪'))||j.result[0];console.log(t.id)")
N=$(node -e "const j=require('./tmp-test/k1.json');const t=(j.result||[]).find(x=>x.name.includes('发如雪'))||j.result[0];console.log(encodeURIComponent(t.name))")
A=$(node -e "const j=require('./tmp-test/k1.json');const t=(j.result||[]).find(x=>x.name.includes('发如雪'))||j.result[0];console.log(encodeURIComponent(t.artist))")
echo "== 2. /api/song vendor=kugou（跨源 GDStudio 兜底）=="
curl -s -m 60 "http://localhost:3806/api/song?id=$ID&vendor=kugou&name=$N&artist=$A&quality=standard" -o tmp-test/k2.json -w "http:%{http_code} time:%{time_total}s\n"
node -e "const j=require('./tmp-test/k2.json');const d=j.data||{};console.log('resolved vendor:',d.vendor||'(空)');console.log('url:',(d.url||'EMPTY').slice(0,95));console.log('exhausted:',!!d.exhausted,'timeout:',!!d.resolveTimeout)"
echo "== 3. 流探测 =="
URL=$(node -e "const j=require('./tmp-test/k2.json');console.log((j.data||{}).url||'')")
if [ -n "$URL" ]; then
  ENC=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$URL")
  curl -s -m 25 -o /dev/null -w "stream http:%{http_code} len:%{size_download}\n" -H "Range: bytes=0-1" "http://localhost:3806/api/stream?url=$ENC"
else
  echo "NO URL"
fi
kill $SRV 2>/dev/null
echo "[done]"
