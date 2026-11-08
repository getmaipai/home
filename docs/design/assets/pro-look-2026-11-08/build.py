import json, base64, urllib.parse, random
ICONS=json.load(open('icons.json'))
def ic(n,s=24,w=1.75,fill='none',extra=''):
    inner=''.join(f'<{t} '+' '.join(f'{k}="{v}"' for k,v in a.items())+'/>' for t,a in ICONS[n])
    return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="{fill}" stroke="currentColor" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" {extra}>{inner}</svg>'
PAL={ # hue pairs for artwork: (base1, base2, blob1, blob2, blob3)
 'teal':('#0b3d4a','#0f6b7a','#3fe0cb','#1f6fff','#a6fff0'),
 'ember':('#5a1408','#b8321c','#ffd04a','#ff5a2a','#ffb36b'),
 'violet':('#1d1160','#4a24b8','#b48cff','#ff4fa8','#6a5cff'),
 'forest':('#0a2b1a','#1c6a3a','#7be37b','#18a0a0','#d8ff9a'),
 'rose':('#4a0f2a','#c2406a','#ff9db0','#ffb547','#ffd6c4'),
 'ocean':('#0a1840','#1d3a8a','#6fc3ff','#6a5cff','#bfe8ff'),
 'sand':('#3a2a10','#b98a3e','#ffe2a0','#ff9a5a','#fff3d0'),
 'slate':('#0e1624','#2a3a55','#6a86b8','#a07cff','#c9d6ee'),
}
def art(key,seed=1,size=400,shape=None):
    rnd=random.Random(seed*97+len(key)); a,b,c,d,e=PAL[key]
    x=lambda:rnd.randint(10,90)
    blobs=f'<circle cx="{x()}%" cy="{x()}%" r="{rnd.randint(35,55)}%" fill="{c}" opacity=".85"/><circle cx="{x()}%" cy="{x()}%" r="{rnd.randint(30,50)}%" fill="{d}" opacity=".8"/><circle cx="{x()}%" cy="{x()}%" r="{rnd.randint(18,30)}%" fill="{e}" opacity=".55"/>'
    sh=''
    if shape=='sun': sh=f'<circle cx="62%" cy="38%" r="17%" fill="{e}" opacity=".9"/><rect x="0" y="62%" width="100%" height="38%" fill="{a}" opacity=".55"/>'
    if shape=='rings': sh=''.join(f'<circle cx="50%" cy="50%" r="{r}%" fill="none" stroke="{e}" stroke-opacity=".5" stroke-width=".6%"/>' for r in (14,24,34))
    if shape=='wave': sh=f'<path d="M0 70 Q 25 55 50 70 T 100 66 V100 H0Z" transform="scale({size/100*1})" fill="{a}" opacity=".6"/>'
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient><filter id="bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0"/></filter></defs><rect width="100%" height="100%" fill="url(#g)"/><g filter="url(#bl)" transform="scale({size/100})" >{blobs.replace('%','').replace('cx="','cx="').replace('cy="','cy="')}</g><g transform="scale({size/100})">{sh.replace('%','')}</g><rect width="100%" height="100%" filter="url(#n)" opacity=".18"/></svg>'''
    return "url('data:image/svg+xml;utf8,"+urllib.parse.quote(svg)+"')"
def A(key,seed=1,shape=None,extra=''):
    return f'background-image:{art(key,seed,shape=shape)};background-size:cover;background-position:center;{extra}'
CSS='''
:root{--s0:#07090f;--s1:#10151f;--s2:#1a212e;--s3:#232c3b;--glass:rgba(28,36,52,.62);--fg:#fff;--fg2:rgba(235,240,255,.62);--fg3:rgba(235,240,255,.38);--hair:rgba(255,255,255,.08);--inv:#f5f2ec;--on-inv:#0c1118;--accent:#2fd4c0;--create:#d7ff4a}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:var(--fg);background:#000;letter-spacing:-.011em}
svg{display:block;flex:none}
.stage{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(900px 700px at 30% 20%,#1b2740,#05070c 70%)}
.phone{width:402px;height:874px;border-radius:56px;background:var(--s0);position:relative;overflow:hidden;box-shadow:0 0 0 10px #0c0e13,0 0 0 11.5px #2a2f3a,0 40px 90px #000b}
.status{position:absolute;top:0;left:0;right:0;height:54px;display:flex;justify-content:space-between;align-items:center;padding:6px 34px 0 42px;font-weight:600;font-size:16px;z-index:100}
.island{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:120px;height:35px;border-radius:20px;background:#000;z-index:110}
.homebar{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:140px;height:5px;border-radius:3px;background:#fff;opacity:.85;z-index:70}
.scroll{position:absolute;inset:0;padding:60px 16px 150px}
h1.t{font-size:34px;font-weight:700;letter-spacing:-.025em;line-height:1.1}
.sh{display:flex;justify-content:space-between;align-items:baseline;margin:30px 0 12px}.sh h2{font-size:22px;font-weight:700;letter-spacing:-.02em}.sh a{font-size:15px;color:var(--fg2);display:flex;align-items:center;gap:2px}
.glass{background:var(--glass);backdrop-filter:blur(28px) saturate(1.6);-webkit-backdrop-filter:blur(28px) saturate(1.6);box-shadow:inset 0 0 0 1px var(--hair),inset 0 1px 0 rgba(255,255,255,.12),0 10px 30px rgba(0,0,0,.45)}
.circ{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.pill{height:44px;padding:0 20px;border-radius:999px;display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:16px;white-space:nowrap}
.pill.inv{background:var(--inv);color:var(--on-inv)}.pill.q{background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)}
.chip{height:38px;padding:0 16px;border-radius:999px;background:var(--s1);box-shadow:inset 0 0 0 1px var(--hair);display:inline-flex;align-items:center;gap:7px;font-size:15px;font-weight:500;color:var(--fg2);flex:none}.chip.on{background:var(--inv);color:var(--on-inv);box-shadow:none;font-weight:600}
.strip{display:flex;gap:12px;margin-right:-16px;overflow:hidden}
.tile{border-radius:22px;position:relative;overflow:hidden;flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.10),0 12px 28px rgba(0,0,0,.35)}
.tile{--fg:#fff;--fg2:rgba(235,240,255,.72);--fg3:rgba(235,240,255,.45);color:#fff}
.tile .lab{z-index:2;position:absolute;left:14px;bottom:12px;right:12px;font-size:21px;font-weight:700;letter-spacing:-.02em;text-shadow:0 1px 12px rgba(0,0,0,.35)}
.tile .sub{font-size:13px;font-weight:500;opacity:.8;display:block;margin-top:1px;letter-spacing:0}
.tile::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(0,0,0,.35));pointer-events:none}
.row{display:flex;gap:14px;align-items:center;height:76px}
.row .th{width:64px;height:64px;border-radius:12px;position:relative;flex:none;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.10)}
.badge{position:absolute;left:5px;bottom:5px;font:600 11px/1 ui-monospace,"SF Mono",Menlo,monospace;background:rgba(0,0,0,.55);backdrop-filter:blur(8px);padding:3px 5px;border-radius:6px}
.row b{display:block;font-size:17px;font-weight:600;letter-spacing:-.015em}.row span.m{color:var(--fg2);font-size:14px;display:flex;align-items:center;gap:5px;margin-top:2px}
.row .more{margin-left:auto;color:var(--fg2)}
.fade{position:absolute;left:0;right:0;bottom:0;height:190px;background:linear-gradient(180deg,transparent,var(--s0) 62%);z-index:30;pointer-events:none}
.tabbar{position:absolute;left:14px;right:14px;bottom:26px;height:68px;border-radius:999px;display:flex;align-items:center;padding:0 6px;z-index:40}
.tabbar .it{flex:1;height:56px;border-radius:999px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:11px;font-weight:600;color:var(--fg2)}
.tabbar .it.on{background:rgba(255,255,255,.14);color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
.mini{position:absolute;left:14px;right:14px;bottom:104px;height:60px;border-radius:20px;display:flex;align-items:center;gap:12px;padding:0 14px 0 8px;z-index:40}
.mini .th{width:44px;height:44px;border-radius:10px;overflow:hidden}
.mini .bar{position:absolute;left:18px;right:18px;bottom:3px;height:2px;border-radius:2px;background:rgba(255,255,255,.18)}.mini .bar i{display:block;width:38%;height:100%;border-radius:2px;background:#fff}
.av{border-radius:50%;position:relative;flex:none;overflow:hidden}
.av.ring{box-shadow:0 0 0 2px var(--s0),0 0 0 4px rgba(47,212,192,.9),0 0 14px rgba(47,212,192,.45)}
.phone .scard{display:grid!important;grid-template-columns:56px 1fr;gap:10px 14px!important;align-items:start!important}.phone .scard>span{grid-column:2;justify-self:start}.tag{position:fixed;bottom:10px;right:14px;font:600 10px ui-monospace,Menlo,monospace;color:rgba(255,255,255,.35);z-index:99}
'''
def companion(size=36,ring=True,seed=0):
    cols=[('#ffd9a0','#ff9a3c'),('#bfe8ff','#6a86ff')][seed%2]
    return f'''<div class="av {'ring' if ring else ''}" style="width:{size}px;height:{size}px;background:radial-gradient(circle at 35% 28%,{cols[0]},{cols[1]} 70%)"><svg viewBox="0 0 36 36" width="{size}" height="{size}"><ellipse cx="13" cy="16" rx="2.1" ry="2.8" fill="#2a1608"/><ellipse cx="23" cy="16" rx="2.1" ry="2.8" fill="#2a1608"/><path d="M12.5 23 Q18 27.5 23.5 23" stroke="#2a1608" stroke-width="1.8" fill="none" stroke-linecap="round"/><ellipse cx="9.5" cy="21" rx="2.4" ry="1.5" fill="#ff5f7e" opacity=".35"/><ellipse cx="26.5" cy="21" rx="2.4" ry="1.5" fill="#ff5f7e" opacity=".35"/></svg></div>'''
def statusbar():
    return f'''<div class="status"><span>9:41</span><span style="display:flex;gap:6px;align-items:center"><svg width="18" height="12" viewBox="0 0 18 12" fill="#fff"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M1.5 4.2a10 10 0 0 1 14 0"/><path d="M4 7a6.5 6.5 0 0 1 9 0"/><circle cx="8.5" cy="10" r=".9" fill="#fff"/></svg><svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".5" y=".5" width="22" height="12" rx="3.8" stroke="#fff" opacity=".4"/><rect x="2" y="2" width="19" height="9" rx="2.5" fill="#fff"/><rect x="24" y="4.5" width="2" height="4" rx="1" fill="#fff" opacity=".45"/></svg></span></div><div class="island"></div>'''
def tabbar(active,items=(('house','Home'),('message-circle','Chat'),('play','Media'),('library','Library'),('search','Search'))):
    return '<div class="tabbar glass">'+''.join(f'<div class="it {"on" if l==active else ""}">{ic(i,26,1.8)}<span>{l}</span></div>' for i,l in items)+'</div>'
def mini(title='Porch Lights',who='Clover Tempo',key='violet',seed=3):
    return f'<div class="mini glass"><div class="th" style="{A(key,seed)}"></div><div style="flex:1"><b style="font-size:15px;font-weight:600">{title}</b><div style="font-size:13px;color:var(--fg2)">{who}</div></div>{ic("pause",24,1.8,"currentColor")}{ic("skip-forward",24,1.8,"currentColor",)}<div class="bar"><i></i></div></div>'
def phone(body,tag='HTML MOCKUP v2',extra=''):
    return f'<style>{CSS}</style><div class="stage"><div class="tag">{tag}</div><div class="phone">{statusbar()}{body}<div class="fade"></div><div class="homebar"></div></div></div>'
def row(title,meta,key,seed,dur,plays=None,shape=None):
    pl=f'{ic("play",11,2,"currentColor")}{plays} · ' if plays else ''
    return f'<div class="row"><div class="th" style="{A(key,seed,shape)}"><div class="badge">{dur}</div></div><div><b>{title}</b><span class="m">{pl}{meta}</span></div><div class="more">{ic("ellipsis",24,2)}</div></div>'
def tile(label,sub,key,seed,w=156,h=156,shape=None):
    return f'<div class="tile" style="width:{w}px;height:{h}px;{A(key,seed,shape)}"><div class="lab">{label}{f"<span class=sub>{sub}</span>" if sub else ""}</div></div>'
def write(name,html): open(name+'.html','w').write('<meta charset="utf-8">'+html)
def chips(items,on=0):
    return '<div class="strip" style="margin-top:14px">'+''.join(f'<span class="chip {"on" if i==on else ""}">{t}</span>' for i,t in enumerate(items))+'</div>'

# ---------- PHONE HOME
weather=f'''<div class="tile" style="height:150px;background:linear-gradient(165deg,#1f3558,#0b1424 85%);padding:18px;color:#fff"><svg style="position:absolute;inset:0" width="100%" height="100%">{"".join(f'<line x1="{x}" y1="{y}" x2="{x-6}" y2="{y+22}" stroke="#bcd3ff" stroke-opacity=".28" stroke-width="1.3"/>' for x,y in [(40,12),(95,70),(150,20),(210,90),(270,30),(330,100),(70,120),(180,140),(300,150),(120,50),(240,10)])}</svg><div style="position:relative;font-size:12px;letter-spacing:.14em;font-weight:600;color:var(--fg2)">SEATTLE</div><div style="position:relative;display:flex;align-items:flex-end;justify-content:space-between;margin-top:14px"><div style="font-size:64px;font-weight:200;letter-spacing:-.04em;line-height:1">52°</div><div style="text-align:right;font-size:14px;color:var(--fg2);line-height:1.5"><div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;color:#fff;font-weight:600">{ic("cloud-rain",18,1.8)}Rainy</div>H 56° L 43°<br>Take a jacket</div></div></div>'''
body=f'''<div class="scroll"><div style="display:flex;justify-content:space-between;align-items:center;height:44px;margin-bottom:10px"><div class="circ glass" style="width:44px;height:44px">{ic("panel-left",22,1.8)}</div><div style="font-weight:600;font-size:17px;color:var(--fg2)">Home</div>{companion(36)}</div>
<h1 class="t" style="margin-top:6px">Good evening, Sage</h1>
<div class="glass" style="margin-top:16px;height:54px;border-radius:999px;display:flex;align-items:center;padding:0 8px 0 18px;gap:10px;color:var(--fg3);font-size:17px">{ic("sparkles",20,1.8)}<span style="flex:1">Ask anything</span><span class="pill inv" style="height:38px;padding:0 16px;font-size:15px">{ic("arrow-up",18,2.4)}</span></div>
{chips(["For you","Music","News","Photos","Videos"])}
<div class="sh"><h2>Today</h2><a>See All {ic("chevron-right",16,2)}</a></div>{weather}
<div class="sh"><h2>Made for you</h2><a>See All {ic("chevron-right",16,2)}</a></div>
<div class="strip">{tile("Daily Mix","Clover Tempo and more","teal",1)}{tile("Focus","Slow and steady","ember",2,shape="sun")}{tile("Family","Songs you all play","violet",3)}</div>
<div class="sh"><h2>New in your library</h2><a>See All {ic("chevron-right",16,2)}</a></div>
{row("Porch Lights","Clover Tempo","forest",4,"2:46","32")}{row("Slow Morning","Indigo Rivet","rose",5,"3:15","16",shape="sun")}</div>
{tabbar("Home")}'''
write('phone-home',phone(body))

# ---------- PHONE DETAIL
hero=f'<div style="position:absolute;inset:0 0 auto 0;height:560px;{A("violet",11,shape="rings")}"></div><div style="position:absolute;inset:0 0 auto 0;height:560px;background:linear-gradient(180deg,rgba(7,9,15,.0) 35%,rgba(7,9,15,.7) 78%,var(--s0))"></div>'
songs=''.join(row(t,m,k,s,d,p) for t,m,k,s,d,p in [("Slow Morning","Indigo Rivet","teal",21,"2:46","214"),("Porch Lights","Clover Tempo","ember",22,"3:15","132"),("Kitchen Dance","Velvet Atlas","forest",23,"3:32","96"),("Window Seat","Indigo Rivet","ocean",24,"2:58","71")])
body=f'''{hero}<div style="position:absolute;top:60px;left:16px;right:16px;display:flex;justify-content:space-between;align-items:center;z-index:5"><div class="circ glass">{ic("chevron-left",26,2.2)}</div><div style="display:flex;gap:10px;align-items:center"><div class="circ glass">{ic("share",20,1.9)}</div><div class="circ glass">{ic("ellipsis",22,2)}</div>{companion(36)}</div></div>
<div style="position:absolute;top:318px;left:16px;right:16px;z-index:5"><div style="font-size:13px;font-weight:600;letter-spacing:.12em;color:rgba(255,255,255,.75)">ALBUM · 2026</div><h1 style="font-size:42px;font-weight:800;letter-spacing:-.03em;margin:6px 0 4px">Slow Morning</h1><div style="color:var(--fg2);font-size:16px">Indigo Rivet · 12 songs · 41 min</div>
<div style="display:flex;gap:12px;margin-top:20px;align-items:center"><div class="pill inv" style="flex:1;justify-content:center;height:54px;font-size:18px">{ic("play",20,2,"currentColor")} Play</div><div class="circ glass" style="width:54px;height:54px">{ic("shuffle",22,1.9)}</div><div class="circ glass" style="width:54px;height:54px">{ic("heart",22,1.9)}</div></div>
<div style="margin-top:14px">{songs}</div></div>{mini("Slow Morning","Indigo Rivet","teal",21)}{tabbar("Media")}'''
write('phone-detail',phone(body))

# ---------- PHONE LIBRARY
lib=''.join(row(t,m,k,s,d,None,sh) for t,m,k,s,d,sh in [("Porch Lights","warm, acoustic, mellow","forest",31,"2:19",None),("Slow Morning","ambient, piano, soft","rose",32,"3:20","sun"),("Rain on the Roof","slow tempo, folk","ocean",33,"2:34",None),("Kitchen Dance","upbeat, swing, bright","ember",34,"2:57","wave"),("Back Porch Blues","blues, guitar, raw","sand",35,"2:40",None),("Fireflies","dreamy, synth, night","violet",36,"3:04","rings")])
body=f'''<div class="scroll"><div style="display:flex;justify-content:space-between;align-items:center;height:44px"><div class="circ glass">{ic("panel-left",22,1.8)}</div><div style="display:flex;gap:10px;align-items:center"><div class="circ glass">{ic("search",20,1.9)}</div><div class="circ glass">{ic("plus",22,2)}</div>{companion(36)}</div></div>
<h1 class="t" style="margin-top:14px">Library</h1>
<div class="strip" style="margin-top:16px">{tile("Pictures","248 items","teal",41,156,120)}{tile("Videos","36 clips","violet",42,156,120)}{tile("Songs","112 songs","ember",43,156,120,"sun")}</div>
{chips(["All","Mine","Shared with me","Only me"])}
<div class="sh" style="margin-top:22px"><h2>My Songs</h2><a>Filter {ic("sliders-horizontal",16,2)}</a></div>{lib}</div>{tabbar("Library")}'''
write('phone-library',phone(body))


DCSS=CSS+"""
body{width:1440px;height:900px;overflow:hidden;background:var(--s0)}
.win{width:1440px;height:900px;position:relative;background:var(--s0);overflow:hidden}
.rail{position:absolute;left:0;top:0;bottom:0;width:56px;display:flex;flex-direction:column;align-items:center;padding:16px 0 14px;gap:4px}
.rail .logo{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#2fd4c0,#4aa3ff);display:flex;align-items:center;justify-content:center;margin-bottom:14px;box-shadow:0 6px 18px rgba(47,212,192,.35)}
.rail .it{width:44px;height:44px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;font-size:11px;font-weight:600;color:var(--fg2)}.rail .it span{display:none}
.rail .it.on{background:var(--s2);color:#fff;box-shadow:inset 0 0 0 1px var(--hair)}
.col{position:absolute;top:0;bottom:0;width:236px;padding:20px 12px}
.col h4{font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--fg3);margin:20px 12px 8px}
.col .li{height:42px;border-radius:12px;display:flex;align-items:center;gap:12px;padding:0 12px;font-size:15px;font-weight:500;color:var(--fg2)}
.col .li.on{background:var(--s2);color:#fff;font-weight:600;box-shadow:inset 0 0 0 1px var(--hair)}
.panel{position:absolute;top:8px;right:8px;bottom:8px;background:var(--s1);border-radius:26px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--hair)}
.hdr{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;position:relative;z-index:5}
.hdr .ttl{font-size:17px;font-weight:600}
.hdr .btns{display:flex;gap:10px;align-items:center}
.glow{position:absolute;inset:0 0 auto 0;height:380px;background:radial-gradient(600px 260px at 18% 0%,rgba(47,212,192,.16),transparent 70%),radial-gradient(500px 240px at 85% 0%,rgba(122,107,255,.14),transparent 70%);pointer-events:none}
.card{background:var(--s2);border-radius:22px;box-shadow:inset 0 0 0 1px var(--hair)}
.dt .tile{box-shadow:inset 0 0 0 1px rgba(255,255,255,.10),0 14px 30px rgba(0,0,0,.35)}
.ask{height:56px;border-radius:999px;display:flex;align-items:center;gap:12px;padding:0 8px 0 20px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair);color:var(--fg3);font-size:17px}
.arrowbtn{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;position:absolute;top:14px;right:14px;z-index:3}
.dtag{position:fixed;bottom:8px;right:12px;font:600 10px ui-monospace,Menlo,monospace;color:rgba(255,255,255,.3);z-index:99}
"""
def rail(active):
    its=[('search','Search'),('house','Home'),('message-circle','Chat'),('play','Media'),('library','Library'),('users','Family')]
    return '<div class="rail"><div class="logo">'+ic('sparkles',22,2)+'</div>'+''.join(f'<div class="it {"on" if l==active else ""}">{ic(i,24,1.8)}<span>{l}</span></div>' for i,l in its)+f'<div style="margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:4px" class="it" ><div class="av" style="width:34px;height:34px;background:linear-gradient(135deg,#7a6bff,#4aa3ff);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">S</div></div></div>'
def col(title,items,active,left=56):
    out=f'<div class="col" style="left:{left}px"><h4 style="margin-top:6px">{title}</h4>'
    for i,l in items:
        out+=f'<div class="li {"on" if l==active else ""}">{ic(i,20,1.8)}{l}</div>'
    return out+'</div>'
def win(inner,tag='HTML MOCKUP v2'):
    return f'<style>{DCSS}</style><div class="win dt"><div class="dtag">{tag}</div>{inner}</div>'

# desktop home
hh=''.join(f'<div style="text-align:center;font-size:13px;font-weight:600"><div class="av" style="width:58px;height:58px;background:{g}"></div><div style="margin-top:7px">{n}</div></div>' for n,g in [("Sage","linear-gradient(135deg,#ffb547,#ff5f7e)"),("Marlow","linear-gradient(135deg,#2fd4c0,#4aa3ff)"),("Nova","linear-gradient(135deg,#b48cff,#ff4fa8)"),("Tessa","radial-gradient(circle at 35% 28%,#ffd9a0,#ff9a3c 70%)")])
wthr=f'''<div class="tile" style="width:392px;height:190px;background:linear-gradient(165deg,#1f3558,#0b1424 85%);padding:20px;color:#fff"><svg style="position:absolute;inset:0" width="100%" height="100%">{"".join(f'<line x1="{x}" y1="{y}" x2="{x-6}" y2="{y+24}" stroke="#bcd3ff" stroke-opacity=".28" stroke-width="1.3"/>' for x,y in [(50,14),(120,80),(190,24),(250,100),(330,36),(90,130),(210,150),(340,140),(150,60)])}</svg><div class="arrowbtn">{ic("arrow-up-right",18,2)}</div><div style="position:relative;font-size:12px;letter-spacing:.14em;font-weight:600;color:var(--fg2)">SEATTLE</div><div style="position:relative;display:flex;justify-content:space-between;align-items:flex-end;margin-top:30px"><div style="font-size:76px;font-weight:200;letter-spacing:-.04em;line-height:1">52°</div><div style="text-align:right;font-size:14px;color:var(--fg2);line-height:1.5"><div style="display:flex;gap:6px;justify-content:flex-end;color:#fff;font-weight:600;align-items:center">{ic("cloud-rain",18,1.8)}Rainy</div>H 56° L 43°</div></div></div>'''
def sh2(t,a="See All"): return f'<div class="sh" style="margin:30px 0 14px"><h2>{t}</h2><a>{a} {ic("chevron-right",16,2)}</a></div>'
inner=f'''{rail("Home")}{col("HOME",[("house","Today"),("sparkles","For you"),("clock","Reminders"),("sun","Weather")],"Today")}<div class="panel" style="left:304px"><div class="glow"></div><div class="hdr"><div class="ttl">Home</div><div class="btns"><div class="circ glass" style="width:40px;height:40px">{ic("search",19,1.9)}</div><div class="circ glass" style="width:40px;height:40px">{ic("bell",19,1.9)}</div>{companion(38)}</div></div>
<div style="padding:0 36px;position:relative"><h1 style="font-size:44px;font-weight:700;letter-spacing:-.03em">Good evening, Sage</h1><div style="color:var(--fg2);font-size:17px;margin-top:4px">Here is your household today.</div>
<div style="display:flex;gap:12px;margin-top:20px;align-items:center"><div class="ask" style="width:560px">{ic("sparkles",20,1.8)}<span style="flex:1">Ask anything</span><span class="pill inv" style="height:40px;padding:0 18px;font-size:15px">Ask</span></div><span class="chip">Plan a week of dinners</span><span class="chip">Explain how rainbows form</span></div>
<div style="display:flex;gap:44px;align-items:flex-start"><div>{sh2("Household","Manage")}<div style="display:flex;gap:22px">{hh}<div style="text-align:center;font-size:13px;font-weight:600;color:var(--fg2)"><div class="av" style="width:58px;height:58px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair);border-style:dashed;display:flex;align-items:center;justify-content:center">{ic("plus",22,2)}</div><div style="margin-top:7px">Add</div></div></div></div>
<div>{sh2("Today")}<div class="strip" style="margin-right:0;gap:14px">{wthr}{tile("Family list","3 things to buy","violet",53,176,190)}{tile("Coming up","Soccer, 4:30","ember",54,176,190,"sun")}</div></div></div>
{sh2("New in your library")}<div class="strip" style="margin-right:-36px;gap:14px">{tile("Sunday Drive","Clover Tempo","teal",61,184,184)}{tile("Back Porch Blues","Clover Tempo","rose",62,184,184,"sun")}{tile("Fireflies","Indigo Rivet","ocean",63,184,184,"rings")}{tile("Night Shift","Velvet Atlas","violet",64,184,184)}{tile("Kitchen Dance","Velvet Atlas","forest",65,184,184,"wave")}{tile("Window Seat","Indigo Rivet","sand",66,184,184)}</div></div></div>'''
write('desktop-home',win(inner))

# desktop detail
trk=''
data=[("Slow Morning","Indigo Rivet","teal",21,"2:46","214",False),("Porch Lights","Clover Tempo","ember",22,"3:15","132",True),("Kitchen Dance","Velvet Atlas","forest",23,"3:32","96",False),("Window Seat","Indigo Rivet","ocean",24,"2:58","71",False),("Back Porch Blues","Clover Tempo","sand",25,"3:40","64",False),("Fireflies","Indigo Rivet","violet",26,"3:04","58",False)]
for i,(t,m,k,sd,d,p,now) in enumerate(data):
    bg='background:var(--s2);' if now else ''
    num=f'<div style="width:26px;color:var(--accent)">{ic("music-2",18,2)}</div>' if now else f'<div style="width:26px;color:var(--fg3);font-size:15px">{i+1}</div>'
    trk+=f'<div style="display:flex;align-items:center;gap:14px;height:62px;border-radius:14px;padding:0 14px;margin:0 -14px;{bg}">{num}<div style="width:44px;height:44px;border-radius:9px;{A(k,sd)}"></div><div style="width:360px"><b style="font-size:16px;font-weight:600;{"color:var(--accent)" if now else ""}">{t}</b><div style="font-size:14px;color:var(--fg2)">{m}</div></div><div style="margin-left:auto;display:flex;align-items:center;gap:6px;color:var(--fg2);font-size:14px;width:90px">{ic("play",12,2,"currentColor")}{p}</div><div style="width:60px;text-align:right;color:var(--fg2);font-size:14px;font-family:ui-monospace,Menlo,monospace">{d}</div><div style="color:var(--fg2)">{ic("ellipsis",22,2)}</div></div>'
inner=f'''{rail("Media")}{col("MEDIA",[("house","Home"),("film","Videos"),("tv","Shows and Films"),("music","Music"),("mic","Podcasts"),("book-open","Books")],"Music")}<div class="panel" style="left:304px"><div style="position:absolute;inset:0 0 auto 0;height:430px;{A("violet",11,shape="rings")}"></div><div style="position:absolute;inset:0 0 auto 0;height:430px;background:linear-gradient(180deg,rgba(16,21,31,.15),rgba(16,21,31,.55) 60%,var(--s1))"></div>
<div class="hdr"><div class="circ glass" style="width:40px;height:40px">{ic("chevron-left",24,2.2)}</div><div class="btns"><div class="circ glass" style="width:40px;height:40px">{ic("share",18,1.9)}</div><div class="circ glass" style="width:40px;height:40px">{ic("ellipsis",20,2)}</div>{companion(38)}</div></div>
<div style="position:absolute;top:120px;left:36px;display:flex;gap:30px;align-items:flex-end"><div class="tile" style="width:220px;height:220px;border-radius:18px;{A("teal",21,"wave")}box-shadow:0 24px 60px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12)"></div><div style="padding-bottom:6px"><div style="font-size:13px;font-weight:600;letter-spacing:.12em;color:rgba(255,255,255,.75)">ALBUM · 2026</div><h1 style="font-size:64px;font-weight:800;letter-spacing:-.035em;margin:6px 0 6px;line-height:1">Slow Morning</h1><div style="color:rgba(255,255,255,.7);font-size:17px">Indigo Rivet · 12 songs · 41 min</div></div></div>
<div style="position:absolute;top:372px;left:36px;right:36px"><div style="display:flex;gap:12px;align-items:center"><div class="pill inv" style="height:54px;padding:0 34px;font-size:18px">{ic("play",20,2,"currentColor")} Play</div><div class="circ" style="width:54px;height:54px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)">{ic("shuffle",22,1.9)}</div><div class="circ" style="width:54px;height:54px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)">{ic("heart",22,1.9)}</div><div class="circ" style="width:54px;height:54px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)">{ic("download",22,1.9)}</div></div>
<div style="margin-top:22px">{trk}</div></div></div>'''
write('desktop-detail',win(inner))

# desktop chat
sug=''.join(f'<span class="chip">{t}</span>' for t in ["Make the shopping list","Swap Thursday","Add a dessert"])
items=''.join(f'<div style="display:flex;align-items:center;gap:12px;height:46px;border-radius:12px;padding:0 14px;background:var(--s2);margin-bottom:8px"><div style="width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--fg3)"></div><span style="font-size:15px">{t}</span></div>' for t in ["Chicken thighs and potatoes","Black beans and rice","Pizza dough and toppings"])
inner=f'''{rail("Chat")}<div class="col" style="left:56px;width:268px"><div class="pill q" style="width:100%;justify-content:flex-start;height:46px;border-radius:14px;padding:0 14px">{ic("square-pen",20,1.8)} New chat</div><h4>TODAY</h4><div class="li on">Dinners for the week</div><div class="li">Why is the sky blue</div><h4>LAST WEEK</h4><div class="li">Birthday card for Nova</div><div class="li">Plan a rainy Saturday</div><div class="li">Explain fractions</div></div>
<div class="panel" style="left:324px;background:var(--s0)"><div class="hdr"><div class="pill q" style="height:38px;padding:0 14px 0 8px;font-size:15px;background:var(--s1)">{companion(26,False,1)} Tessa {ic("chevron-right",16,2)}</div><div class="btns"><div class="circ glass" style="width:40px;height:40px">{ic("ellipsis",20,2)}</div>{companion(38)}</div></div>
<div style="width:740px;margin:14px auto 0"><div style="text-align:right"><span style="display:inline-block;background:var(--s2);padding:14px 20px;border-radius:24px 24px 8px 24px;font-size:17px">Plan a week of simple dinners for four, one vegetarian night.</span></div>
<div style="margin-top:30px;font-size:17px;line-height:1.6"><p>Here is a simple week that reuses a few staples, so the shopping list stays short.</p>
<div style="margin:18px 0;display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:15px">{''.join(f'<div class="card" style="padding:14px 16px"><div style="font-size:12px;font-weight:600;letter-spacing:.08em;color:var(--fg3)">{d}</div><div style="font-weight:600;margin-top:4px;font-size:16px">{m}</div></div>' for d,m in [("MONDAY","Sheet-pan chicken and potatoes"),("TUESDAY","Veggie chili with cornbread"),("WEDNESDAY","Pasta with tomato and basil"),("THURSDAY","Tacos with rice and beans"),("FRIDAY","Homemade pizza night")])}</div>
<p>Want me to turn this into a shopping list for the household?</p><div style="display:flex;gap:10px;margin-top:16px">{sug}</div></div></div>
<div class="glass" style="position:absolute;left:50%;transform:translateX(-50%);bottom:26px;width:740px;height:64px;border-radius:32px;display:flex;align-items:center;padding:0 10px 0 22px;gap:14px;color:var(--fg3);font-size:17px;background:var(--s1)">{ic("plus",22,1.8)}<span style="flex:1">Send a message</span><span class="chip" style="background:var(--s2);height:34px;font-size:13px">Qwen 3.8</span>{ic("mic",22,1.8)}<div class="circ" style="width:44px;height:44px;background:var(--inv);color:var(--on-inv)">{ic("arrow-up",22,2.4)}</div></div></div>'''
write('desktop-chat',win(inner))
print('desktop ok')

# phone apps launcher
APPS=[("message-circle","Chat","teal"),("film","Videos","violet"),("music","Music","rose"),("image","Pictures","ocean"),("newspaper","News","slate"),("sun","Weather","sand"),("clock","Clock","ember"),("list-plus","Lists","forest"),("book-open","Books","violet"),("mic","Podcasts","rose"),("users","Family","ocean"),("sparkles","Companions","teal"),("wand-sparkles","Studio","ember"),("folder","Files","slate"),("tv","Shows","violet"),("settings","Settings","forest")]
def appicon(i,l,k,seed,star=False,size=64):
    st=f'<div style="position:absolute;top:-4px;right:-4px;width:22px;height:22px;border-radius:50%;background:var(--inv);color:#8a5a00;display:flex;align-items:center;justify-content:center">{ic("star",13,2,"currentColor")}</div>' if star else ''
    return f'<div style="width:{size+14}px;text-align:center;flex:none"><div style="position:relative;width:{size}px;height:{size}px;margin:0 auto;border-radius:{int(size*.28)}px;{A(k,seed)}box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 8px 18px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff">{ic(i,int(size*.44),1.8)}{st}</div><div style="font-size:12px;font-weight:600;margin-top:7px;color:var(--fg)">{l}</div></div>'
fav=''.join(appicon(i,l,k,70+n,True) for n,(i,l,k) in enumerate(APPS[:5]))
grid=''.join(appicon(i,l,k,90+n,n in (2,5)) for n,(i,l,k) in enumerate(APPS[5:]))
body=f'''<div class="scroll"><div style="display:flex;justify-content:space-between;align-items:center;height:44px"><div class="circ glass">{ic("panel-left",22,1.8)}</div>{companion(36)}</div>
<h1 class="t" style="margin-top:14px">Apps</h1>
<div class="glass" style="margin-top:14px;height:50px;border-radius:999px;display:flex;align-items:center;padding:0 18px;gap:10px;color:var(--fg3);font-size:17px">{ic("search",20,1.8)}Search apps</div>
{chips(["All","Create","Media","Home","Family","Tools"])}
<div class="sh" style="margin-top:24px"><h2>Favorites</h2><a>Edit</a></div>
<div style="display:flex;gap:6px;margin:0 -8px;overflow:hidden">{fav}</div>
<div class="sh" style="margin-top:22px"><h2>All apps</h2><a>A to Z {ic("chevron-right",16,2)}</a></div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px 6px;margin:0 -8px">{grid}</div></div>{tabbar("Apps",(('house','Home'),('message-circle','Chat'),('play','Media'),('library','Library'),('grid-2x2','Apps')))}'''
write('phone-apps',phone(body))
print('apps ok')

def hdr(left_icon="panel-left",title=None,right=""):
    return f'<div style="display:flex;justify-content:space-between;align-items:center;height:44px"><div class="circ glass">{ic(left_icon,22,1.8)}</div>{f"<div style=font-weight:600;font-size:17px;color:var(--fg2)>{title}</div>" if title else ""}<div style="display:flex;gap:10px;align-items:center">{right}{companion(36)}</div></div>'
# ---------- NEWS
def story(title,src,k,sd,shape=None,w=None,h=130,lead=False):
    return f'''<div style="{'width:'+str(w)+'px;' if w else ''}flex:none"><div class="tile" style="height:{h}px;border-radius:20px;{A(k,sd,shape)}"></div><div style="padding:10px 4px 0"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--fg2)">{src}</div><div style="font-size:{22 if lead else 16}px;font-weight:{700 if lead else 600};letter-spacing:-.02em;line-height:1.2;margin-top:4px">{title}</div></div></div>'''
body=f'''<div class="scroll">{hdr("panel-left",None,"")}
<div style="font-size:13px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin-top:12px">SUNDAY, NOVEMBER 8</div><h1 class="t" style="margin-top:2px">Today</h1>
{chips(["Top stories","My mix","Local","Science","Sports","Food"])}
<div style="margin-top:18px">{story("A small town votes to keep its old library open another ten years","THE HARBOR POST","ocean",71,"sun",None,210,True)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px">{story("Rain returns to the coast this week","PINE STREET DAILY","slate",72,None,None,110)}{story("Why bees hum in winter","FIELD NOTES","sand",73,"rings",None,110)}{story("Five dinners under twenty dollars","KITCHEN TABLE","ember",74,"wave",None,110)}{story("A new trail opens by the river","THE HARBOR POST","forest",75,"sun",None,110)}</div></div>
{tabbar("Today",(('house','Today'),('sparkles','My Mix'),('heart','Following'),('bookmark','Saved'),('search','Search')))}'''
write('phone-news',phone(body))
# news reader
body=f'''<div style="position:absolute;top:60px;left:16px;right:16px;display:flex;justify-content:space-between;align-items:center;z-index:5"><div class="circ glass">{ic("chevron-left",26,2.2)}</div><div style="display:flex;gap:10px;align-items:center"><div class="glass" style="height:44px;border-radius:999px;display:flex;align-items:center;gap:22px;padding:0 20px">{ic("headphones",20,1.9)}{ic("heart",20,1.9)}{ic("share",20,1.9)}{ic("ellipsis",20,2)}</div>{companion(36)}</div></div>
<div class="scroll" style="padding-top:120px"><div style="text-align:center;font-size:12px;font-weight:700;letter-spacing:.14em;color:var(--fg2)">THE HARBOR POST</div>
<h1 style="font-size:27px;font-weight:700;letter-spacing:-.025em;line-height:1.18;margin-top:18px">A small town votes to keep its old library open another ten years</h1>
<div style="font-size:19px;color:var(--fg2);line-height:1.4;margin-top:12px">Residents filled the hall on Thursday night, and the vote was not close.</div>
<div style="font-size:14px;color:var(--fg3);margin-top:12px">Marsh Quill · 4 min read · Nov 8, 2026</div>
<div class="tile" style="height:230px;border-radius:16px;margin-top:18px;{A("ocean",71,"sun")}"></div>
<div style="font-family:Georgia,'New York',serif;font-size:19px;line-height:1.55;margin-top:18px;color:rgba(255,255,255,.9)">The vote ended a year of debate about whether the building on Mill Street was worth its repair bill. Supporters brought homemade signs and a petition with more than two thousand names.</div></div>'''
write('phone-news-reader',phone(body))
# ---------- ENCYCLOPEDIA
infobox=f'''<div class="card" style="padding:16px;margin-top:16px"><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3)">AT A GLANCE</div>{''.join(f'<div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--hair);font-size:15px;margin-top:{4 if i==0 else 0}px"><span style="color:var(--fg2)">{a}</span><b style="font-weight:600">{b}</b></div>' for i,(a,b) in enumerate([("Cause","Light bending in raindrops"),("Colors","Seven named bands"),("Best seen","Sun behind you, rain ahead")]))}</div>'''
secs=''.join(f'<div style="display:flex;justify-content:space-between;align-items:center;height:56px;border-top:1px solid var(--hair);font-size:17px;font-weight:600">{t}{ic("chevron-right",20,2)}</div>' for t in ["How it forms","Double rainbows","History and myths","In art and science"])
body=f'''<div class="scroll">{hdr("panel-left","Encyclopedia")}
<div class="glass" style="margin-top:14px;height:50px;border-radius:999px;display:flex;align-items:center;padding:0 18px;gap:10px;color:var(--fg3);font-size:17px">{ic("search",20,1.8)}Search the offline library</div>
<h1 style="font-family:Georgia,'New York',serif;font-size:40px;font-weight:700;letter-spacing:-.02em;margin-top:22px">Rainbow</h1>
<div style="color:var(--fg2);font-size:15px;margin-top:2px">Weather phenomenon · Offline copy</div>
<div class="tile" style="height:190px;border-radius:20px;margin-top:16px;{A("ocean",81,"rings")}"><div style="position:absolute;inset:0;background:linear-gradient(90deg,#ff5f7e55,#ffb54755,#7be37b55,#4aa3ff55,#a07cff55);mix-blend-mode:screen;z-index:1"></div></div>
<div style="font-family:Georgia,'New York',serif;font-size:18px;line-height:1.55;margin-top:16px;color:rgba(255,255,255,.9)">A rainbow is a ring of colored light seen when the sun shines through rain. Each drop bends and splits the light, and your eye catches one color from each drop.</div>
{infobox}<div style="margin-top:14px">{secs}</div></div>
{tabbar("Encyclopedia",(('house','Home'),('book-open','Encyclopedia'),('compass','Explore'),('heart','Saved'),('search','Search')))}'''
write('phone-wiki',phone(body))
# ---------- VIDEOS
def vid(title,chan,meta,k,sd,dur,shape=None):
    return f'''<div style="margin-top:20px"><div class="tile" style="height:213px;border-radius:18px;{A(k,sd,shape)}"><div class="badge" style="left:auto;right:10px;bottom:10px;font-size:12px;z-index:3">{dur}</div></div><div style="display:flex;gap:12px;margin-top:12px;align-items:flex-start"><div class="av" style="width:40px;height:40px;{A("violet",sd+5)}"></div><div style="flex:1"><div style="font-size:16px;font-weight:600;letter-spacing:-.015em;line-height:1.25">{title}</div><div style="font-size:13px;color:var(--fg2);margin-top:3px">{chan} · {meta}</div></div>{ic("ellipsis-vertical",20,2)}</div></div>'''
body=f'''<div class="scroll">{hdr("panel-left",None,f'<div class="circ glass">{ic("search",20,1.9)}</div>')}
<h1 class="t" style="margin-top:12px">Videos</h1>{chips(["All","Family","Cooking","Music","Learning"])}
{vid("Pancake Sunday with Nova: the whole recipe","Clover Kitchen","12 min · added 3 days ago","ember",91,"12:04","sun")}{vid("How the harbor lights work","Indigo Rivet","8 min · added 1 week ago","ocean",92,"8:21","rings")}</div>
{tabbar("Home",(('house','Home'),('library','Library'),('clock','History'),('list-plus','Watch later'),('search','Search')))}'''
write('phone-videos',phone(body))
# video watch (phone)
body=f'''<div style="position:absolute;top:0;left:0;right:0;height:300px;{A("ember",91,"sun")}"></div><div style="position:absolute;top:0;left:0;right:0;height:300px;background:linear-gradient(180deg,rgba(0,0,0,.35),transparent 30%,rgba(0,0,0,.5))"></div>
<div style="position:absolute;top:60px;left:16px;right:16px;display:flex;justify-content:space-between;z-index:5"><div class="circ glass">{ic("chevron-left",26,2.2)}</div>{companion(36)}</div>
<div style="position:absolute;top:150px;left:0;right:0;display:flex;justify-content:center;gap:26px;align-items:center;z-index:5"><div class="circ glass" style="width:48px;height:48px">{ic("skip-back",22,1.9)}</div><div class="circ glass" style="width:68px;height:68px">{ic("pause",32,1.9,"currentColor")}</div><div class="circ glass" style="width:48px;height:48px">{ic("skip-forward",22,1.9)}</div></div>
<div style="position:absolute;top:296px;left:0;right:0;height:3px;background:rgba(255,255,255,.2);z-index:5"><i style="display:block;width:34%;height:100%;background:#ff4d5e"></i></div>
<div style="position:absolute;top:316px;left:16px;right:16px"><h1 style="font-size:22px;font-weight:700;letter-spacing:-.02em;line-height:1.2">Pancake Sunday with Nova: the whole recipe</h1><div style="font-size:14px;color:var(--fg2);margin-top:6px">Added 3 days ago</div>
<div style="display:flex;align-items:center;gap:12px;margin-top:16px"><div class="av" style="width:44px;height:44px;{A("violet",96)}"></div><div style="flex:1"><b style="font-size:16px">Clover Kitchen</b><div style="font-size:13px;color:var(--fg2)">On this hub</div></div></div>
<div style="display:flex;gap:10px;margin-top:16px"><span class="pill q" style="height:40px;flex:1;justify-content:center">{ic("list-plus",18,1.9)} Watch later</span><span class="pill q" style="height:40px;flex:1;justify-content:center">{ic("share",18,1.9)} Share</span></div>
<div class="card" style="margin-top:16px;padding:14px 16px;border-radius:18px"><b style="font-size:15px">Description</b><div style="font-size:14px;color:var(--fg2);line-height:1.45;margin-top:4px">Flour, milk, two eggs and a pinch of salt. Nova flips every one.</div></div></div>'''
write('phone-video-watch',phone(body))
print('more ok')

LIME="var(--create)"
def cprompt(w,placeholder,chips_,btn="Generate",h=150,extra=""):
    ch=''.join(f'<span class="chip" style="height:34px;font-size:13px;background:var(--s2)">{ic(i,15,1.9)}{t}</span>' for i,t in chips_)
    return f'''<div class="card" style="width:{w}px;padding:16px;border-radius:24px;background:var(--s2);{extra}"><div style="font-size:17px;line-height:1.45;min-height:{h-80}px;color:var(--fg)">{placeholder}</div><div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap"><div class="circ" style="width:34px;height:34px;background:var(--s3)">{ic("plus",18,2)}</div>{ch}<span class="pill inv" style="margin-left:auto;height:40px;padding:0 18px;font-size:15px">{ic("sparkles",17,2)}{btn}</span></div></div>'''
def ring(p,size=64):
    return f'<div style="width:{size}px;height:{size}px;border-radius:50%;background:conic-gradient({LIME} {p}%,rgba(255,255,255,.14) 0);display:flex;align-items:center;justify-content:center"><div style="width:{size-8}px;height:{size-8}px;border-radius:50%;background:var(--s0);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">{p}%</div></div>'
def wave(n=46,seed=1,active=0.4,w=420):
    import random;r=random.Random(seed);b=''
    for i in range(n):
        h=6+int(abs(r.gauss(0,1))*14+r.randint(0,8)); c=LIME if i/n<active else 'rgba(255,255,255,.28)'
        b+=f'<i style="display:block;width:3px;height:{h}px;border-radius:2px;background:{c}"></i>'
    return f'<div style="display:flex;gap:3px;align-items:center;height:38px;width:{w}px">{b}</div>'
# ---------- desktop video create
feed=f'''<div style="padding:0 36px 0 0;display:flex;flex-direction:column;gap:20px">
<div style="display:flex;gap:16px;align-items:flex-start"><div class="tile" style="width:430px;height:242px;border-radius:22px;{A("ember",91,"sun")}"><div style="position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center"><div class="circ glass" style="width:64px;height:64px">{ic("play",28,2,"currentColor")}</div></div><div class="badge" style="left:auto;right:12px;bottom:12px;z-index:3">0:06</div></div><div style="flex:1;min-width:0;padding-top:4px"><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3)">DONE · 12 SEC AGO</div><div style="font-size:17px;font-weight:600;line-height:1.35;margin-top:6px">Nova flips a pancake in a sunny kitchen, slow motion</div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><span class="chip" style="height:30px;font-size:12px">Cinematic</span><span class="chip" style="height:30px;font-size:12px">Slow dolly</span><span class="chip" style="height:30px;font-size:12px">6 sec</span></div><div style="display:flex;gap:8px;margin-top:16px"><span class="pill q" style="height:38px;font-size:14px">{ic("wand-sparkles",16,1.9)}Edit</span><span class="pill q" style="height:38px;font-size:14px">{ic("film",16,1.9)}Continue</span><span class="circ" style="width:38px;height:38px;background:var(--s2)">{ic("heart",17,1.9)}</span><span class="circ" style="width:38px;height:38px;background:var(--s2)">{ic("download",17,1.9)}</span></div></div></div>
<div style="display:flex;gap:16px;align-items:center;padding:16px;border-radius:22px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)">{ring(62)}<div style="flex:1"><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:{LIME}">MAKING NOW</div><div style="font-size:16px;font-weight:600;margin-top:4px">A paper boat drifts down a rainy street</div><div style="font-size:14px;color:var(--fg2);margin-top:2px">About 40 seconds left</div></div><span class="pill q" style="height:38px;font-size:14px">Cancel</span></div></div>'''
inner=f'''{rail("Media")}{col("VIDEOS",[("house","Home"),("sparkles","Create"),("clapperboard","My clips"),("film","Watch")],"Create")}<div class="panel" style="left:304px"><div class="hdr"><div class="ttl">Create</div><div class="btns"><div class="circ glass" style="width:40px;height:40px">{ic("bell",19,1.9)}</div>{companion(38)}</div></div>
<div style="display:flex;gap:28px;padding:0 0 0 28px"><div style="width:400px;flex:none"><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin-bottom:10px">PROMPT</div>{cprompt(400,"A paper boat drifts down a rainy street at night, neon puddles, soft camera push in.",[("film","Cinematic"),("clock","6 sec"),("sliders-horizontal","Style")],"Generate",150)}
<div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin:22px 0 10px">REFERENCES</div><div style="display:flex;gap:10px"><div class="tile" style="width:92px;height:92px;border-radius:16px;{A("ocean",101)}"><div style="position:absolute;top:6px;right:6px;z-index:3" class="circ glass"><span style="width:22px;height:22px;display:flex;align-items:center;justify-content:center">{ic("plus",12,2.4)}</span></div></div><div style="width:92px;height:92px;border-radius:16px;border:1.5px dashed var(--fg3);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--fg2);font-size:12px;font-weight:600">{ic("image",22,1.8)}Picture</div><div style="width:92px;height:92px;border-radius:16px;border:1.5px dashed var(--fg3);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--fg2);font-size:12px;font-weight:600">{ic("mic",22,1.8)}Voice</div></div>
<div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin:22px 0 10px">MODEL</div><div style="display:flex;gap:10px"><div class="card" style="flex:1;padding:12px 14px;border-radius:18px;box-shadow:inset 0 0 0 1.5px {LIME}"><b style="font-size:15px">Standard</b><div style="font-size:12px;color:var(--fg2);margin-top:2px">Fast, good for ideas</div></div><div class="card" style="flex:1;padding:12px 14px;border-radius:18px"><b style="font-size:15px">Detailed</b><div style="font-size:12px;color:var(--fg2);margin-top:2px">Slower, sharper</div></div></div></div>
<div style="flex:1;overflow:hidden"><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin-bottom:10px">RESULTS</div>{feed}</div></div></div>'''
write('desktop-video-create',win(inner))
# ---------- desktop music create
tabs=''.join(f'<span class="chip {"on" if i==0 else ""}" style="height:36px">{t}</span>' for i,t in enumerate(["Create","Studio","Stems","Remix","Library"]))
def mrow(title,meta,k,sd,dur,pl=False,p=0.35):
    return f'''<div style="display:flex;align-items:center;gap:16px;height:84px;border-radius:18px;padding:0 14px;{"background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)" if pl else ""}"><div style="width:64px;height:64px;border-radius:12px;position:relative;{A(k,sd)}"><div class="badge">{dur}</div></div><div style="width:240px"><b style="font-size:17px;font-weight:600">{title}</b><div style="font-size:14px;color:var(--fg2);margin-top:2px">{meta}</div></div>{wave(52,sd,p if pl else 0,360)}<div style="margin-left:auto;display:flex;gap:10px;color:var(--fg2)">{ic("heart",22,1.8)}{ic("shuffle",22,1.8)}{ic("ellipsis",22,2)}</div></div>'''
inner=f'''{rail("Media")}{col("MUSIC",[("house","Home"),("sparkles","Create"),("library","Library"),("list-music","Playlists")],"Create")}<div class="panel" style="left:304px"><div class="glow"></div><div class="hdr"><div style="display:flex;gap:8px">{tabs}</div><div class="btns"><div class="circ glass" style="width:40px;height:40px">{ic("search",19,1.9)}</div>{companion(38)}</div></div>
<div style="padding:6px 36px"><h1 style="font-size:40px;font-weight:700;letter-spacing:-.03em">Make a song</h1><div style="color:var(--fg2);font-size:17px;margin-top:4px">Describe it, or write your own lyrics.</div>
<div class="sh" style="margin:26px 0 8px"><h2>Your songs</h2><a>Filter {ic("sliders-horizontal",16,2)}</a></div>
{mrow("Porch Lights","warm, acoustic, mellow","forest",31,"2:19",True,0.4)}{mrow("Slow Morning","ambient, piano, soft","rose",32,"3:20")}{mrow("Rain on the Roof","slow tempo, folk","ocean",33,"2:34")}</div>
<div style="position:absolute;left:36px;right:36px;bottom:24px">{cprompt(1000,"A mellow acoustic song about a rainy porch, brushed drums, warm voice",[("music","Folk, warm"),("mic","Voice: Clover"),("book-open","Lyrics"),("clock","2:30")],"Create",116,"background:var(--glass);backdrop-filter:blur(28px);box-shadow:0 20px 50px rgba(0,0,0,.5),inset 0 0 0 1px var(--hair)")}</div></div>'''
write('desktop-music-create',win(inner))
# ---------- desktop photo editor
tools=[("wand-sparkles","Edit",1),("sliders-horizontal","Adjust",0),("square-pen","Mask",0),("layers","Layers",0),("sparkles","Style",0)]
tl=''.join(f'<div style="width:60px;height:60px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11px;font-weight:600;color:{"#fff" if on else "var(--fg2)"};{"background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)" if on else ""}">{ic(i,22,1.8)}{l}</div>' for i,l,on in tools)
hist=''.join(f'<div class="tile" style="width:64px;height:64px;border-radius:12px;{A(k,sd)}{"box-shadow:0 0 0 2px "+LIME+";" if n==0 else ""}"></div>' for n,(k,sd) in enumerate([("ocean",121),("ocean",122),("sand",123),("slate",124)]))
inner=f'''{rail("Library")}<div class="panel" style="left:56px"><div class="hdr"><div style="display:flex;gap:12px;align-items:center"><div class="circ glass" style="width:40px;height:40px">{ic("chevron-left",22,2.2)}</div><div class="ttl">Photo editor</div><span style="color:var(--fg3);font-size:14px">harbor-sunset.jpg</span></div><div class="btns"><span class="pill q" style="height:38px;font-size:14px">Undo</span><span class="pill inv" style="height:38px;font-size:14px">Save copy</span>{companion(38)}</div></div>
<div style="position:absolute;left:24px;top:84px;display:flex;flex-direction:column;gap:8px">{tl}</div>
<div style="position:absolute;left:104px;top:84px;right:380px;bottom:24px;border-radius:22px;background:#05070b;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px var(--hair)"><div class="tile" style="width:760px;height:500px;border-radius:14px;{A("ocean",121,"sun")}"><svg style="position:absolute;inset:0;z-index:3" width="100%" height="100%"><path d="M0 120 Q 200 70 380 110 T 760 90 V 0 H 0 Z" fill="{'#d7ff4a'}" fill-opacity=".22" stroke="#d7ff4a" stroke-width="2" stroke-dasharray="7 5"/></svg><div style="position:absolute;left:14px;top:14px;z-index:4" class="glass pill"><span style="font-size:13px;height:30px;display:flex;align-items:center;gap:6px">{ic("square-pen",15,2)}Masked: sky</span></div></div></div>
<div style="position:absolute;right:24px;top:84px;width:332px;bottom:24px;display:flex;flex-direction:column;gap:16px"><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3)">WHAT TO CHANGE</div>{cprompt(332,"Make the sky a warm sunset, keep the water and the boats exactly as they are.",[("square-pen","Mask on")],"Generate",150)}
<div class="card" style="padding:14px 16px;border-radius:18px"><div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600"><span>Strength</span><span style="color:var(--fg2)">60%</span></div><div style="height:6px;border-radius:3px;background:rgba(255,255,255,.14);margin-top:12px;position:relative"><i style="position:absolute;left:0;top:0;bottom:0;width:60%;border-radius:3px;background:{LIME}"></i><b style="position:absolute;left:60%;top:-6px;width:18px;height:18px;border-radius:50%;background:#fff;transform:translateX(-9px)"></b></div></div>
<div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin-top:6px">VERSIONS</div><div style="display:flex;gap:10px">{hist}</div></div></div>'''
write('desktop-photo-edit',win(inner))
# ---------- phone video create
body=f'''<div class="scroll">{hdr("panel-left","Create")}
<h1 class="t" style="margin-top:12px">Videos</h1>{chips(["Create","My clips","Watch"])}
<div style="margin-top:18px;display:flex;gap:14px;align-items:center;padding:14px;border-radius:22px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)">{ring(62,56)}<div style="flex:1"><div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:{LIME}">MAKING NOW</div><div style="font-size:15px;font-weight:600;margin-top:3px">A paper boat drifts down a rainy street</div></div></div>
<div class="tile" style="height:210px;border-radius:20px;margin-top:16px;{A("ember",91,"sun")}"><div style="position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center"><div class="circ glass" style="width:56px;height:56px">{ic("play",24,2,"currentColor")}</div></div></div>
<div style="font-size:15px;font-weight:600;margin-top:10px">Nova flips a pancake, slow motion</div><div style="display:flex;gap:8px;margin-top:10px"><span class="pill q" style="height:36px;font-size:13px">{ic("wand-sparkles",15,1.9)}Edit</span><span class="pill q" style="height:36px;font-size:13px">{ic("film",15,1.9)}Continue</span><span class="circ" style="width:36px;height:36px;background:var(--s2)">{ic("heart",16,1.9)}</span></div></div>
<div style="position:absolute;left:12px;right:12px;bottom:106px;z-index:45">{cprompt(378,"Describe your video",[("image","Picture"),("clock","6s"),("sliders-horizontal","Style")],"Generate",100,"background:var(--glass);backdrop-filter:blur(28px);box-shadow:0 12px 34px rgba(0,0,0,.5),inset 0 0 0 1px var(--hair)")}</div>{tabbar("Create",(('house','Home'),('sparkles','Create'),('clapperboard','My clips'),('film','Watch'),('search','Search')))}'''
write('phone-video-create',phone(body))
# ---------- phone music create
body=f'''<div class="scroll">{hdr("panel-left","Music")}
<h1 class="t" style="margin-top:12px">Make a song</h1>{chips(["Create","Studio","Stems","Remix","Library"])}
<div class="sh"><h2>Your songs</h2><a>See All {ic("chevron-right",16,2)}</a></div>
{row("Porch Lights","warm, acoustic, mellow","forest",31,"2:19")}{row("Slow Morning","ambient, piano, soft","rose",32,"3:20",None,"sun")}{row("Rain on the Roof","slow tempo, folk","ocean",33,"2:34")}</div>
<div style="position:absolute;left:12px;right:12px;bottom:106px;z-index:45">{cprompt(378,"Describe your song or paste lyrics",[("music","Folk"),("mic","Clover"),("clock","2:30")],"Create",100,"background:var(--glass);backdrop-filter:blur(28px);box-shadow:0 12px 34px rgba(0,0,0,.5),inset 0 0 0 1px var(--hair)")}</div>{tabbar("Create",(('house','Home'),('sparkles','Create'),('library','Library'),('list-music','Playlists'),('search','Search')))}'''
write('phone-music-create',phone(body))


# photo editor v2 (matches media-editors record: tools left, prompt bar at bottom, versions strip, shell pane on the right)
tools=[("wand-sparkles","Describe",1),("square-pen","Erase",0),("image","No BG",0),("sliders-horizontal","Adjust",0),("layers","Crop",0)]
tl=''.join(f'<div style="width:60px;height:60px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11px;font-weight:600;color:{"#fff" if on else "var(--fg2)"};{"background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)" if on else ""}">{ic(i,22,1.8)}{l}</div>' for i,l,on in tools)
vers=''.join(f'<div style="display:flex;gap:12px;align-items:center;padding:8px;border-radius:14px;{"background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)" if n==0 else ""}"><div class="tile" style="width:64px;height:64px;border-radius:10px;{A(k,sd,sh)}"></div><div><b style="font-size:15px">{t}</b><div style="font-size:13px;color:var(--fg2)">{m}</div></div></div>' for n,(t,m,k,sd,sh) in enumerate([("Warm sunset sky","Just now","ocean",121,"sun"),("Original","harbor-sunset.jpg","ocean",122,None),("Remove background","Yesterday","sand",123,None)]))
check="background-image:linear-gradient(45deg,var(--s2) 25%,transparent 25%),linear-gradient(-45deg,var(--s2) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--s2) 75%),linear-gradient(-45deg,transparent 75%,var(--s2) 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0;background-color:var(--s1)"
inner=f'''{rail("Library")}<div class="panel" style="left:56px;right:392px"><div class="hdr"><div style="display:flex;gap:12px;align-items:center"><div class="circ glass" style="width:40px;height:40px">{ic("chevron-left",22,2.2)}</div><div class="ttl">Photo editor</div><span style="color:var(--fg3);font-size:14px">harbor-sunset.jpg</span></div><div class="btns"><span class="pill q" style="height:38px;font-size:14px">Undo</span><span class="pill inv" style="height:38px;font-size:14px">Save</span></div></div>
<div style="position:absolute;left:24px;top:84px;display:flex;flex-direction:column;gap:8px">{tl}</div>
<div style="position:absolute;left:104px;top:84px;right:24px;height:540px;border-radius:20px;{check};display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px var(--hair)"><div class="tile" style="width:700px;height:460px;border-radius:12px;{A("ocean",121,"sun")}"><div style="position:absolute;left:12px;top:12px;z-index:4" class="glass pill"><span style="font-size:13px;height:30px;display:flex;align-items:center;gap:6px">{ic("layers",15,2)}Before and after</span></div></div></div>
<div style="position:absolute;left:104px;right:24px;bottom:22px">{cprompt(740,"Make the sky a warm sunset, keep the water and the boats exactly as they are.",[("square-pen","Painted area"),("sliders-horizontal","Strength 60%")],"Generate",110)}</div></div>
<div class="panel" style="left:auto;width:380px;background:var(--s1)"><div class="hdr" style="padding:0 20px"><div style="display:flex;gap:6px"><span class="chip" style="height:34px;font-size:13px">{companion(20,False,1)}Tessa</span><span class="chip on" style="height:34px;font-size:13px">Versions</span><span class="chip" style="height:34px;font-size:13px">Info</span></div>{companion(38)}</div><div style="padding:8px 20px;display:flex;flex-direction:column;gap:6px">{vers}</div></div>'''
write('desktop-photo-edit',win(inner))


# ---- Making now: one card, five states, three contexts
def making(state,title,sub,thumb=None,p=62):
    if state=='queued': lead=f'<div style="width:56px;height:56px;border-radius:50%;background:var(--s3);display:flex;align-items:center;justify-content:center;color:var(--fg2)">{ic("clock",24,1.8)}</div>'; tag=('WAITING','var(--fg2)'); act='<span class="pill q" style="height:36px;font-size:14px">Cancel</span>'
    elif state=='making': lead=ring(p,56); tag=('MAKING NOW',LIME); act='<span class="pill q" style="height:36px;font-size:14px">Cancel</span>'
    elif state=='done': lead=f'<div class="tile" style="width:56px;height:56px;border-radius:12px;{A("ember",91,"sun")}"></div>'; tag=('DONE','var(--fg2)'); act='<span class="pill inv" style="height:36px;font-size:14px">Open</span>'
    elif state=='failed': lead=f'<div style="width:56px;height:56px;border-radius:50%;background:rgba(255,95,126,.16);display:flex;align-items:center;justify-content:center;color:#ff7a93">{ic("circle-alert",24,1.8)}</div>'; tag=('COULD NOT FINISH','#ff7a93'); act='<span class="pill inv" style="height:36px;font-size:14px">Try again</span>'
    else: lead=f'<div style="width:56px;height:56px;border-radius:50%;background:var(--s3);display:flex;align-items:center;justify-content:center;color:var(--fg2)">{ic("pause",22,1.8)}</div>'; tag=('PAUSED','var(--fg2)'); act='<span class="pill q" style="height:36px;font-size:14px">Resume</span>'
    return f'<div style="display:flex;gap:16px;align-items:center;padding:14px 16px;border-radius:22px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)">{lead}<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:{tag[1]}">{tag[0]}</div><div style="font-size:16px;font-weight:600;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{title}</div><div style="font-size:14px;color:var(--fg2);margin-top:2px">{sub}</div></div>{act}</div>'
cards=''.join(making(*a) for a in [('queued','A paper boat drifts down a rainy street','Next after another video (about 3 minutes)','',0),('making','A paper boat drifts down a rainy street','About 40 seconds left',None,62),('done','Nova flips a pancake, slow motion','Ready · 0:06',None,100),('failed','A song about a rainy porch','The music engine is paused. Try again in a minute.',None,0),('paused','Slow Morning, remix','Paused while chat answers',None,0)])
ctx=lambda t,inner:f'<div><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin-bottom:10px">{t}</div>{inner}</div>'
mini_row=lambda:f'<div style="display:flex;align-items:center;gap:14px;height:76px"><div style="width:64px;height:64px;border-radius:12px;background:var(--s3);display:flex;align-items:center;justify-content:center">{ring(48,48)}</div><div style="flex:1"><b style="font-size:17px">Rainy porch song</b><div style="font-size:14px;color:{LIME};font-weight:600;margin-top:2px">Making now · 48%</div></div>{ic("ellipsis",24,2)}</div>'
inner=f'''<div style="padding:34px 40px;display:grid;grid-template-columns:520px 1fr 360px;gap:36px;height:900px;background:var(--s0)">
{ctx("ONE CARD, FIVE STATES (the same everywhere)",'<div style="display:flex;flex-direction:column;gap:12px">'+cards+'</div>')}
{ctx("IN A LIST (a Music or Library row)",mini_row()+'<div style="height:24px"></div>'+ctx("IN CHAT (inside a reply)",'<div style="max-width:440px">'+making("making","Pancake video for Nova","About 40 seconds left",None,62)+'</div>'))}
{ctx("ON A PHONE (above the sections bar)",f'<div style="width:358px">{making("making","A paper boat drifts down a rainy street","About 40 seconds left",None,62)}</div>')}
</div>'''
write('making-now',win(inner))


q=''.join([making('making','A paper boat drifts down a rainy street','About 40 seconds left',None,62),making('queued','Nova flips a pancake, slow motion','Waiting for chat to finish','',0),making('queued','A song about a rainy porch','Next after another video (about 3 minutes)','',0),f'<div style="display:flex;align-items:center;justify-content:center;gap:8px;height:48px;border-radius:999px;background:var(--s1);box-shadow:inset 0 0 0 1px var(--hair);font-size:14px;font-weight:600;color:var(--fg2)">{ic("chevron-right",16,2)}2 more waiting</div>'])
inner2=f'''<div style="padding:34px 40px;display:grid;grid-template-columns:520px 1fr;gap:56px;height:900px;background:var(--s0)">
{ctx("OPTION (i) PREVIEW ONLY, needs an S6 change: a list of your own jobs",'<div style="display:flex;flex-direction:column;gap:12px">'+q+'</div>')}
{ctx("RULES",'<div style="font-size:16px;line-height:1.7;color:var(--fg2);max-width:520px">Only your own jobs.<br>Running first, then Waiting your turn (n) in order.<br>Each waiting card has its own Cancel.<br>More than three folds into one expandable row.<br>Shown inside the app where you started the job.<br>No global tray (that is an option for Jesse).</div>')}</div>'''
write('making-now-queue',win(inner2))


def dl(state,title,sub,p=62,act="Pause"):
    if state=='run': lead=ring(p,56); tag=('DOWNLOADING','var(--accent)')
    elif state=='queue': lead=f'<div style="width:56px;height:56px;border-radius:50%;background:var(--s3);display:flex;align-items:center;justify-content:center;color:var(--fg2)">{ic("clock",24,1.8)}</div>'; tag=('WAITING','var(--fg2)')
    elif state=='stall': lead=f'<div style="width:56px;height:56px;border-radius:50%;background:rgba(255,181,71,.16);display:flex;align-items:center;justify-content:center;color:#ffb547">{ic("circle-alert",24,1.8)}</div>'; tag=('STALLED','#ffb547')
    elif state=='fail': lead=f'<div style="width:56px;height:56px;border-radius:50%;background:rgba(255,95,126,.16);display:flex;align-items:center;justify-content:center;color:#ff7a93">{ic("circle-alert",24,1.8)}</div>'; tag=('COULD NOT FINISH','#ff7a93')
    else: lead=f'<div style="width:56px;height:56px;border-radius:50%;background:rgba(47,212,192,.16);display:flex;align-items:center;justify-content:center;color:var(--accent)">{ic("download",24,1.8)}</div>'; tag=('DONE','var(--fg2)')
    a=f'<span class="pill {"inv" if act in ("Retry","Open") else "q"}" style="height:36px;font-size:14px">{act}</span>'
    bar=f'<div style="height:4px;border-radius:2px;background:rgba(255,255,255,.12);margin-top:8px"><i style="display:block;width:{p}%;height:100%;border-radius:2px;background:var(--accent)"></i></div>' if state=='run' else ''
    return f'<div style="display:flex;gap:16px;align-items:center;padding:14px 16px;border-radius:22px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)">{lead}<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:{tag[1]}">{tag[0]}</div><div style="font-size:16px;font-weight:600;margin-top:3px">{title}</div><div style="font-size:14px;color:var(--fg2);margin-top:2px">{sub}</div>{bar}</div>{a}</div>'
dls=''.join([dl('run','Voice: Clover','3.0 of 4.8 GB · about 4 minutes',62,'Pause'),dl('queue','Writing helper','1.1 GB · after the voice',0,'Cancel'),dl('stall','Picture model','Stopped at 40%. Check the connection, then resume.',40,'Resume'),dl('fail','Music model','The file did not check out. Download it again.',0,'Retry'),dl('done','Chat model','Ready to use',100,'Open')])
inner3=f'''<div style="padding:34px 40px;display:grid;grid-template-columns:560px 1fr;gap:56px;height:900px;background:var(--s0)">
{ctx("DOWNLOADS AND INSTALLS: the same card, the same states",'<div style="display:flex;flex-direction:column;gap:12px">'+dls+'</div>')}
{ctx("IN THE SHELL STRIP (same place as today, S6)",'<div style="max-width:560px">'+dl("run","Voice: Clover","3.0 of 4.8 GB · about 4 minutes",62,"Pause")+'</div><div style="margin-top:26px;font-size:16px;line-height:1.7;color:var(--fg2);max-width:520px">Same state words, same order, same action place as Making now.<br>A thin bar under the text shows the bytes; the ring shows the percent.<br>Where the strip, the dock and the setup wizard sit does not change.</div>')}</div>'''
write('downloads-card',win(inner3))


KIND={'progress':('var(--create)','rgba(215,255,74,.14)','MAKING NOW'),'wait':('var(--fg2)','var(--s3)','WAITING'),'done':('var(--accent)','rgba(47,212,192,.16)','DONE'),'attn':('#ffb547','rgba(255,181,71,.16)','NEEDS A LOOK'),'problem':('#ff7a93','rgba(255,95,126,.16)','COULD NOT FINISH'),'info':('#7fb2ff','rgba(74,163,255,.16)','GOOD TO KNOW')}
def sc(kind,icon,title,line,action,tag=None,second=None):
    c,bg,t=KIND[kind]; t=tag or t
    lead=ring(62,56) if kind=='progress' else f'<div style="width:56px;height:56px;border-radius:50%;background:{bg};display:flex;align-items:center;justify-content:center;color:{c}">{ic(icon,24,1.8)}</div>'
    a=f'<span class="pill {"inv" if action[1] else "q"}" style="height:36px;font-size:14px">{action[0]}</span>'
    b=f'<span class="pill q" style="height:36px;font-size:14px;background:transparent;box-shadow:none;color:var(--fg2)">{second}</span>' if second else ''
    return f'<div class="scard" style="display:flex;gap:16px;align-items:center;padding:14px 16px;border-radius:22px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)">{lead}<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:{c}">{t}</div><div style="font-size:16px;font-weight:600;margin-top:3px">{title}</div><div style="font-size:14px;color:var(--fg2);margin-top:2px;line-height:1.35">{line}</div></div>{b}{a}</div>'
L=[sc('progress','sparkles','A paper boat drifts down a rainy street','About 40 seconds left',('Cancel',0)),
sc('wait','clock','Nova flips a pancake, slow motion','Waiting for chat to finish',('Cancel',0)),
sc('problem','circle-alert','The video did not finish','The picture engine stopped. Nothing was lost.',('Try again',1),'COULD NOT FINISH'),
sc('problem','circle-alert','Voice: Clover did not download','The file did not check out. Download it again.',('Retry',1)),
sc('attn','circle-alert','Not enough storage for this download','It needs 4.8 GB and 2.1 GB is free.',('Free up space',1),'NEEDS A LOOK','Not now')]
R=[sc('attn','lock','Pictures and video are paused','Chat is busy right now. Ask anyway and it will start after.',('Got it',0),'NOT READY'),
sc('attn','users','Marlow asked to make a video','Review it before it starts.',('Review',1),'NEEDS YOUR OK'),
sc('info','sparkles','Tip: paint over a part of a picture','Then describe only that part and the rest stays the same.',('Try it',0),'GOOD TO KNOW','Dismiss'),
sc('done','heart','Slow Morning is ready','Added to your Library.',('Open',1),'DONE'),
sc('problem','circle-alert','Could not save your settings','Check the connection and press Save again.',('Save again',1),'COULD NOT SAVE')]
inner4=f'''<div style="padding:30px 36px;display:grid;grid-template-columns:1fr 1fr;gap:36px;height:900px;background:var(--s0)">
{ctx("ONE STATUS CARD: progress, waiting, problem, needs a look",'<div style="display:flex;flex-direction:column;gap:12px">'+''.join(L)+'</div>')}
{ctx("THE SAME CARD: not ready, needs your OK, tip, done, form error",'<div style="display:flex;flex-direction:column;gap:12px">'+''.join(R)+'</div>')}</div>'''
write('status-cards',win(inner4))


# persistent job dock (the S6 progress strip carrying the person's own jobs)
def jobdock(title="Rainy porch song",sub="Music · making now",p=48,bottom=104,w=None):
    return f'<div class="glass" style="position:absolute;left:14px;right:14px;bottom:{bottom}px;height:64px;border-radius:22px;display:flex;align-items:center;gap:12px;padding:0 14px 0 10px;z-index:41">{ring(p,44)}<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--accent-app,var(--create))">MAKING NOW</div><b style="font-size:15px;font-weight:600">{title}</b> <span style="font-size:13px;color:var(--fg2)">· {sub.split(" · ")[0]}</span></div><span class="pill q" style="height:34px;padding:0 14px;font-size:13px">Open</span></div>'
body=f'''<div class="scroll">{hdr("panel-left",None,"")}
<div style="font-size:13px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin-top:12px">SUNDAY, NOVEMBER 8</div><h1 class="t" style="margin-top:2px">Today</h1>
{chips(["Top stories","My mix","Local","Science"])}
<div style="margin-top:18px">{story("A small town votes to keep its old library open another ten years","THE HARBOR POST","ocean",71,"sun",None,190,True)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px">{story("Rain returns to the coast this week","PINE STREET DAILY","slate",72,None,None,100)}{story("Why bees hum in winter","FIELD NOTES","sand",73,"rings",None,100)}</div></div>
{jobdock()}{tabbar("Today",(('house','Today'),('sparkles','My Mix'),('heart','Following'),('bookmark','Saved'),('search','Search')))}'''
write('phone-news-job',phone(body))
# desktop: the same job in the shell strip at the foot of the page
inner=f'''{rail("Home")}{col("NEWS",[("house","Today"),("sparkles","My Mix"),("heart","Following"),("bookmark","Saved")],"Today")}<div class="panel" style="left:304px"><div class="hdr"><div class="ttl">News</div><div class="btns"><div class="circ glass" style="width:40px;height:40px">{ic("search",19,1.9)}</div>{companion(38)}</div></div>
<div style="padding:0 36px"><div style="font-size:13px;font-weight:700;letter-spacing:.1em;color:var(--fg3)">SUNDAY, NOVEMBER 8</div><h1 style="font-size:44px;font-weight:700;letter-spacing:-.03em;margin-top:2px">Today</h1>
<div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:18px;margin-top:22px">{story("A small town votes to keep its old library open another ten years","THE HARBOR POST","ocean",71,"sun",None,250,True)}{story("Rain returns to the coast this week","PINE STREET DAILY","slate",72,None,None,250)}{story("Why bees hum in winter","FIELD NOTES","sand",73,"rings",None,250)}</div></div>
<div class="glass" style="position:absolute;left:36px;right:36px;bottom:20px;height:72px;border-radius:24px;display:flex;align-items:center;gap:16px;padding:0 18px 0 14px">{ring(48,48)}<div style="flex:1"><div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--create)">MAKING NOW · MUSIC</div><b style="font-size:16px">Rainy porch song</b><span style="font-size:14px;color:var(--fg2)"> · About 1 minute left</span></div><span class="pill q" style="height:38px;font-size:14px">Cancel</span><span class="pill inv" style="height:38px;font-size:14px">Open</span></div></div>'''
write('desktop-news-job',win(inner))


# ---- phone drawer (S1 menu button opened)
def dli(i,l,on=False,dot=None):
    d=f'<i style="display:block;width:8px;height:8px;border-radius:50%;background:{dot};margin-left:auto"></i>' if dot else ''
    return f'<div style="display:flex;align-items:center;gap:14px;height:46px;border-radius:14px;padding:0 14px;font-size:16px;font-weight:{600 if on else 500};color:{"#fff" if on else "var(--fg2)"};{"background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)" if on else ""}">{ic(i,22,1.8)}{l}{d}</div>'
def dh(t): return f'<div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--fg3);margin:18px 14px 6px">{t}</div>'
drawer=f'''<div style="position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:80"></div>
<div style="position:absolute;left:0;top:0;bottom:0;width:318px;z-index:90;background:var(--s1);box-shadow:20px 0 60px rgba(0,0,0,.5),inset -1px 0 0 var(--hair);padding:64px 14px 20px;display:flex;flex-direction:column">
<div style="display:flex;align-items:center;gap:10px;padding:0 6px 12px"><div style="width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#2fd4c0,#4aa3ff);display:flex;align-items:center;justify-content:center">{ic("sparkles",20,2)}</div><b style="font-size:18px;letter-spacing:-.02em">MaiPai</b></div>
<div class="glass" style="height:46px;border-radius:999px;display:flex;align-items:center;gap:10px;padding:0 16px;color:var(--fg3);font-size:16px;margin-bottom:4px">{ic("search",19,1.8)}Search</div>
{dh("APPS")}{dli("house","Home")}{dli("message-circle","Chat",False,"#46d983")}{dli("library","Library")}{dli("users","Family")}{dli("play","Media")}{dli("newspaper","News",True)}{dli("music","Music",False,"#ffb547")}{dli("grid-2x2","All apps")}
{dh("NEWS")}{dli("house","Today",True)}{dli("sparkles","My Mix")}{dli("heart","Following")}{dli("bookmark","Saved")}
<div style="margin-top:auto;display:flex;align-items:center;gap:12px;padding:10px;border-radius:16px;background:var(--s2)"><div class="av" style="width:38px;height:38px;background:linear-gradient(135deg,#7a6bff,#4aa3ff);display:flex;align-items:center;justify-content:center;font-weight:700">S</div><div><b style="font-size:15px">Sage</b><div style="font-size:12px;color:var(--fg2)">Profile, notifications, help</div></div><span style="margin-left:auto;color:var(--fg2)">{ic("settings",22,1.8)}</span></div></div>'''
body=f'''<div class="scroll">{hdr("panel-left",None,"")}
<div style="font-size:13px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin-top:12px">SUNDAY, NOVEMBER 8</div><h1 class="t" style="margin-top:2px">Today</h1>
{chips(["Top stories","My mix","Local"])}<div style="margin-top:18px">{story("A small town votes to keep its old library open another ten years","THE HARBOR POST","ocean",71,"sun",None,190,True)}</div></div>
{tabbar("Today",(('house','Today'),('sparkles','My Mix'),('heart','Following'),('bookmark','Saved'),('search','Search')))}{drawer}'''
write('phone-drawer',phone(body))
# ---- stacked status cards: phone (a Needs-a-look list screen + running dock) and desktop
cards=[sc('progress','sparkles','A paper boat drifts down a rainy street','Video · about 40 seconds left',('Cancel',0)),
sc('wait','clock','Nova flips a pancake, slow motion','Video · waiting for chat to finish',('Cancel',0)),
sc('problem','circle-alert','Rainy porch song did not finish','Music · the music engine stopped. Nothing was lost.',('Try again',1)),
sc('attn','circle-alert','Not enough storage for Voice: Clover','Download · free up space, then it continues',('Free up space',1),'NEEDS A LOOK'),
sc('done','heart','Slow Morning is ready','Music · added to your Library',('Open',1))]
sec=lambda t:f'<div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin:20px 4px 10px">{t}</div>'
def sc_phone(card): return card
body=f'''<div class="scroll">{hdr("chevron-left","Activity","")}<h1 class="t" style="margin-top:12px">Activity</h1>{sec("NEEDS A LOOK")}<div style="display:flex;flex-direction:column;gap:10px">{cards[2].replace("align-items:center;padding:14px 16px","align-items:flex-start;padding:14px 14px;gap:12px")}{cards[3]}</div>{sec("IN PROGRESS")}<div style="display:flex;flex-direction:column;gap:10px">{cards[0]}{cards[1]}</div>{sec("DONE")}{cards[4]}</div>
{tabbar("Library",(('house','Home'),('message-circle','Chat'),('play','Media'),('library','Library'),('search','Search')))}'''
write('phone-status-stack',phone(body))
inner=f'''{rail("Library")}{col("LIBRARY",[("folder","All files"),("image","Pictures"),("film","Videos"),("music","Songs"),("clock","Activity")],"Activity")}<div class="panel" style="left:304px"><div class="hdr"><div class="ttl">Activity</div><div class="btns"><div class="circ glass" style="width:40px;height:40px">{ic("bell",19,1.9)}</div>{companion(38)}</div></div>
<div style="padding:0 36px;max-width:820px"><h1 style="font-size:44px;font-weight:700;letter-spacing:-.03em">Activity</h1>{sec("NEEDS A LOOK")}<div style="display:flex;flex-direction:column;gap:12px">{cards[2]}{cards[3]}</div>{sec("IN PROGRESS")}<div style="display:flex;flex-direction:column;gap:12px">{cards[0]}{cards[1]}</div>{sec("DONE TODAY")}<div style="display:flex;flex-direction:column;gap:12px">{cards[4]}</div></div></div>'''
write('desktop-status-stack',win(inner))


# ---- Activity entry with the S1 status-dot vocabulary
def adot(kind):
    if kind=='run': return f'<span style="margin-left:auto;position:relative;width:14px;height:14px;display:inline-block"><i style="position:absolute;inset:0;border-radius:50%;background:{LIME};opacity:.35;animation:pulse 1.6s ease-out infinite"></i><i style="position:absolute;inset:3px;border-radius:50%;background:{LIME}"></i></span>'
    if kind=='attn': return '<i style="display:block;width:9px;height:9px;border-radius:50%;background:#ffb547;margin-left:auto"></i>'
    if kind=='done': return '<i style="display:block;width:9px;height:9px;border-radius:50%;background:var(--accent);margin-left:auto"></i>'
    return ''
def arow(kind,label,note):
    return f'<div style="display:flex;align-items:center;gap:14px;height:56px;border-radius:16px;padding:0 16px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair)">{ic("clock",22,1.8)}<div style="flex:1"><b style="font-size:16px">Activity</b><div style="font-size:12px;color:var(--fg2)">{note}</div></div>{adot(kind)}</div>'
rows=''.join(f'<div><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin:0 0 8px">{l}</div>{arow(k,"",n)}</div>' for k,l,n in [("none","NOTHING GOING ON","Nothing is waiting"),("run","SOMETHING IS RUNNING","Pulsing ring, 2 making now"),("attn","NEEDS A LOOK","Steady amber dot, 1 could not finish"),("done","FINISHED, NOT OPENED YET","Steady teal dot, clears when opened")])
inner=f'''<style>@keyframes pulse{{0%{{transform:scale(.6);opacity:.55}}100%{{transform:scale(1.7);opacity:0}}}}@media (prefers-reduced-motion:reduce){{i{{animation:none!important}}}}</style><div style="padding:34px 40px;display:grid;grid-template-columns:420px 1fr;gap:56px;height:900px;background:var(--s0)">
<div style="display:flex;flex-direction:column;gap:18px"><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3)">THE ACTIVITY ENTRY, FOUR STATES (S1 status dots)</div>{rows}</div>
<div style="font-size:16px;line-height:1.75;color:var(--fg2);max-width:620px"><b style="color:#fff;font-size:20px">How it behaves</b><br><br>Idle: no dot.<br>Running: a lime ring pulses softly (1.6 s, off when the person asks for less motion). The page behind it shows the cards, ring and percent.<br>Needs a look: a steady amber dot. Beats the others in color.<br>Finished: a steady teal dot until the result is opened, then it clears.<br>The dot never carries a number; the page shows the count. The companion avatar still shows no badge (S2).<br>Same dot sits on the Activity item in the drawer and in the labelled rail; the colors are tokens in every Look.</div></div>'''
write('activity-indicator',win(inner))
body=f'''<div class="scroll">{hdr("panel-left",None,"")}<div style="font-size:13px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin-top:12px">SUNDAY, NOVEMBER 8</div><h1 class="t" style="margin-top:2px">Today</h1>{chips(["Top stories","My mix"])}</div>{tabbar("Today",(('house','Today'),('sparkles','My Mix'),('heart','Following'),('bookmark','Saved'),('search','Search')))}
<div style="position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:80"></div>
<div style="position:absolute;left:0;top:0;bottom:0;width:318px;z-index:90;background:var(--s1);box-shadow:20px 0 60px rgba(0,0,0,.5),inset -1px 0 0 var(--hair);padding:64px 14px 20px;display:flex;flex-direction:column"><style>@keyframes pulse{{0%{{transform:scale(.6);opacity:.55}}100%{{transform:scale(1.7);opacity:0}}}}</style>
<div style="display:flex;align-items:center;gap:10px;padding:0 6px 12px"><div style="width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#2fd4c0,#4aa3ff);display:flex;align-items:center;justify-content:center">{ic("sparkles",20,2)}</div><b style="font-size:18px;letter-spacing:-.02em">MaiPai</b></div>
<div class="glass" style="height:46px;border-radius:999px;display:flex;align-items:center;gap:10px;padding:0 16px;color:var(--fg3);font-size:16px;margin-bottom:4px">{ic("search",19,1.8)}Search</div>
{dh("APPS")}{dli("house","Home")}{dli("message-circle","Chat",False,"#46d983")}{dli("library","Library")}{dli("users","Family")}{dli("play","Media")}{dli("newspaper","News",True)}{dli("music","Music")}{dli("grid-2x2","All apps")}
{dh("YOU")}<div style="display:flex;align-items:center;gap:14px;height:46px;border-radius:14px;padding:0 14px;font-size:16px;font-weight:600;color:#fff">{ic("clock",22,1.8)}Activity{adot("run")}</div>
<div style="margin-top:auto;display:flex;align-items:center;gap:12px;padding:10px;border-radius:16px;background:var(--s2)"><div class="av" style="width:38px;height:38px;background:linear-gradient(135deg,#7a6bff,#4aa3ff);display:flex;align-items:center;justify-content:center;font-weight:700">S</div><div><b style="font-size:15px">Sage</b><div style="font-size:12px;color:var(--fg2)">Profile, notifications, help</div></div><span style="margin-left:auto;color:var(--fg2)">{ic("settings",22,1.8)}</span></div></div>'''
write('phone-drawer-activity',phone(body))


# ============ remaining screens
def toggle(on=True):
    return f'<div style="width:46px;height:28px;border-radius:14px;background:{"var(--accent)" if on else "var(--s3)"};position:relative;flex:none"><i style="position:absolute;top:3px;{"right" if on else "left"}:3px;width:22px;height:22px;border-radius:50%;background:#fff"></i></div>'
def srow(t,d,ctl,wide=False):
    if wide:
        return f'<div style="padding:14px 0;border-top:1px solid var(--hair)"><div style="font-size:16px;font-weight:600">{t}</div><div style="font-size:14px;color:var(--fg2);margin-top:2px">{d}</div><div style="margin-top:14px">{ctl}</div></div>'
    return f'<div style="display:flex;align-items:center;gap:16px;min-height:60px;padding:10px 0;border-top:1px solid var(--hair)"><div style="flex:1;min-width:200px"><div style="font-size:16px;font-weight:600">{t}</div><div style="font-size:14px;color:var(--fg2);margin-top:2px">{d}</div></div>{ctl}</div>'
def sel(v): return f'<span class="pill q" style="height:38px;font-size:14px">{v}{ic("chevron-right",15,2)}</span>'
# desktop settings
grp=''.join(f'<div class="li {"on" if l=="Look and ease" else ""}">{ic(i,20,1.8)}{l}</div>' for i,l in [("users","Profile and sign-in"),("sun","Look and ease"),("message-circle","Chat and AI"),("mic","Voice and robot"),("bell","Notifications"),("image","Pictures and videos"),("folder","Your data and apps")])
look=''.join(f'<div style="text-align:center"><div class="tile" style="width:84px;height:84px;border-radius:18px;{A(k,sd)}{"box-shadow:0 0 0 2.5px var(--fg);" if n=="Navy" else ""}"></div><div style="font-size:13px;font-weight:600;margin-top:7px">{n}</div></div>' for n,k,sd in [("Neutral","slate",201),("Stone","sand",202),("Zinc","ocean",203),("Mauve","violet",204),("Olive","forest",205),("Navy","ocean",206)])
inner=f'''{rail("Home")}<div class="col" style="left:56px;width:268px"><h4 style="margin-top:6px">SETTINGS</h4><div class="glass" style="height:42px;border-radius:999px;display:flex;align-items:center;gap:10px;padding:0 14px;color:var(--fg3);font-size:15px;margin-bottom:6px">{ic("search",18,1.8)}Search settings</div><h4>YOURS</h4>{grp}</div>
<div class="panel" style="left:324px"><div class="hdr"><div class="ttl">Settings</div><div class="btns">{companion(38)}</div></div><div style="padding:0 40px;max-width:760px"><h1 style="font-size:40px;font-weight:700;letter-spacing:-.03em">Look and ease</h1><div style="color:var(--fg2);font-size:16px;margin-top:4px">How MaiPai looks and reads for you. Only you.</div>
<div class="card" style="margin-top:22px;padding:18px 22px;border-radius:20px"><b style="font-size:20px">Theme</b>{srow("Appearance","Light, dark, or follow this device",sel("Auto"))}{srow("Look","The color set for every screen",f'<div style="display:flex;gap:14px">{look}</div>',True)}</div>
<div class="card" style="margin-top:18px;padding:18px 22px;border-radius:20px"><b style="font-size:20px">Reading</b>{srow("Text size","Makes text bigger everywhere",sel("Standard"))}{srow("Larger buttons","Easier to tap",toggle(False))}{srow("Reduce motion","Fewer animations",toggle(True))}</div></div></div>'''
write('desktop-settings',win(inner))
# phone settings
body=f'''<div class="scroll">{hdr("chevron-left","Settings","")}<h1 class="t" style="margin-top:12px">Look and ease</h1><div style="color:var(--fg2);font-size:15px;margin-top:4px">How MaiPai looks and reads for you.</div>
<div class="card" style="margin-top:18px;padding:6px 16px;border-radius:20px">{srow("Appearance","Light, dark, or auto",sel("Auto")).replace("border-top:1px solid var(--hair)","")}{srow("Text size","Bigger text everywhere",sel("Standard"))}{srow("Larger buttons","Easier to tap",toggle(False))}{srow("Reduce motion","Fewer animations",toggle(True))}</div>
<div class="sh"><h2>Look</h2></div><div class="strip">{look}</div></div>{tabbar("Settings",(('house','Home'),('message-circle','Chat'),('play','Media'),('library','Library'),('settings','Settings')))}'''
write('phone-settings',phone(body))
# desktop family / person
def pc(n,r,g,st=None):
    return f'<div class="card" style="padding:16px;border-radius:20px;display:flex;gap:14px;align-items:center"><div class="av" style="width:56px;height:56px;background:{g}"></div><div style="flex:1"><b style="font-size:17px">{n}</b><div style="font-size:14px;color:var(--fg2)">{r}</div></div>{ic("chevron-right",20,2)}</div>'
inner=f'''{rail("Family")}{col("FAMILY",[("users","People"),("sparkles","Companions"),("lock","Safety"),("clock","Activity")],"People")}<div class="panel" style="left:304px"><div class="glow"></div><div class="hdr"><div class="ttl">Family</div><div class="btns"><span class="pill inv" style="height:38px;font-size:14px">{ic("plus",16,2.2)}Add person</span>{companion(38)}</div></div><div style="padding:0 36px;position:relative">
<div style="display:flex;gap:26px;align-items:flex-end;margin-top:6px"><div class="av" style="width:120px;height:120px;background:linear-gradient(135deg,#ffb547,#ff5f7e)"></div><div><div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:var(--fg3)">OWNER</div><h1 style="font-size:52px;font-weight:800;letter-spacing:-.035em;line-height:1.05">Sage</h1><div style="display:flex;gap:26px;margin-top:10px;font-size:15px;color:var(--fg2)"><span><b style="color:#fff;font-size:20px">212</b> songs</span><span><b style="color:#fff;font-size:20px">48</b> videos</span><span><b style="color:#fff;font-size:20px">1,204</b> pictures</span></div></div></div>
<div class="sh" style="margin:30px 0 12px"><h2>People</h2><a>Manage {ic("chevron-right",16,2)}</a></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">{pc("Marlow","Teen","linear-gradient(135deg,#2fd4c0,#4aa3ff)")}{pc("Nova","Child","linear-gradient(135deg,#b48cff,#ff4fa8)")}{pc("Tessa","Companion","radial-gradient(circle at 35% 28%,#ffd9a0,#ff9a3c 70%)")}</div>
<div class="sh" style="margin:28px 0 12px"><h2>Companions</h2><a>See All {ic("chevron-right",16,2)}</a></div><div class="strip" style="margin-right:-36px">{tile("Tessa","Warm, curious","ember",211,176,176)}{tile("Rover","Playful","ocean",212,176,176)}{tile("Sprout","Calm","forest",213,176,176)}</div></div></div>'''
write('desktop-family',win(inner))
# phone weather
hours=''.join(f'<div style="text-align:center;width:60px;flex:none"><div style="font-size:13px;color:var(--fg2)">{h}</div><div style="margin:8px 0">{ic(i,24,1.7)}</div><b style="font-size:16px">{t}</b></div>' for h,i,t in [("Now","cloud-rain","52°"),("6 PM","cloud-rain","51°"),("7 PM","cloud-rain","49°"),("8 PM","cloud-rain","48°"),("9 PM","sun","47°"),("10 PM","sun","46°")])
days=''.join(f'<div style="display:flex;align-items:center;height:48px;border-top:1px solid var(--hair);font-size:16px"><span style="width:90px;font-weight:600">{d}</span>{ic(i,22,1.7)}<span style="margin-left:auto;color:var(--fg2)">{lo}°</span><span style="width:60px;text-align:right;font-weight:600">{hi}°</span></div>' for d,i,lo,hi in [("Today","cloud-rain",43,56),("Mon","cloud-rain",44,55),("Tue","sun",41,58),("Wed","sun",40,60),("Thu","cloud-rain",45,54)])
body=f'''<div class="scroll">{hdr("panel-left","Weather",f'<div class="circ glass">{ic("search",20,1.9)}</div>')}
<div class="tile" style="height:300px;margin-top:14px;border-radius:26px;background:linear-gradient(165deg,#24406b,#0b1424 85%);padding:22px;color:#fff"><svg style="position:absolute;inset:0" width="100%" height="100%">{"".join(f'<line x1="{x}" y1="{y}" x2="{x-8}" y2="{y+30}" stroke="#bcd3ff" stroke-opacity=".3" stroke-width="1.4"/>' for x,y in [(40,20),(110,90),(180,30),(250,110),(320,50),(80,160),(200,190),(330,170),(150,70),(270,200),(60,240)])}</svg><div style="position:relative;font-size:13px;letter-spacing:.14em;font-weight:600;color:var(--fg2)">SEATTLE</div><div style="position:relative;font-size:96px;font-weight:200;letter-spacing:-.05em;line-height:1;margin-top:18px">52°</div><div style="position:relative;display:flex;gap:8px;align-items:center;font-size:18px;font-weight:600;margin-top:6px">{ic("cloud-rain",22,1.8)}Rainy</div><div style="position:relative;color:var(--fg2);font-size:15px;margin-top:4px">H 56° L 43° · Take a jacket and an umbrella</div></div>
<div class="card" style="margin-top:14px;padding:16px;border-radius:22px"><div style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--fg3);margin-bottom:12px">HOURLY</div><div style="display:flex;gap:6px;overflow:hidden">{hours}</div></div>
<div class="card" style="margin-top:14px;padding:6px 16px;border-radius:22px">{days}</div></div>{tabbar("Today",(('house','Today'),('clock','Hourly'),('grid-2x2','Places'),('settings','Settings')))}'''
write('phone-weather',phone(body))
# phone reminders / clock
def rem(t,when,done=False,tag=None):
    c=f'<div style="width:26px;height:26px;border-radius:50%;{"background:var(--accent);display:flex;align-items:center;justify-content:center;color:#04201c" if done else "box-shadow:inset 0 0 0 2px var(--fg3)"}">{ic("star",14,2.6,"currentColor") if False else ""}</div>'
    return f'<div style="display:flex;align-items:center;gap:14px;height:68px;border-radius:18px;padding:0 14px;background:var(--s1);margin-bottom:8px">{c}<div style="flex:1"><b style="font-size:17px;font-weight:600;{"text-decoration:line-through;color:var(--fg3)" if done else ""}">{t}</b><div style="font-size:14px;color:var(--fg2);margin-top:2px">{when}</div></div>{ic("ellipsis",22,2)}</div>'
body=f'''<div class="scroll">{hdr("panel-left","Reminders",f'<div class="circ glass">{ic("plus",22,2)}</div>')}<h1 class="t" style="margin-top:12px">Reminders</h1>{chips(["Today","Soon","Lists","Done"])}
<div class="sh" style="margin-top:20px"><h2>Today</h2><a>3 left</a></div>{rem("Soccer practice bag","4:00 PM · Nova")}{rem("Call the plumber","5:30 PM · Sage")}{rem("Take out recycling","8:00 PM · Home")}
<div class="sh"><h2>Alarms and timers</h2><a>See All {ic("chevron-right",16,2)}</a></div><div class="card" style="padding:16px;border-radius:22px;display:flex;align-items:center;gap:14px"><div style="font-size:44px;font-weight:200;letter-spacing:-.03em">6:45</div><div style="flex:1"><b>Weekdays</b><div style="font-size:14px;color:var(--fg2)">Wake up</div></div>{toggle(True)}</div>
</div>{tabbar("Reminders",(('house','Home'),('clock','Reminders'),('list-plus','Lists'),('clock','Clock'),('search','Search')))}'''
write('phone-reminders',phone(body))
# sign-in (desktop)
tiles=''.join(f'<div style="text-align:center"><div class="av" style="width:104px;height:104px;background:{g};box-shadow:{"0 0 0 3px var(--s0),0 0 0 6px var(--accent)" if n=="Sage" else "none"}"></div><div style="font-size:16px;font-weight:600;margin-top:12px">{n}</div></div>' for n,g in [("Sage","linear-gradient(135deg,#ffb547,#ff5f7e)"),("Marlow","linear-gradient(135deg,#2fd4c0,#4aa3ff)"),("Nova","linear-gradient(135deg,#b48cff,#ff4fa8)")])
inner=f'''<div style="position:absolute;inset:0;background:radial-gradient(800px 500px at 50% 0,rgba(47,212,192,.14),transparent 70%),var(--s0);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px"><div style="display:flex;align-items:center;gap:12px"><div style="width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#2fd4c0,#4aa3ff);display:flex;align-items:center;justify-content:center">{ic("sparkles",26,2)}</div><b style="font-size:32px;letter-spacing:-.03em">MaiPai Home</b></div><div style="font-size:20px;color:var(--fg2)">Who is signing in?</div><div style="display:flex;gap:48px">{tiles}</div><div class="ask" style="width:380px;justify-content:space-between"><span>Secret for Sage</span><span class="pill inv" style="height:40px;font-size:15px">Sign in</span></div></div>'''
write('desktop-signin',win(inner))
# phone sign-in
body=f'''<div style="position:absolute;inset:0;background:radial-gradient(500px 340px at 50% 0,rgba(47,212,192,.16),transparent 70%);padding:120px 24px 0;text-align:center"><div style="display:inline-flex;align-items:center;gap:10px"><div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#2fd4c0,#4aa3ff);display:flex;align-items:center;justify-content:center">{ic("sparkles",22,2)}</div><b style="font-size:26px;letter-spacing:-.03em">MaiPai Home</b></div><h1 class="t" style="margin-top:36px;font-size:30px">Who is signing in?</h1><div style="display:flex;justify-content:center;gap:22px;margin-top:34px">{tiles.replace("104px","84px")}</div><div class="ask" style="margin-top:44px;height:54px"><span style="flex:1;text-align:left">Secret for Sage</span><span class="pill inv" style="height:38px;font-size:14px">{ic("arrow-up",18,2.4)}</span></div></div>'''
write('phone-signin',phone(body))
# desktop setup wizard
def step(n,t,on,done=False):
    c=f'<div style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;{"background:var(--accent);color:#04201c" if (on or done) else "background:var(--s2);color:var(--fg2)"}">{n}</div>'
    return f'<div style="display:flex;align-items:center;gap:12px;font-size:15px;font-weight:600;color:{"#fff" if on else "var(--fg2)"}">{c}{t}</div>'
steps=''.join(step(n,t,n==3,n<3) for n,t in [(1,"Welcome"),(2,"Your home"),(3,"Get the AI ready"),(4,"Checks"),(5,"Done")])
inner=f'''<div style="position:absolute;inset:0;background:radial-gradient(900px 500px at 70% 0,rgba(122,107,255,.14),transparent 70%),var(--s0);padding:56px 90px"><div style="display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#2fd4c0,#4aa3ff);display:flex;align-items:center;justify-content:center">{ic("sparkles",22,2)}</div><b style="font-size:22px">MaiPai setup</b></div>
<div style="display:flex;gap:34px;margin-top:40px;align-items:center">{steps}</div>
<h1 style="font-size:44px;font-weight:700;letter-spacing:-.03em;margin-top:44px">Getting the AI ready</h1><div style="color:var(--fg2);font-size:18px;margin-top:6px;max-width:640px">MaiPai downloads its own models so everything stays in your home. This takes a few minutes.</div>
<div style="display:flex;flex-direction:column;gap:12px;margin-top:30px;max-width:760px">{dl('run','Chat model','3.0 of 4.8 GB · about 4 minutes',62,'Pause')}{dl('queue','Voice: Clover','1.1 GB · after the chat model',0,'Cancel')}{dl('done','Safety checks','Ready',100,'Open')}</div>
<div style="position:absolute;right:90px;bottom:48px;display:flex;gap:12px"><span class="pill q" style="height:48px">Back</span><span class="pill inv" style="height:48px;padding:0 28px">Continue</span></div></div>'''
write('desktop-setup',win(inner))
# phone notifications (bell list)
body=f'''<div class="scroll">{hdr("chevron-left","Notifications","")}<h1 class="t" style="margin-top:12px">Notifications</h1>
<div style="display:flex;flex-direction:column;gap:10px;margin-top:18px">{sc('done','music','Rainy porch song is ready','Music · just now',('Open',1),'DONE')}{sc('problem','circle-alert','Your video did not finish','Video · 12 min ago. Nothing was lost.',('Try again',1),'COULD NOT FINISH')}{sc('attn','users','Marlow asked to make a video','2 hours ago',('Review',1),'NEEDS YOUR OK')}{sc('info','sparkles','Weekly summary is ready','Yesterday',('Open',0),'GOOD TO KNOW')}</div></div>{tabbar("Home",(('house','Home'),('message-circle','Chat'),('play','Media'),('library','Library'),('search','Search')))}'''
write('phone-notifications',phone(body))
print('create ok')

# ---------- PROFILE + FAMILY (Instagram / TikTok style profile pages) 2026-11-08
GR={'Sage':'linear-gradient(135deg,#ffb547,#ff5f7e)','Marlow':'linear-gradient(135deg,#2fd4c0,#4aa3ff)','Nova':'linear-gradient(135deg,#b48cff,#ff4fa8)','Clover':'radial-gradient(circle at 35% 28%,#ffd9a0,#ff9a3c 70%)'}
def pav(n,size,ring=False):
    return f'<div class="av {"ring" if ring else ""}" style="width:{size}px;height:{size}px;background:{GR[n]}"></div>'
def stat(n,l,big=False):
    return f'<div style="text-align:left"><div style="font-size:{26 if big else 22}px;font-weight:700;letter-spacing:-.02em">{n}</div><div style="font-size:{15 if big else 14}px;color:var(--fg2)">{l}</div></div>'
KEYS=['teal','ember','violet','forest','rose','ocean','sand','slate']
def gtile(i,kind,w=None):
    k=KEYS[i%8]; badge={'v':ic('play',16,2,'currentColor'),'m':ic('music',16,2),'':''}[kind]
    b=f'<div style="position:absolute;top:8px;right:8px;color:#fff;z-index:2">{badge}</div>' if badge else ''
    sh=['sun','rings','wave',None][i%4]
    return f'<div style="position:relative;aspect-ratio:1/1;{A(k,100+i,shape=sh)}">{b}</div>'
def hl(label,k,sd,size=64):
    return f'<div style="text-align:center;width:{size+16}px;flex:none"><div style="width:{size}px;height:{size}px;border-radius:50%;margin:0 auto;padding:3px;background:var(--s3)"><div style="width:100%;height:100%;border-radius:50%;{A(k,sd)}"></div></div><div style="font-size:13px;margin-top:7px;color:var(--fg2)">{label}</div></div>'
kinds=['','v','','m','','v','m','','','v','','m']
grid=lambda cols,n: f'<div style="display:grid;grid-template-columns:repeat({cols},1fr);gap:2px">'+''.join(gtile(i,kinds[i%12]) for i in range(n))+'</div>'
tabs=lambda ic_list,on=0,pad=0: '<div style="display:flex;border-bottom:1px solid var(--hair);margin-top:18px">'+''.join(f'<div style="flex:1;height:48px;display:flex;align-items:center;justify-content:center;color:{"#fff" if i==on else "var(--fg3)"};{"box-shadow:inset 0 -2px 0 #fff" if i==on else ""}">{ic(n,24,1.8)}</div>' for i,n in enumerate(ic_list))+'</div>'
# phone profile
body=f'''<div class="scroll" style="padding-bottom:110px"><div style="display:flex;justify-content:space-between;align-items:center;height:44px"><div class="circ glass">{ic("chevron-left",24,2.2)}</div><div style="font-weight:700;font-size:20px">Marlow</div><div class="circ glass">{ic("ellipsis",22,2)}</div></div>
<div style="display:flex;gap:22px;align-items:center;margin-top:14px">{pav("Marlow",92,True)}<div style="flex:1"><div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:var(--fg3)">TEEN</div><div style="display:flex;justify-content:space-between;margin-top:8px">{stat("14","songs")}{stat("9","videos")}{stat("62","pictures")}</div></div></div>
<div style="margin-top:14px;font-size:15px;color:var(--fg2);line-height:1.4">Makes beats after school. Likes rainy porch songs and slow mornings.</div>
<div style="display:flex;gap:10px;margin-top:16px"><div class="pill inv" style="flex:1;justify-content:center;height:44px;font-size:16px">Edit profile</div><div class="pill q" style="flex:1;justify-content:center;height:44px;font-size:16px">Share</div><div class="pill q" style="width:48px;height:44px;justify-content:center;padding:0">{ic("settings",20,1.9)}</div></div>
<div class="strip" style="margin-top:20px;gap:6px">{hl("Clover","ember",301)}{hl("Favorites","violet",302)}{hl("Porch","forest",303)}{hl("School","ocean",304)}{hl("New","slate",305)}</div>
{tabs(["grid-2x2","play","music","users"],0)}
<div style="margin:0 -16px">{grid(3,12)}</div></div>{tabbar("Family",(('house','Home'),('message-circle','Chat'),('play','Media'),('library','Library'),('users','Family')))}'''
write('phone-profile',phone(body))
# phone family (the household page)
def fcard(n,role,stats,k,sd):
    return f'<div style="background:var(--s1);box-shadow:inset 0 0 0 1px var(--hair);padding:14px;border-radius:22px;display:flex;gap:14px;align-items:center;margin-bottom:10px">{pav(n,64,n=="Sage")}<div style="flex:1;min-width:0"><b style="font-size:18px">{n}</b><div style="font-size:14px;color:var(--fg2);margin-top:2px">{role} · {stats}</div></div>{ic("chevron-right",20,2)}</div>'
body=f'''<div class="scroll" style="padding-bottom:110px"><div style="display:flex;justify-content:space-between;align-items:center;height:44px"><div class="circ glass">{ic("panel-left",22,1.8)}</div><div style="display:flex;gap:10px;align-items:center"><div class="circ glass">{ic("plus",22,2)}</div>{companion(36)}</div></div>
<h1 class="t" style="margin-top:14px">Family</h1><div style="color:var(--fg2);font-size:16px;margin-top:4px">4 people · 3 companions</div>
<div class="strip" style="margin-top:20px;gap:8px;padding:4px 0 4px 4px">{"".join(f'<div style="text-align:center;width:84px;flex:none">{pav(n,68,n=="Sage")}<div style="font-size:14px;font-weight:600;margin-top:8px">{n}</div></div>' for n in ["Sage","Marlow","Nova"])}<div style="text-align:center;width:84px;flex:none"><div class="av" style="width:68px;height:68px;background:var(--s2);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px var(--hair)">{ic("plus",26,1.8)}</div><div style="font-size:14px;font-weight:600;margin-top:8px;color:var(--fg2)">Add</div></div></div>
<div class="sh"><h2>People</h2><a>Manage {ic("chevron-right",16,2)}</a></div>{fcard("Sage","Owner","112 songs","ember",1)}{fcard("Marlow","Teen","14 songs","teal",2)}{fcard("Nova","Child","6 videos","violet",3)}
<div class="sh"><h2>Companions</h2><a>See All {ic("chevron-right",16,2)}</a></div><div class="strip">{tile("Tessa","Warm, curious","ember",211,156,156)}{tile("Rover","Playful","ocean",212,156,156)}{tile("Sprout","Calm","forest",213,156,156)}</div>
<div class="sh"><h2>Shared with everyone</h2><a>See All {ic("chevron-right",16,2)}</a></div><div style="margin:0 -16px">{grid(3,6)}</div></div>{tabbar("Family",(('house','Home'),('message-circle','Chat'),('play','Media'),('library','Library'),('users','Family')))}'''
write('phone-family',phone(body))
# desktop profile
inner=f'''{rail("Family")}{col("FAMILY",[("users","People"),("sparkles","Companions"),("lock","Safety"),("clock","Activity")],"People")}<div class="panel" style="left:304px"><div class="glow"></div><div class="hdr"><div style="display:flex;align-items:center;gap:12px"><div class="circ glass" style="width:38px;height:38px">{ic("chevron-left",22,2.2)}</div><div class="ttl">Marlow</div></div><div class="btns">{companion(38)}</div></div>
<div style="padding:8px 44px 0;overflow:hidden;position:absolute;top:68px;left:0;right:0;bottom:0"><div style="display:flex;gap:44px;align-items:center">{pav("Marlow",168,True)}<div style="flex:1"><div style="display:flex;align-items:center;gap:16px"><h1 style="font-size:44px;font-weight:800;letter-spacing:-.03em">Marlow</h1><span class="pill q" style="height:30px;font-size:12px;letter-spacing:.1em">TEEN</span></div>
<div style="display:flex;gap:44px;margin-top:14px">{stat("14","songs",True)}{stat("9","videos",True)}{stat("62","pictures",True)}</div>
<div style="margin-top:14px;font-size:16px;color:var(--fg2);max-width:560px;line-height:1.45">Makes beats after school. Likes rainy porch songs and slow mornings.</div>
<div style="display:flex;gap:10px;margin-top:18px"><span class="pill inv" style="height:44px;padding:0 24px">Edit profile</span><span class="pill q" style="height:44px;padding:0 24px">Share</span><span class="pill q" style="height:44px;width:48px;justify-content:center;padding:0">{ic("settings",20,1.9)}</span></div></div></div>
<div style="display:flex;gap:10px;margin-top:26px">{hl("Clover","ember",301,72)}{hl("Favorites","violet",302,72)}{hl("Porch","forest",303,72)}{hl("School","ocean",304,72)}</div>
{tabs(["grid-2x2","play","music","users"],0)}
<div style="margin-top:3px;width:100%">{grid(5,10)}</div></div></div>'''
write('desktop-profile',win(inner))
print('profile ok')

# ---------- FAMILY v2: companions live under the member who has them; pets and robots are family (2026-11-08)
GR['Bruno']='linear-gradient(135deg,#d9a35b,#8a5a2b)'; GR['Rover']='linear-gradient(135deg,#9fb4d6,#4b5f86)'; GR['Ember']='radial-gradient(circle at 35% 28%,#bfe8ff,#6a86ff 70%)'
PAW='<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="currentColor"><ellipse cx="6" cy="11" rx="2" ry="2.6"/><ellipse cx="10" cy="6.5" rx="2" ry="2.6"/><ellipse cx="14" cy="6.5" rx="2" ry="2.6"/><ellipse cx="18" cy="11" rx="2" ry="2.6"/><path d="M12 12c-3 0-5.5 2.6-5.5 5 0 1.6 1.3 2.5 2.7 2.5 1 0 1.7-.5 2.8-.5s1.8.5 2.8.5c1.4 0 2.7-.9 2.7-2.5 0-2.4-2.5-5-5.5-5z"/></svg>'
BOT='<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M2 13v2M22 13v2"/></svg>'
def kindav(n,kind,size):
    glyph=(PAW if kind=='pet' else BOT).format(s=int(size*.46))
    return f'<div class="av" style="width:{size}px;height:{size}px;background:{GR[n]};display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.92)">{glyph}</div>'
def cchip(n,sz=34):
    return f'<div style="display:flex;align-items:center;gap:8px;height:44px;border-radius:999px;padding:0 14px 0 5px;background:var(--s2);box-shadow:inset 0 0 0 1px var(--hair);font-size:14px;font-weight:600;flex:none"><div class="av" style="width:{sz}px;height:{sz}px;background:{GR[n]}"></div>{n}</div>'
def addc(): return f'<div style="display:flex;align-items:center;gap:6px;height:44px;border-radius:999px;padding:0 14px;color:var(--fg2);font-size:14px;font-weight:600;box-shadow:inset 0 0 0 1px var(--hair);flex:none">{ic("plus",16,2)}Companion</div>'
def member(n,role,stat,comps,ring=False,kind=None,wide=False):
    av=kindav(n,kind,64) if kind else pav(n,64,ring)
    cs=''.join(cchip(c) for c in comps)+(addc() if not kind else '')
    if kind and not comps: cs=''
    cr=f'<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">{cs}</div>' if cs else ''
    return f'<div style="background:var(--s1);box-shadow:inset 0 0 0 1px var(--hair);padding:14px;border-radius:22px;margin-bottom:10px"><div style="display:flex;gap:14px;align-items:center">{av}<div style="flex:1;min-width:0"><b style="font-size:18px">{n}</b><div style="font-size:14px;color:var(--fg2);margin-top:2px">{role} · {stat}</div></div>{ic("chevron-right",20,2)}</div>{cr}</div>'
TAB=(('house','Home'),('message-circle','Chat'),('play','Media'),('library','Library'),('users','Family'))
body=f'''<div class="scroll" style="padding-bottom:110px"><div style="display:flex;justify-content:space-between;align-items:center;height:44px"><div class="circ glass">{ic("panel-left",22,1.8)}</div><div style="display:flex;gap:10px;align-items:center"><div class="circ glass">{ic("plus",22,2)}</div>{companion(36)}</div></div>
<h1 class="t" style="margin-top:14px">Family</h1><div style="color:var(--fg2);font-size:16px;margin-top:4px">3 people · 1 pet · 1 robot · 2 companions</div>
<div class="strip" style="margin-top:20px;gap:8px;padding:4px 0 4px 4px">{"".join(f'<div style="text-align:center;width:84px;flex:none">{pav(n,68,n=="Sage")}<div style="font-size:14px;font-weight:600;margin-top:8px">{n}</div></div>' for n in ["Sage","Marlow","Nova"])}<div style="text-align:center;width:84px;flex:none">{kindav("Bruno","pet",68)}<div style="font-size:14px;font-weight:600;margin-top:8px">Bruno</div></div><div style="text-align:center;width:84px;flex:none">{kindav("Rover","bot",68)}<div style="font-size:14px;font-weight:600;margin-top:8px">Rover</div></div></div>
<div class="sh"><h2>People</h2><a>Manage {ic("chevron-right",16,2)}</a></div>{member("Sage","Owner","112 songs",["Clover"],True)}{member("Marlow","Teen","14 songs",["Ember"])}{member("Nova","Child","6 videos",[])}
<div class="sh"><h2>Pets and robots</h2><a>Add {ic("plus",16,2)}</a></div>{member("Bruno","Dog","lives with everyone",[],kind="pet")}{member("Rover","Robot","online · living room",[],kind="bot")}</div>{tabbar("Family",TAB)}'''
write('phone-family',phone(body))
def dmember(n,role,stat,comps,ring=False,kind=None):
    av=kindav(n,kind,72) if kind else pav(n,72,ring)
    cs=''.join(cchip(c) for c in comps)+(addc() if not kind else '')
    return f'<div class="card" style="padding:18px;border-radius:22px"><div style="display:flex;gap:16px;align-items:center">{av}<div style="flex:1"><b style="font-size:19px">{n}</b><div style="font-size:14px;color:var(--fg2);margin-top:2px">{role} · {stat}</div></div>{ic("chevron-right",20,2)}</div>'+(f'<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">{cs}</div>' if (cs and not kind) else '')+'</div>'
inner=f'''{rail("Family")}{col("FAMILY",[("users","People"),("lock","Safety"),("clock","Activity")],"People")}<div class="panel" style="left:304px"><div class="glow"></div><div class="hdr"><div class="ttl">Family</div><div class="btns"><span class="pill inv" style="height:38px;font-size:14px">{ic("plus",16,2.2)}Add to family</span>{companion(38)}</div></div><div style="padding:0 36px;position:absolute;top:68px;left:0;right:0;bottom:0;overflow:hidden">
<div style="display:flex;gap:26px;align-items:flex-end;margin-top:6px">{pav("Sage",120,True)}<div><div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:var(--fg3)">OWNER</div><h1 style="font-size:52px;font-weight:800;letter-spacing:-.035em;line-height:1.05">Sage</h1><div style="color:var(--fg2);font-size:16px;margin-top:4px">3 people · 1 pet · 1 robot · 2 companions</div></div></div>
<div class="sh" style="margin:28px 0 12px"><h2>People</h2><a>Manage {ic("chevron-right",16,2)}</a></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">{dmember("Sage","Owner","112 songs",["Clover"],True)}{dmember("Marlow","Teen","14 songs",["Ember"])}{dmember("Nova","Child","6 videos",[])}</div>
<div class="sh" style="margin:28px 0 12px"><h2>Pets and robots</h2><a>Add {ic("plus",16,2)}</a></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">{dmember("Bruno","Dog","lives with everyone",[],kind="pet")}{dmember("Rover","Robot","online · living room",[],kind="bot")}</div></div></div>'''
write('desktop-family',win(inner))
print('family v2 ok')
