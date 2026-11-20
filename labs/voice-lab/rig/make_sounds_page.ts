// Builds public/sounds/: six moments, each said twice by the casual voice: once with the real recorded sound spliced in where the tag
// sits (exactly what the lab does live) and once without (what the old lab did: the tag dropped). Order is shuffled; the page key is inside the page.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pickSound } from "../src/sounds";
import { splitTags } from "../src/tags";
const TTS = "http://127.0.0.1:9923", OUT = join(import.meta.dir, "..", "public", "sounds"); mkdirSync(OUT, { recursive: true });
const MOMENTS = [
  { you: "Tell me something funny.", text: "Ha [laugh] okay, that one is actually pretty funny to me.", tag: "laugh" },
  { you: "How was your day?", text: "Oh [sigh] I am so tired today, you have no idea.", tag: "sigh" },
  { you: "You got me with that one.", text: "[chuckle] Okay, okay, you got me there.", tag: "chuckle" },
  { you: "Tell me another one.", text: "Ha [laugh] oh, that one is so bad, okay, here is another one, and this one is even worse.", tag: "laugh" },
  { you: "I have something serious to tell you.", text: "[breath] Okay. Go ahead, I am listening.", tag: "breath" },
  { you: "Guess who just walked in.", text: "Oh [gasp] I did not see that coming at all.", tag: "gasp" },
];
async function say(text: string, voice = "casual"): Promise<Int16Array> {
  const f = new FormData(); f.set("text", text); f.set("voice", voice);
  const b = new Uint8Array(await (await fetch(TTS + "/tts", { method: "POST", body: f })).arrayBuffer());
  return new Int16Array(b.buffer.slice(44, 44 + ((b.length - 44) & ~1)));
}
const rmsOf = (a: Int16Array) => { let s = 0; for (const v of a) s += (v / 32768) ** 2; return Math.sqrt(s / Math.max(1, a.length)); };
function wav(pcm: Int16Array): Uint8Array { const b = new Uint8Array(44 + pcm.length * 2), v = new DataView(b.buffer); const w = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length * 2, true); b.set(new Uint8Array(pcm.buffer), 44); return b; }
const cat = (parts: Int16Array[]) => { const o = new Int16Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { o.set(p, at); at += p.length; } return o; };
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const key: Record<string, string> = {}; let html = "";
for (let m = 0; m < MOMENTS.length; m++) {
  const { you, text, tag } = MOMENTS[m]!; const withParts: Int16Array[] = []; let speechRms = 0.06; let smile = false;
  for (const seg of splitTags(text)) {
    if (seg.type === "tag") { const s = pickSound("casual", seg.value, speechRms, undefined, rnd); if (s) { withParts.push(s); if (seg.value === "laugh" || seg.value === "chuckle") smile = true; } continue; }
    if (!/[a-z]/i.test(seg.value)) continue; const pcm = await say(seg.value, smile ? "casual_mild_happy" : "casual"); speechRms = rmsOf(pcm) || speechRms; withParts.push(pcm);
  }
  const without = await say(text.replace(/\[[^\]]*\]\s*/g, "").trim());
  const order = rnd() < 0.5 ? ["with", "without"] : ["without", "with"];
  html += `<section class="m"><h2>${m + 1}. You say: ${you}</h2><p class="note">She says: ${text.replace(/\[([^\]]*)\]/g, "<i>[$1]</i>")}</p>`;
  order.forEach((kind, i) => { const id = `${m + 1}_${i + 1}`; key[id] = kind; writeFileSync(join(OUT, `${id}.wav`), wav(kind === "with" ? cat(withParts) : without));
    html += `<div class="take" data-id="${id}"><b>Take ${i + 1}</b><audio controls preload="none" src="${id}.wav"></audio><div class="lab">Sounds like a real person talking</div><div class="btns" data-row="p"><button data-v="0">Unacceptable</button><button data-v="1">Bad</button><button data-v="2">OK</button><button data-v="3">Great</button><button data-v="4">Perfect</button></div><div class="lab">The ${tag} sound is believable here</div><div class="btns" data-row="a"><button data-v="0">No sound or fake</button><button data-v="1">Okay</button><button data-v="2">Real</button></div><div class="lab">Still sounds like her</div><div class="btns" data-row="s"><button data-v="0">No</button><button data-v="1">Mostly</button><button data-v="2">Yes</button></div></div>`; });
  html += "</section>";
}
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Real laughs and sighs</title><link rel="stylesheet" href="../style.css"><style>audio{width:100%;height:36px}.m{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px 16px 14px;margin-top:14px}.m h2{font-size:17px;text-transform:none;letter-spacing:0;color:var(--fg);margin:10px 0 2px}.take{border-top:1px solid var(--line);padding:10px 0}.btns{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.btns button{padding:7px 10px;border-radius:10px;font-size:14px}.btns button.on{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700}.lab{font-size:13px;color:var(--muted);margin-top:6px}#result{font-weight:600;white-space:pre-line;user-select:all;margin-top:12px}</style></head><body><main><header><h1>Real laughs and sighs</h1><a href="../index.html">Lab</a></header><p class="note">Six moments, each said twice with the same words, in mixed-up order. One take has a real recorded sound where the tag is (laugh, sigh and so on), the other has none. Tap three things per take. About 5 minutes.</p>${html}<p><button class="primary" id="show">Show my result</button></p><div id="result"></div></main><script>
const K='voice-sounds-v1';let saved={};try{saved=JSON.parse(localStorage.getItem(K)||'{}')}catch{}
const paint=()=>document.querySelectorAll('.take[data-id]').forEach(t=>t.querySelectorAll('.btns').forEach(b=>b.querySelectorAll('button').forEach(x=>x.classList.toggle('on',(saved[t.dataset.id]||{})[b.dataset.row]===+x.dataset.v))));
document.addEventListener('click',e=>{const x=e.target.closest('.btns button');if(!x)return;const t=x.closest('.take'),row=x.closest('.btns').dataset.row,v=+x.dataset.v;saved[t.dataset.id]=saved[t.dataset.id]||{};if(saved[t.dataset.id][row]===v)delete saved[t.dataset.id][row];else saved[t.dataset.id][row]=v;try{localStorage.setItem(K,JSON.stringify(saved))}catch{}paint()});paint();
document.querySelector('#show').onclick=()=>{const key=JSON.parse(atob('${Buffer.from(JSON.stringify(key)).toString("base64")}'));const L={with:'With the real sound',without:'Without'};const acc={};for(const [id,r] of Object.entries(saved)){const k=key[id];acc[k]=acc[k]||{p:[],a:[0,0,0],s:[0,0,0]};if(r.p!==undefined)acc[k].p.push(r.p);if(r.a!==undefined)acc[k].a[r.a]++;if(r.s!==undefined)acc[k].s[r.s]++}
const rows=Object.keys(L).filter(k=>acc[k]).map(k=>{const p=acc[k].p,avg=p.length?(p.reduce((x,y)=>x+y,0)/p.length):NaN;return{k,avg,n:p.length,a:acc[k].a,s:acc[k].s}});
document.querySelector('#result').textContent=rows.length?'Copy this and send it to me:\\n'+rows.map(r=>L[r.k]+': human '+(isNaN(r.avg)?'-':r.avg.toFixed(1))+'/4 ('+r.n+' rated); sound no/fake '+r.a[0]+', okay '+r.a[1]+', real '+r.a[2]+'; her no '+r.s[0]+', mostly '+r.s[1]+', yes '+r.s[2]).join('\\n'):'Nothing rated yet.'};
</script></body></html>`;
writeFileSync(join(OUT, "index.html"), page); console.log("page written with", Object.keys(key).length, "takes");
