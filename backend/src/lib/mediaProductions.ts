import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaProductions, mediaSubjects, people } from "@/db/schema";
import { canUseSubject, getMediaSubject } from "@/lib/mediaSubjects";
import { randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";

export interface CastRole { subject_id: string; role: string; wardrobe_variant_ids: string[]; voice_choice: string | null; notes: string }
export interface Shot { id: string; subject_ids: string[]; clip_file_id?: string | null; picture_file_id?: string | null; music_line_id?: string | null; voice_line_id?: string | null }
export interface Scene { id: string; title?: string; shots: Shot[] }
export interface Episode { id: string; title?: string; scenes: Scene[] }
export interface Production {
  id: string; title: string; summary: string; owner_person_id: string; shared_to: string[]; cast: CastRole[]; sets: string[]; props: string[]; episodes: Episode[];
  clip_file_ids: string[]; picture_file_ids: string[]; music_line_ids: string[]; voice_line_ids: string[]; finished_cut_file_ids: string[];
  provenance: string; created_at: string; updated_at: string; hlc: string;
}
const decode = (row: typeof mediaProductions.$inferSelect): Production => ({
  id: row.id, title: row.title, summary: row.summary, owner_person_id: row.ownerPersonId, shared_to: JSON.parse(row.sharedTo), cast: JSON.parse(row.cast), sets: JSON.parse(row.sets), props: JSON.parse(row.props), episodes: JSON.parse(row.episodes),
  clip_file_ids: JSON.parse(row.clipFileIds), picture_file_ids: JSON.parse(row.pictureFileIds), music_line_ids: JSON.parse(row.musicLineIds), voice_line_ids: JSON.parse(row.voiceLineIds), finished_cut_file_ids: JSON.parse(row.finishedCutFileIds),
  provenance: row.provenance, created_at: row.createdAt, updated_at: row.updatedAt, hlc: row.hlc,
});
function raw(id: string) { return db.select().from(mediaProductions).where(eq(mediaProductions.id, id)).get(); }
export function canSeeProduction(actor: PersonRow, row: typeof mediaProductions.$inferSelect) { return actor.role !== "guest" && (actor.id === row.ownerPersonId || (JSON.parse(row.sharedTo) as string[]).includes(actor.id)); }
export function listMediaProductions(actor: PersonRow): Production[] { return actor.role === "guest" ? [] : db.select().from(mediaProductions).all().filter((r) => canSeeProduction(actor, r)).map(decode); }
export function getMediaProduction(actor: PersonRow, id: string): Production | null { const row = raw(id); return row && canSeeProduction(actor, row) ? decode(row) : null; }
function validSubjectIds(actor: PersonRow, ids: string[]) {
  if (new Set(ids).size !== ids.length) return false;
  return ids.every((id) => { const row = db.select().from(mediaSubjects).where(eq(mediaSubjects.id, id)).get(); return !!row && canUseSubject(actor, row); });
}
function references(p: Partial<Production>) {
  const cast = p.cast ?? [], sets = p.sets ?? [], props = p.props ?? [], episodes = p.episodes ?? [];
  return [...cast.flatMap((c) => [c.subject_id, ...c.wardrobe_variant_ids]), ...sets, ...props, ...episodes.flatMap((e) => e.scenes.flatMap((s) => s.shots.flatMap((shot) => shot.subject_ids)))];
}
function persist(row: typeof mediaProductions.$inferSelect, patch: Partial<Production>) {
  const values: Record<string, unknown> = { updatedAt: new Date().toISOString(), hlc: nextHlc() };
  const map: Array<[keyof Production, string]> = [["title","title"],["summary","summary"],["shared_to","sharedTo"],["cast","cast"],["sets","sets"],["props","props"],["episodes","episodes"],["clip_file_ids","clipFileIds"],["picture_file_ids","pictureFileIds"],["music_line_ids","musicLineIds"],["voice_line_ids","voiceLineIds"],["finished_cut_file_ids","finishedCutFileIds"]];
  for (const [key, column] of map) if (patch[key] !== undefined) values[column] = Array.isArray(patch[key]) ? JSON.stringify(patch[key]) : patch[key];
  db.update(mediaProductions).set(values as never).where(eq(mediaProductions.id, row.id)).run();
}
export function createMediaProduction(actor: PersonRow, input: Pick<Production,"title"> & Partial<Omit<Production,"id"|"owner_person_id"|"provenance"|"created_at"|"updated_at"|"hlc"|"shared_to">>, source="api"): Production {
  if (actor.role === "guest") throw new Error("Productions aren't available to guest profiles.");
  const title = input.title.trim().slice(0,160);
  if (!title || !validSubjectIds(actor, references(input))) throw new Error("Choose subjects you can use in this production.");
  const now = new Date().toISOString(), id = `mprd-${randomSuffix(10)}`;
  db.insert(mediaProductions).values({ id, ownerPersonId: actor.id, title, summary: input.summary?.slice(0,2000) ?? "", sharedTo: "[]", cast: JSON.stringify(input.cast ?? []), sets: JSON.stringify(input.sets ?? []), props: JSON.stringify(input.props ?? []), episodes: JSON.stringify(input.episodes ?? []), clipFileIds: JSON.stringify(input.clip_file_ids ?? []), pictureFileIds: JSON.stringify(input.picture_file_ids ?? []), musicLineIds: JSON.stringify(input.music_line_ids ?? []), voiceLineIds: JSON.stringify(input.voice_line_ids ?? []), finishedCutFileIds: JSON.stringify(input.finished_cut_file_ids ?? []), createdAt: now, updatedAt: now, hlc: nextHlc(), provenance: `media-production:${JSON.stringify({v:1,source})}` }).run();
  return getMediaProduction(actor,id)!;
}
export function updateMediaProduction(actor: PersonRow,id:string,patch:Partial<Production>):Production|null {
  const row=raw(id); if(!row||row.ownerPersonId!==actor.id||actor.role==="guest") return null;
  if(patch.title!==undefined) patch={...patch,title:patch.title.trim().slice(0,160)};
  if(patch.title==="") throw new Error("A production needs a title.");
  if(!validSubjectIds(actor,references({...decode(row),...patch}))) throw new Error("Choose subjects you can use in this production.");
  persist(row,patch); return getMediaProduction(actor,id);
}
/** Record a finished video on a shot. Missing productions or shots are harmless because jobs can outlive their source shot. */
export function setShotClip(ownerPersonId: string, productionId: string, shotId: string, fileId: string): void {
  const row = raw(productionId);
  if (!row || row.ownerPersonId !== ownerPersonId) return;
  const production = decode(row);
  let found = false;
  const episodes = production.episodes.map((episode) => ({ ...episode, scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => {
    if (shot.id !== shotId) return shot;
    found = true;
    return { ...shot, clip_file_id: fileId };
  }) })) }));
  if (found) persist(row, { episodes });
}
export function setShotPicture(ownerPersonId: string, productionId: string, shotId: string, fileId: string): void {
  const row = raw(productionId);
  if (!row || row.ownerPersonId !== ownerPersonId) return;
  const production = decode(row);
  let found = false;
  const episodes = production.episodes.map((episode) => ({ ...episode, scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => {
    if (shot.id !== shotId) return shot;
    found = true;
    return { ...shot, picture_file_id: fileId };
  }) })) }));
  if (found) persist(row, { episodes });
}
/** Record the kept narration file for a shot. */
export function setShotVoiceLine(ownerPersonId: string, productionId: string, shotId: string, fileId: string): void {
  const row = raw(productionId);
  if (!row || row.ownerPersonId !== ownerPersonId) return;
  const production = decode(row);
  let found = false;
  const episodes = production.episodes.map((episode) => ({ ...episode, scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => {
    if (shot.id !== shotId) return shot;
    found = true;
    return { ...shot, voice_line_id: fileId };
  }) })) }));
  if (found) persist(row, { episodes });
}
export function clearShotArtifacts(ownerPersonId: string, productionId: string, shotId: string): void {
  const row = raw(productionId);
  if (!row || row.ownerPersonId !== ownerPersonId) return;
  const production = decode(row);
  let found = false;
  const episodes = production.episodes.map((episode) => ({ ...episode, scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => {
    if (shot.id !== shotId) return shot;
    found = true;
    return { ...shot, picture_file_id: null, clip_file_id: null, voice_line_id: null };
  }) })) }));
  if (found) persist(row, { episodes, finished_cut_file_ids: [] });
}
export function updateProductionCast(actor:PersonRow,id:string,cast:CastRole[]) { return updateMediaProduction(actor,id,{cast}); }
export function updateProductionScript(actor:PersonRow,id:string,episodes:Episode[]) { return updateMediaProduction(actor,id,{episodes}); }
export function applyCastOperation(actor:PersonRow,id:string,operation:{op:"add"|"replace"|"remove";subject_id:string;entry?:CastRole}):Production|null {
  const production=getMediaProduction(actor,id); if(!production||production.owner_person_id!==actor.id)return null;
  const cast=[...production.cast],index=cast.findIndex((entry)=>entry.subject_id===operation.subject_id);
  if(operation.op==="add"){if(index>=0||!operation.entry||operation.entry.subject_id!==operation.subject_id)throw new Error("That cast subject is already present or the entry is invalid.");cast.push(operation.entry);}
  else if(index<0) throw new Error("That cast subject is not in this production.");
  else if(operation.op==="remove")cast.splice(index,1);
  else {if(!operation.entry||operation.entry.subject_id!==operation.subject_id)throw new Error("The replacement must keep the same subject.");cast[index]=operation.entry;}
  return updateMediaProduction(actor,id,{cast});
}
export function applyScriptOperation(actor:PersonRow,id:string,operation:{op:"add_episode"|"replace_episode"|"remove_episode";episode_id:string;episode?:Episode}):Production|null {
  const production=getMediaProduction(actor,id); if(!production||production.owner_person_id!==actor.id)return null;
  const episodes=[...production.episodes],index=episodes.findIndex((episode)=>episode.id===operation.episode_id);
  if(operation.op==="add_episode"){if(index>=0||!operation.episode||operation.episode.id!==operation.episode_id)throw new Error("That episode is already present or the episode is invalid.");episodes.push(operation.episode);}
  else if(index<0)throw new Error("That episode is not in this production.");
  else if(operation.op==="remove_episode")episodes.splice(index,1);
  else {if(!operation.episode||operation.episode.id!==operation.episode_id)throw new Error("The replacement must keep the same episode id.");episodes[index]=operation.episode;}
  return updateMediaProduction(actor,id,{episodes});
}
export function deleteMediaProduction(actor:PersonRow,id:string):boolean { const row=raw(id); if(!row||row.ownerPersonId!==actor.id) return false; db.delete(mediaProductions).where(eq(mediaProductions.id,id)).run(); return true; }
export function shareMediaProduction(actor:PersonRow,id:string,personId:string,shared:boolean):Production|null {
  const row=raw(id); if(!row||row.ownerPersonId!==actor.id)return null;
  const target=db.select({id:people.id,role:people.role}).from(people).where(and(eq(people.id,personId),isNull(people.deletedAt))).get();
  if(!target||target.role==="guest"||personId===actor.id) throw new Error("Choose a named household member.");
  const ids=new Set<string>(JSON.parse(row.sharedTo)); shared?ids.add(personId):ids.delete(personId); persist(row,{shared_to:[...ids]}); return getMediaProduction(actor,id);
}
export function castForCaller(actor:PersonRow,id:string) {
  const p=getMediaProduction(actor,id); if(!p)return null;
  return p.cast.map((entry)=>{const s=getMediaSubject(actor,entry.subject_id); if(s)return {...entry,subject:s}; const row=db.select({name:mediaSubjects.name}).from(mediaSubjects).where(eq(mediaSubjects.id,entry.subject_id)).get(); const {subject_id:_subjectId,wardrobe_variant_ids:_variants,...role}=entry; return {...role,subject:{name:row?.name ?? "Unavailable subject"},references_hidden:true};});
}
