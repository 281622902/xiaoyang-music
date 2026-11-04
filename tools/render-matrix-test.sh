#!/bin/bash
# Render 云端后端全接口测试矩阵（带重试，防本机代理抽风）
BASE="https://xiaoyang-music-api.onrender.com"
export https_proxy=http://127.0.0.1:7897

fetch() { # fetch <path> <outfile>
  local path="$1" out="$2"
  for i in 1 2 3 4 5; do
    code=$(curl -s -m 45 "$BASE$path" -o "$out" -w "%{http_code}" 2>/dev/null)
    if [ "$code" = "200" ]; then echo "200"; return 0; fi
    echo "retry($code)" >&2; sleep 2
  done
  echo "FAIL"; return 1
}

echo "=== 1. 搜索单曲 (vendor=auto) ==="
fetch "/api/search?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=song&page=1&limit=5&vendor=auto" /tmp/r_song.json >/dev/null
node -e "const j=require('/tmp/r_song.json');console.log('total:',j.total);(j.result||[]).slice(0,3).forEach(t=>console.log(t.vendor,'|',t.id,'|',t.name,'|',t.artist))"

echo; echo "=== 2. 搜索歌手 ==="
fetch "/api/search?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=artist&page=1&limit=5&vendor=auto" /tmp/r_artist.json >/dev/null
node -e "const j=require('/tmp/r_artist.json');console.log('total:',j.total);(j.result||[]).slice(0,3).forEach(t=>console.log(t.id,'|',t.name))" 2>/dev/null || echo "EMPTY/BAD: $(head -c 200 /tmp/r_artist.json)"

echo; echo "=== 3. 搜索专辑 ==="
fetch "/api/search?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=album&page=1&limit=5&vendor=auto" /tmp/r_album.json >/dev/null
node -e "const j=require('/tmp/r_album.json');console.log('total:',j.total);(j.result||[]).slice(0,3).forEach(t=>console.log(t.id,'|',t.name))" 2>/dev/null || echo "EMPTY/BAD: $(head -c 200 /tmp/r_album.json)"

echo; echo "=== 4. 搜索歌单 ==="
fetch "/api/search?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=playlist&page=1&limit=5&vendor=auto" /tmp/r_pl.json >/dev/null
node -e "const j=require('/tmp/r_pl.json');console.log('total:',j.total);(j.result||[]).slice(0,3).forEach(t=>console.log(t.id,'|',t.name))" 2>/dev/null || echo "EMPTY/BAD: $(head -c 200 /tmp/r_pl.json)"

echo; echo "=== 5. 解析单曲（取第1首歌的 id/vendor）==="
ID=$(node -e "const j=require('/tmp/r_song.json');console.log((j.result||[])[0]?.id||'')")
V=$(node -e "const j=require('/tmp/r_song.json');console.log((j.result||[])[0]?.vendor||'')")
N=$(node -e "const j=require('/tmp/r_song.json');console.log(encodeURIComponent((j.result||[])[0]?.name||''))")
A=$(node -e "const j=require('/tmp/r_song.json');console.log(encodeURIComponent((j.result||[])[0]?.artist||''))")
echo "测试曲: id=$ID vendor=$V"
fetch "/api/song?id=$ID&vendor=$V&name=$N&artist=$A&quality=standard" /tmp/r_songres.json >/dev/null
node -e "const j=require('/tmp/r_songres.json');const d=j.data||{};console.log('url:',(d.url||'EMPTY').slice(0,100));console.log('resolveTimeout:',!!d.resolveTimeout,'trial:',!!d.trial)" 2>/dev/null || echo "BAD: $(head -c 200 /tmp/r_songres.json)"

echo; echo "=== 6. 解析 QQ 音源对照（同关键词搜 tencent 再解析）==="
fetch "/api/search?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=song&page=1&limit=5&vendor=tencent" /tmp/r_tencent.json >/dev/null
TID=$(node -e "const j=require('/tmp/r_tencent.json');console.log((j.result||[])[0]?.id||'')" 2>/dev/null)
echo "tencent 曲 id=$TID"
if [ -n "$TID" ] && [ "$TID" != "" ]; then
  fetch "/api/song?id=$TID&vendor=tencent&name=$N&artist=$A&quality=standard" /tmp/r_tres.json >/dev/null
  node -e "const j=require('/tmp/r_tres.json');const d=j.data||{};console.log('tencent url:',(d.url||'EMPTY').slice(0,100))" 2>/dev/null || echo "BAD: $(head -c 200 /tmp/r_tres.json)"
fi
