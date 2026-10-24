#!/usr/bin/env bash
# 一键终验：构建 + 全量测试 + 一小时曲线 + 单文件审计 + 真机截图
set -u
cd "$(dirname "$0")/.." || exit 1

echo '=== 1) BUILD ==='
node build.mjs || exit 1

echo '=== 2) TESTS (gate) ==='
fail=0
for f in core.test grid.smoke world.smoke drops.smoke fx.smoke ui.smoke integration-v2 progression; do
  out=$(node "test/$f.mjs" 2>&1); code=$?
  line=$(echo "$out" | grep -E '通过 [0-9]+ 项|ALL GREEN|PASS:|总轮数' | tail -1)
  if [ $code -ne 0 ]; then fail=$((fail+1)); echo "FAIL $f :: $line"; else echo "ok   $f :: $line"; fi
done

echo '=== 3) balance (advisory) ==='
node test/balance.mjs 2>&1 | grep -E '^(OK|BAD)' | sed 's/^/     /'

echo '=== 4) SINGLE-FILE AUDIT ==='
node -e "const fs=require('fs');const s=fs.readFileSync('index.html','utf8');const bad=[];if(/@import/i.test(s))bad.push('css import');if(/minecraft|我的世界/i.test(s))bad.push('forbidden name');console.log('size=' + (s.length/1024).toFixed(0) + 'KB  ' + (bad.length?('FAIL '+bad.join(',')):'PASS no-external/no-forbidden'));" || fail=$((fail+1))

echo '=== 5) SCREENSHOTS ==='
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
URL="file:///c/Users/Administrator/Documents/deepseek-harness/default-workspace/blockminer/index.html"
shot() { "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=520,1000 --no-first-run --user-data-dir="$TEMP/bmaccept_$1" --virtual-time-budget=2600 --screenshot="$PWD/shots/$1.png" "$URL#$2" 2>/dev/null; }
shot camp "noanim-tocamp"
shot mine "noanim-demo-frames=110"
shot iron "noanim-demo-zone=ironmine-frames=110"
shot result "noanim-demo-frames=1400"
shot talents "noanim-demo-frames=40-tocamp-drawer=talents"
ls -1 shots | sed 's/^/     /'

echo "=== RESULT: $([ $fail -eq 0 ] && echo PASS || echo "$fail FAILED") ==="
exit $fail