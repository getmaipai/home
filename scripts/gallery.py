#!/usr/bin/env python3
"""Build the screenshot gallery page. Called by scripts/gallery.sh.

Usage: gallery.py <gallery-dir> <label>
Reads <gallery-dir>/files (the collected folders) and writes <gallery-dir>/index.html.
"""
import json
import os
import sys

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")

TEMPLATE = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Screenshot gallery</title>
<style>
:root{color-scheme:dark light}body{margin:0;font:15px system-ui;background:#0e0f12;color:#e8e8ea}
header{position:sticky;top:0;background:#14161a;padding:12px 16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;z-index:2;border-bottom:1px solid #2a2d33}
input,select{background:#1d2026;color:inherit;border:1px solid #333;border-radius:8px;padding:8px 10px;font:inherit}
main{padding:16px}h2{margin:28px 0 10px;font-size:15px;color:#9aa}.pages a{display:inline-block;margin:0 8px 8px 0;padding:8px 12px;background:#2b3a67;color:#fff;border-radius:8px;text-decoration:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--w,220px),1fr));gap:12px}
figure{margin:0;background:#171a1f;border-radius:10px;overflow:hidden;cursor:zoom-in}
img{width:100%;display:block;aspect-ratio:var(--r,auto);object-fit:cover;object-position:top}
figcaption{padding:6px 8px;font-size:11px;color:#9aa;word-break:break-all}
.src{color:#9aa;font-size:12px}
#lb{position:fixed;inset:0;background:#000e;display:none;align-items:center;justify-content:center;z-index:9}
#lb img{max-width:96vw;max-height:92vh;width:auto;object-fit:contain}#lb p{position:fixed;bottom:8px;left:0;right:0;text-align:center;color:#ccc;font-size:12px}
</style>
<header><b>Screenshots</b><input id=q placeholder="Filter by name or folder" size=28>
<select id=sz><option value=160>Small</option><option value=220 selected>Medium</option><option value=360>Large</option></select>
<span id=n></span><span class=src id=src></span></header>
<main><div class=pages id=pages></div><div id=g></div></main>
<div id=lb><img id=li><p id=lc></p></div>
<script>
const D=__DATA__;let cur=[],ix=0;
const U=p=>'files/'+p.split('/').map(encodeURIComponent).join('/');
document.getElementById('src').textContent=D.label;
const pg=document.getElementById('pages');
if(D.pages.length){pg.innerHTML='<h2>Interactive mockups</h2>'+D.pages.map(p=>`<a target=_blank href="${U(p)}">${p.split('/').slice(-2).join('/')}</a>`).join('')}
function draw(){const q=document.getElementById('q').value.toLowerCase();document.documentElement.style.setProperty('--w',document.getElementById('sz').value+'px');
let t=0;cur=[];const g=document.getElementById('g');g.innerHTML='';
for(const grp of D.groups){const fs=grp.files.filter(f=>f.toLowerCase().includes(q));if(!fs.length)continue;t+=fs.length;
const h=document.createElement('h2');h.textContent=grp.name+' ('+fs.length+')';g.append(h);
const d=document.createElement('div');d.className='grid';
for(const f of fs){const i=cur.push(f)-1;const e=document.createElement('figure');e.innerHTML=`<img loading=lazy src="${U(f)}"><figcaption>${f.split('/').pop()}</figcaption>`;e.onclick=()=>open_(i);d.append(e)}
g.append(d)}document.getElementById('n').textContent=t+' images'}
function open_(i){ix=(i+cur.length)%cur.length;document.getElementById('li').src=U(cur[ix]);document.getElementById('lc').textContent=cur[ix]+'  ('+(ix+1)+'/'+cur.length+')';document.getElementById('lb').style.display='flex'}
document.getElementById('lb').onclick=()=>document.getElementById('lb').style.display='none';
document.addEventListener('keydown',e=>{if(document.getElementById('lb').style.display!=='flex')return;if(e.key==='ArrowRight')open_(ix+1);if(e.key==='ArrowLeft')open_(ix-1);if(e.key==='Escape')document.getElementById('lb').style.display='none'});
document.getElementById('q').oninput=draw;document.getElementById('sz').onchange=draw;draw();
</script>"""


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("usage: gallery.py <gallery-dir> <label>")
    root, label = sys.argv[1], sys.argv[2]
    files = os.path.join(root, "files")
    imgs, pages = {}, []
    for d, _, fs in os.walk(files):
        for f in sorted(fs):
            p = os.path.relpath(os.path.join(d, f), files)
            low = f.lower()
            if low.endswith(IMAGE_EXT):
                imgs.setdefault(os.path.dirname(p), []).append(p)
            elif low.endswith(".html") and p.startswith("docs/design/assets/"):
                pages.append(p)
    data = {
        "label": label,
        "groups": [{"name": k, "files": sorted(v)} for k, v in sorted(imgs.items())],
        "pages": sorted(pages),
    }
    # "</" inside the JSON must not end the script block.
    blob = json.dumps(data).replace("</", "<\\/")
    with open(os.path.join(root, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(TEMPLATE.replace("__DATA__", blob))
    print(sum(len(g["files"]) for g in data["groups"]), "images,", len(pages), "mockup pages")


if __name__ == "__main__":
    main()
