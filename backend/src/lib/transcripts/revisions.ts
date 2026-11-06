import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transcripts, transcriptRevisions } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newTranscriptRevisionId } from "@/lib/id";
import { TranscriptError, getTranscriptDatabaseRow, type Segment } from "./store";
import type { PersonRow } from "@/types";

export type Op = { kind: "replace_text" | "edit_text"; segment_id: string; text: string } | { kind: "retime"; segment_id: string; start: number; end: number } | { kind: "split"; segment_id: string; at: number; new_segment_id: string } | { kind: "merge"; segment_ids: [string,string] } | { kind: "set_speaker"; segment_id: string; speaker: string } | { kind: "replace_range"; start: number; end: number; segments: Segment[] };
const autosave = new Map<string, { at: number; ops: Op[] }>();
const parse = (raw: string) => JSON.parse(raw) as Segment[];
function apply(segments: Segment[], op: Op): Segment[] {
  const index = (id: string) => { const i = segments.findIndex(s => s.id === id); if (i < 0) throw new TranscriptError("A transcript line was not found. Refresh and try again."); return i; };
  if (op.kind === "replace_range") return [...segments.filter(s => s.end <= op.start || s.start >= op.end), ...op.segments].sort((a,b) => a.start-b.start);
  if (op.kind === "merge") { const a = index(op.segment_ids[0]), b = index(op.segment_ids[1]); if (Math.abs(a-b)!==1) throw new TranscriptError("Choose two neighboring lines to merge."); const low=Math.min(a,b), first=segments[low]!, second=segments[low+1]!; return [...segments.slice(0,low), { ...first, end: second.end, text: `${first.text.trim()} ${second.text.trim()}` }, ...segments.slice(low+2)]; }
  const i=index(op.segment_id), current=segments[i]!;
  if (op.kind === "edit_text" || op.kind === "replace_text") return segments.map((s,n)=>n===i?{...s,text:op.text}:s);
  if (op.kind === "retime") { if (op.end <= op.start) throw new TranscriptError("A line must end after it starts."); return segments.map((s,n)=>n===i?{...s,start:op.start,end:op.end}:s).sort((a,b)=>a.start-b.start); }
  if (op.kind === "set_speaker") return segments.map((s,n)=>n===i?{...s,speaker:op.speaker}:s);
  if (op.kind !== "split") throw new TranscriptError("That transcript edit is not supported.");
  const words = current.text.trim().split(/\s+/), leftText = words.slice(0, Math.ceil(words.length/2)).join(" "), rightText=words.slice(Math.ceil(words.length/2)).join(" ");
  const ratio=(op.at-current.start)/(current.end-current.start);
  if (!leftText || !rightText || ratio<=0 || ratio>=1) throw new TranscriptError("Choose a split point inside the line.");
  return [...segments.slice(0,i), {...current,end:op.at,text:leftText}, {...current,id:op.new_segment_id,start:op.at,text:rightText}, ...segments.slice(i+1)];
}
export function applyOps(actor: PersonRow, id: string, author: string, ops: Op[], reason = "edit", now = Date.now()) {
  const row=getTranscriptDatabaseRow(actor,id), key=`${id}:${author}`, segments=parse(row.segments);
  if (reason === "autosave") {
    const pending = autosave.get(key);
    const combined = pending && now - pending.at <= 5000 ? [...pending.ops, ...ops] : ops;
    let next = segments;
    for (const operation of ops) next = apply(next, operation);
    autosave.set(key, { at: pending && now - pending.at <= 5000 ? pending.at : now, ops: combined });
    // Autosaves update the visible transcript; their single revision is committed on flush.
    db.update(transcripts).set({ segments: JSON.stringify(next), hlc: nextHlc() }).where(eq(transcripts.id, id)).run();
    return { ...row, segments: JSON.stringify(next), pending: true };
  }
  const pending = autosave.get(key);
  if (pending) {
    const combined = now - pending.at <= 5000 ? [...pending.ops, ...ops] : ops;
    let next = segments;
    for (const operation of ops) next = apply(next, operation);
    const n = row.currentRevision + 1;
    const stamp = nextHlc();
    db.transaction(() => {
      db.insert(transcriptRevisions).values({
        id: newTranscriptRevisionId(), transcriptId: id, n, author, reason,
        ops: JSON.stringify(combined), provenance: row.provenance, hlc: stamp,
      }).run();
      db.update(transcripts).set({ segments: JSON.stringify(next), currentRevision: n, hlc: stamp })
        .where(eq(transcripts.id, id)).run();
    });
    autosave.delete(key);
    return { ...row, segments: JSON.stringify(next), currentRevision: n, hlc: stamp };
  }
  let next=segments; for(const op of ops) next=apply(next,op);
  const current=ops;
  const n=row.currentRevision+1, stamp=nextHlc(), revision={id:newTranscriptRevisionId(),transcriptId:id,n,author,reason,ops:JSON.stringify(current),provenance:row.provenance,hlc:stamp};
  db.transaction(()=>{db.insert(transcriptRevisions).values(revision).run();db.update(transcripts).set({segments:JSON.stringify(next),currentRevision:n,hlc:stamp}).where(eq(transcripts.id,id)).run();});
  return { ...row, segments:JSON.stringify(next), currentRevision:n, hlc:stamp };
}
export function undo(actor: PersonRow,id:string,author:string) {
  const current=getTranscriptDatabaseRow(actor,id).currentRevision;
  if(current<2) throw new TranscriptError("There is no earlier transcript revision to undo.");
  return restoreRevision(actor,id,current-1,author,"undo");
}
export function restoreRevision(actor: PersonRow,id:string,n:number,author:string,reason="restore") {
  const row=getTranscriptDatabaseRow(actor,id), target=db.select().from(transcriptRevisions).where(eq(transcriptRevisions.transcriptId,id)).all().find(r=>r.n===n);
  if(!target) throw new TranscriptError("That revision is not available. Refresh the history and try again.",404);
  
  // Rebuild the requested snapshot by replaying the stored operation history from its initial revision.
  const history=db.select().from(transcriptRevisions).where(eq(transcriptRevisions.transcriptId,id)).all().filter(r=>r.n<=n).sort((a,b)=>a.n-b.n);
  // Revision 1 is a full snapshot; start replay from it, then apply later edits.
  let snapshot=(JSON.parse(history[0]?.ops ?? "[]") as Op[]).find((op): op is Extract<Op,{kind:"replace_range"}> => (op as Op).kind==="replace_range")?.segments ?? [];
  for(const revision of history.slice(1)) for(const op of JSON.parse(revision.ops) as Op[]) snapshot=apply(snapshot,op);
  const updated = applyOps(actor,id,author,[{kind:"replace_range",start:0,end:Number.MAX_SAFE_INTEGER,segments:snapshot}],`${reason} ${n}`);
  // History is append-only; the snapshot restore is the new revision's operation.
  return updated;
}
export function __resetAutosavesForTests(){autosave.clear();}
