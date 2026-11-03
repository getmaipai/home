#!/bin/bash
# Captures the mockup states with headless Chrome (needs macOS sips). Phone shots render inside a 390 px frame, because headless Chrome will not make a window narrower than about 500 px.
D="$(cd "$(dirname "$0")" && pwd)"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="${TMPDIR:-/tmp}/sm-frame.html"
run(){ "$CH" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --window-size=$2,$3 --virtual-time-budget=4000 --screenshot="$1" "$4" >/dev/null 2>&1; }
desk(){ run "$D/$1.png" 1440 900 "file://$D/index.html?$2"; }
phone(){
  printf '<body style="margin:0;background:#888"><iframe src="file://%s/index.html?%s&phone=1" style="border:0;width:390px;height:844px;display:block;margin:0 auto"></iframe></body>' "$D" "$2" > "$TMP"
  run "$D/$1.png" 600 844 "file://$TMP"
  sips --cropToHeightWidth 844 390 "$D/$1.png" >/dev/null
}
for t in light dark; do
  for s in pictures videos music styles unlock styles-open browse confirm detail; do desk $s-1440-$t "theme=$t&state=$s"; done
  for s in videos styles browse detail unlock; do phone $s-390-$t "theme=$t&state=$s"; done
done
for f in "$D"/*.png; do sips -s format jpeg -s formatOptions 82 "$f" --out "${f%.png}.jpg" >/dev/null; rm -f "$f"; done
