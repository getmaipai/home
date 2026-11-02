#!/bin/bash
# Captures the mockup states with headless Chrome (needs macOS sips). Phone shots render inside a 390 px frame, because headless Chrome will not make a window narrower than about 500 px.
D="$(cd "$(dirname "$0")" && pwd)"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="${TMPDIR:-/tmp}/vsd-frame.html"
run(){ "$CH" --headless=new --disable-gpu --hide-scrollbars --autoplay-policy=no-user-gesture-required --allow-file-access-from-files --window-size=$2,$3 --virtual-time-budget=6000 --screenshot="$1" "$4" >/dev/null 2>&1; }
desk(){ run "$D/$1.png" 1440 900 "file://$D/index.html?$2"; }
phone(){
  printf '<body style="margin:0;background:#888"><iframe src="file://%s/index.html?%s&phone=1" style="border:0;width:390px;height:844px;display:block;margin:0 auto"></iframe></body>' "$D" "$2" > "$TMP"
  run "$D/$1.png" 600 844 "file://$TMP"
  sips --cropToHeightWidth 844 390 "$D/$1.png" >/dev/null
}
for t in light dark; do
  desk studio-1440-$t "theme=$t&page=studio"
  desk studio-video-1440-$t "theme=$t&page=studio&sel=video"
  desk create-1440-$t "theme=$t&page=create"
  phone studio-390-$t "theme=$t&page=studio"
  phone create-390-$t "theme=$t&page=create"
done
for f in "$D"/*.png; do sips -s format jpeg -s formatOptions 82 "$f" --out "${f%.png}.jpg" >/dev/null; rm -f "$f"; done
