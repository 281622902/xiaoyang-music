#!/bin/bash
# 本地端到端验证：搜「发如雪」→ 酷狗曲目 → GDStudio 跨源解析 → 流探测
cd "$(dirname "$0")/.." || exit 1
mkdir -p tmp-test
XY_PUBLIC_API=1 XY_SEARCH_TIMEOUT=8000 XY_PROBE_TIMEOUT=6000 XY_RESOLVE_TIMEOUT=25000 PORT=3805 node server/index.js &
SRV=$!
sleep 2
echo "== 1. 搜「发如雪」=="
curl -s -m 40 "http://localhost:3805/api/search?keyword=%E5%8F%91%E5%A6%82%E9%9B%AA&type=song&page=1&limit=3&vendor=auto" -o tmp-test/f1.json -w "http:%{http_code} time:%{time_total}s\n"
node -e "const j=require('./tmp-test/f1.json');console.log('total:',j.total,'first:',j.result[0].vendor+'|'+j.result[0].name+'|'+j.result[0].artist)"
ID=$(node -e "const j=require('./tmp-test/f1.json');console.log(j.result[0].id)")
V=$(node -e "const j=require('./tmp-test/f1.json');console.log(j.result[0].vendor)")
N=$(node -e "const j=require('./tmp-test/f1.json');console.log(encodeURIComponent(j.result[0].name))")
A=$(node -e "const j=require('./tmp-test/f1.json');console.log(encodeURIComponent(j.result[0].artist))")
echo "== 2. 解析酷狗曲目 $V:$ID（应经 GDStudio 跨源出网易地址）=="
curl -s -m 60 "http://localhost:3805/api/song?id=$ID&vendor=$V&name=$N&artist=$A&quality=standard" -o tmp-test/f2.json -w "http:%{http_code} time:%{time_total}s\n"
node -e "const j=require('./tmp-test/f2.json');const d=j.data||{};console.log('resolved vendor:',d.vendor);console.log('url:',(d.url||'EMPTY').slice(0,95));console.log('exhausted:',!!d.exhausted,'timeout:',!!d.resolveTimeout,'trial:',!!d.trial)"
echo "== 3. 流探测（GET Range 0-1 /api/stream）=="
URL=$(node -e "const j=require('./tmp-test/f2.json');console.log((j.data||{}).url||'')")
if [ -n "$URL" ]; then
  ENC=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$URL")
  curl -s -m 25 -o /dev/null -w "stream http:%{http_code} len:%{size_download} time:%{time_total}s\n" -H "Range: bytes=0-1" "http://localhost:3805/api/stream?url=$ENC"
else
  echo "NO URL TO PROBE"
fi
kill $SRV 2>/dev/null
echo "[done]"
