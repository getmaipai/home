export const TAGS = ["laugh","chuckle","sigh","gasp","cough","clear throat","whisper","shout","excited","angry","sad","breath"] as const;
const known = new Set<string>(TAGS);
export type Segment = {type:"text"; value:string}|{type:"tag"; value:string};
export function splitTags(text:string): Segment[] {
 const out:Segment[]=[]; const re=/\[([^\]]*)\]/g; let at=0,m:RegExpExecArray|null;
 while((m=re.exec(text))){ if(m.index>at) out.push({type:"text",value:text.slice(at,m.index)}); out.push({type:"tag",value:m[1].toLowerCase()}); at=re.lastIndex; }
 if(at<text.length) out.push({type:"text",value:text.slice(at)}); return out;
}
export function forEngine(text:string,supportedTags:readonly string[]):string { const supported=new Set(supportedTags.map(x=>x.toLowerCase())); return splitTags(text).map(s=>s.type==="text"?s.value:(known.has(s.value)&&supported.has(s.value)?`[${s.value}]`:"")).join(""); }
export class TagStream { private pending=""; push(s:string):string { this.pending+=s; const open=this.pending.lastIndexOf("["); if(open<0){const x=this.pending;this.pending="";return x;} if(this.pending.indexOf("]",open)>=0){const x=this.pending;this.pending="";return x;} if(this.pending.length-open>24){const x=this.pending.slice(0,open+1);this.pending=this.pending.slice(open+1);return x;} const x=this.pending.slice(0,open);this.pending=this.pending.slice(open);return x; } flush():string { const x=this.pending;this.pending="";return x; } }
