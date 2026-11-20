import { noteAfterRepair, repairFinishedFilm } from "./repair";
import type { PersonRow } from "@/types";
import { recordFilmCreation, safely } from "@/lib/creations/writers";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { clearShotArtifacts, createMediaProduction, getMediaProduction, setShotClip, updateMediaProduction } from "@/lib/mediaProductions";
import { bindCastSubjects, planFilm, type FilmPlan, type PlanFilmInput } from "./plan";
import { subjectViewById } from "@/lib/mediaSubjects";
import { changeFilmMusic, realFilmEngines, redoFilmShot, resumeFilm } from "./engines";
import { FilmStepError, runFilm, type FilmEngines, type FilmStage } from "./run";
import { getVideoJobFor, cancelVideoJob } from "@/lib/videos/jobs";
import { filmRunJobs } from "./progressStore";
import { cancelMusicJob, getMusicJobFor } from "@/lib/music/jobs";
import { cancelOrDelete } from "@/lib/pictures/stack";
import { createFilmRun, failInterruptedFilmRuns, getFilmRun, listFilmRunsInStates, updateFilmRun, type FilmRun } from "./store";

const active = new Map<string, AbortController>();
/** FILM-ANIMATIC-01: runs that stop once their stills are made (kept in memory; a restart just means the person presses Resume). */
const previewFirst = new Set<string>();
type EngineFactory = typeof realFilmEngines;
let engineFactory: EngineFactory = realFilmEngines;
export function __setFilmEnginesForTests(factory: EngineFactory | null): void { engineFactory = factory ?? realFilmEngines; }
const stageName: Record<FilmStage, FilmRun["stage"]> = { cast:"Cast", stills:"Stills", clips:"Clips", music:"Music", assemble:"Assemble", keep:"Assemble" };
const plainFailure = "The film could not be finished. Press Resume to try the unfinished steps again.";
export function allowed(actor: PersonRow): boolean { return actor.role !== "guest" && laneOfPerson(actor) === "adult"; }
function total(plan: FilmPlan, faceless = false): number { return plan.cast.length + plan.shots.length * (faceless ? 3 : 2) + 3; }
function onProgress(actor: PersonRow, id: string) { return (p: {stage:FilmStage;done:number;total:number}) => {
  const row=getFilmRun(actor,id); if(!row || row.state!=="running") return;
  const cast=row.plan?.cast.length ?? 0, shots=row.plan?.shots.length ?? 0, clipSteps=shots*(row.faceless?2:1); const stage=stageName[p.stage]; const prior={Cast:0,Stills:cast,Clips:cast+shots,Music:cast+shots+clipSteps,Assemble:cast+shots+clipSteps+1} as Record<string,number>;
  updateFilmRun(actor,id,{stage,done_steps:Math.min(row.total_steps,prior[stage ?? ""] ?? 0)+p.done,total_steps:row.total_steps});
}; }
/** MP-06: a song the person chose as the film's music (file id), by run; it becomes the production's first music line so the film does not make its own. */
const ownMusic=new Map<string,string>();
function launch(actor: PersonRow, run: FilmRun, mode: "plan" | "run" | "redo" | "music" | "stills", shotId?: string, planInput?: PlanFilmInput, castSubjectIds?: string[]): Promise<void> {
  const controller=new AbortController(); active.set(run.id,controller);
  return (async()=>{
    try {
      let current=getFilmRun(actor,run.id); if(!current) return;
      let plan=current.plan;
      if(mode==="plan" || !plan) {
        const made=await planFilm(planInput ?? {idea:current.idea,faceless:current.faceless});
        if(controller.signal.aborted) return;
        if(!made.ok){updateFilmRun(actor,run.id,{state:"failed",error_line:made.line});return;}
        plan=made.plan;
        // CREATOR-05: the members the person cast carry their subject into the run (by the ids `resolveCast` checked, not by name).
        if(castSubjectIds?.length) plan=bindCastSubjects(plan,castSubjectIds.flatMap(id=>{const subject=subjectViewById(id); return subject?[{id,name:subject.name}]:[];}));
        const ownSong=ownMusic.get(run.id);
        const production=createMediaProduction(actor,{title:plan.title,summary:plan.summary,...(ownSong?{music_line_ids:[ownSong]}:{})},"film");
        updateFilmRun(actor,run.id,{plan,faceless:planInput?.faceless ?? current.faceless,production_id:production.id,total_steps:total(plan,planInput?.faceless ?? current.faceless),stage:"Plan",done_steps:1});
        current=getFilmRun(actor,run.id)!;
        if(!current.go_ahead && mode==="plan") { updateFilmRun(actor,run.id,{state:"waiting_for_go"}); return; }
      }
      current=getFilmRun(actor,run.id)!;
      if(!current.production_id || !plan) throw new Error("The film plan is unavailable. Start a new film.");
      updateFilmRun(actor,run.id,{state:"running",error_line:null});
      const engines=engineFactory({actor,signal:controller.signal,productionId:current.production_id,faceless:current.faceless}); engines.onProgress=onProgress(actor,run.id); engines.say=(line)=>{ updateFilmRun(actor,run.id,{note:line}); };
      const input={actor,productionId:current.production_id,plan,faceless:current.faceless,engines,signal:controller.signal};
      if((mode==="plan" || mode==="stills") && previewFirst.delete(run.id)) {
        await runFilm({...input,stopAfterStills:true});
        if(controller.signal.aborted) return;
        updateFilmRun(actor,run.id,{state:"waiting_for_go",stage:"Stills",error_line:null,note:"The pictures are ready. Play the animatic, then press Go to make the clips."});
        return;
      }
      if(mode==="redo" && shotId) await redoFilmShot({...input,shotId});
      else if(mode==="music") await changeFilmMusic(input);
      else if(mode==="run" && engineFactory===realFilmEngines) await resumeFilm({actor,productionId:current.production_id,plan,faceless:current.faceless,signal:controller.signal,onProgress:engines.onProgress,engines});
      else await runFilm(input);
      if(controller.signal.aborted) return;
      // VF-REPAIR-01 slice 1: what the finished-film check found is repaired once (a rebuild of the cut, or one new take per faulty shot the person has not marked), never in a loop.
      const found=engines.lastCheck;
      if(!current.faceless && found?.faults.length && engines.verifyCut) {
        const repaired=await repairFinishedFilm({actor,productionId:current.production_id,plan,cutId:found.cutId,musicFileId:found.musicFileId,faults:found.faults,engines,signal:controller.signal});
        if(controller.signal.aborted) return;
        plan=repaired.plan; updateFilmRun(actor,run.id,{plan});
        if(repaired.acted || repaired.lines.length) engines.note=noteAfterRepair({note:engines.note,check:{lines:found.lines,entries:found.entries},repaired});
      }
      const latest=getFilmRun(actor,run.id)!;
      const prod=(await import("@/lib/mediaProductions")).getMediaProduction(actor,latest.production_id!);
      const fileId=prod?.finished_cut_file_ids.at(-1) ?? null;
      if(!fileId) throw new Error("The finished film is unavailable. Press Resume to try again.");
      updateFilmRun(actor,run.id,{state:"done",stage:"Assemble",done_steps:latest.total_steps,film_file_id:fileId,note:engines.note ?? null,error_line:null});
      // CREATOR-02: the record of how this film was made (its plan, its cast, the clips it was cut from); the cut may already hold the record of the edit job that assembled it, which becomes the film.
      if(prod) safely(()=>recordFilmCreation(actor,{cutFileId:fileId,productionId:prod.id,runId:run.id,plan:{shots:plan.shots as unknown as Array<Record<string,unknown>>,title:plan.title},castSubjects:prod.cast.map(m=>({subject_id:m.subject_id,role:m.role})),clipFileIds:prod.episodes.flatMap(e=>e.scenes.flatMap(sc=>sc.shots)).map(s=>s.clip_file_id).filter((id):id is string=>!!id),faceless:current.faceless}));
    } catch(error) {
      console.error("[film] run failed", run.id, error);
      if(controller.signal.aborted) return;
      updateFilmRun(actor,run.id,{state:"failed",error_line:error instanceof FilmStepError ? error.message : plainFailure});
    } finally { if(active.get(run.id)===controller) active.delete(run.id); }
  })();
}
/** LONGFORM-03: starts a run from a plan that is already written (one chunk of a scene) and resolves when the run ends. */
export function startPlannedFilm(input: {actor:PersonRow;idea:string;plan:FilmPlan;parentId:string;sceneKey:string}): {id:string;done:Promise<FilmRun|null>} | {line:string} {
  const {actor}=input;
  if(!allowed(actor)) return {line:"Making a film is for adults on their own written screen."};
  const run=createFilmRun(actor,{idea:input.idea,goAhead:true,parentId:input.parentId,sceneKey:input.sceneKey});
  const production=createMediaProduction(actor,{title:input.plan.title,summary:input.plan.summary},"film");
  updateFilmRun(actor,run.id,{plan:input.plan,production_id:production.id,total_steps:total(input.plan),stage:"Plan",done_steps:1});
  const done=launch(actor,getFilmRun(actor,run.id)!,"run").then(()=>getFilmRun(actor,run.id));
  return {id:run.id,done};
}
export type StartFilmResult = {id:string} | {line:string};
export function startFilm(input: {actor:PersonRow;idea:string;shots?:number;seconds?:number;look?:string;castHints?:string[];castSubjectIds?:string[];faceless?:boolean;goAhead:boolean;stillsFirst?:boolean;musicFileId?:string}): StartFilmResult {
  const {actor}=input;
  if(!allowed(actor)) return {line:"Making a film is for adults on their own written screen."};
  if(listFilmRunsInStates(["planning","running"]).some((r)=>r.person_id===actor.id)) return {line:"A film is already running. Wait for it to finish or cancel it first."};
  const run=createFilmRun(actor,{idea:input.idea,goAhead:input.goAhead,faceless:input.faceless});
  if(input.stillsFirst) previewFirst.add(run.id);
  if(input.musicFileId) ownMusic.set(run.id,input.musicFileId);
  launch(actor,run,"plan",undefined,{idea:input.idea,shots:input.shots,targetSeconds:input.seconds,look:input.look,castHints:input.castHints,faceless:input.faceless},input.castSubjectIds); return {id:run.id};
}
function ownedAdult(actor:PersonRow,id:string): FilmRun | null { if(!allowed(actor)) return null; return getFilmRun(actor,id); }
export function getFilmProgress(actor:PersonRow,id:string): FilmRun | null { return ownedAdult(actor,id); }
function anotherActiveRun(actor:PersonRow,id:string): boolean { return listFilmRunsInStates(["planning","running"]).some((r)=>r.person_id===actor.id&&r.id!==id); }
export function goFilm(actor:PersonRow,id:string): FilmRun | {line:string} | null {
  const run=ownedAdult(actor,id); if(!run)return null;
  if(run.state!=="waiting_for_go")return {line:"This film is not waiting for approval."};
  updateFilmRun(actor,id,{go_ahead:true,state:"running"}); launch(actor,getFilmRun(actor,id)!,previewFirst.has(id)?"stills":"run"); return getFilmRun(actor,id);
}
export function cancelFilm(actor:PersonRow,id:string): FilmRun | null {
  const run=ownedAdult(actor,id); if(!run)return null;
  if(!["planning","running","waiting_for_go"].includes(run.state))return run;
  active.get(id)?.abort(new Error("Film cancelled."));
  const stopped=updateFilmRun(actor,id,{state:"cancelled",error_line:null});
  void cancelFilmJobs(actor,id);
  return stopped;
}
/** FILM-CANCEL-01: every child job of the run that is still queued or running is cancelled through its own cancel: the shot clips and the cut and mix edits (`cancelVideoJob`), the song
 * (`cancelMusicJob`), the pictures (the picture Stack job, `cancelOrDelete`). They are found one way only: the shot-to-job link in the run's progress column (VF-FILMPROGRESS-01). The
 * owner check is each cancel's own (a job that is not the actor's is not found); a finished job keeps its result; a half-made shot stores nothing. Counts only are logged. */
export async function cancelFilmJobs(actor:PersonRow,runId:string,deps:{cancelPicture?:(job:string)=>Promise<void>}={}): Promise<number> {
  const links=filmRunJobs(runId);
  let stopped=0;
  const live=(state:string|undefined)=>state==="queued"||state==="running";
  for(const jobId of [...links.clips,...links.edits]){
    try{
      if(!live(getVideoJobFor(actor,jobId)?.state)) continue;
      if((await cancelVideoJob(actor,jobId))?.state==="cancelled") stopped++;
    }catch{ /* one job that will not stop must not keep the others running */ }
  }
  if(links.music){
    try{
      if(live(getMusicJobFor(actor,links.music)?.state)&&(await cancelMusicJob(actor,links.music))?.state==="cancelled") stopped++;
    }catch{ /* as above */ }
  }
  // A picture already saved is finished: only the stills of shots with no saved picture are cancelled.
  const run=getFilmRun(actor,runId);
  const production=run?.production_id?getMediaProduction(actor,run.production_id):null;
  const pictured=new Set((production?.episodes.flatMap((e)=>e.scenes.flatMap((sc)=>sc.shots))??[]).filter((shot)=>!!shot.picture_file_id).map((shot)=>shot.id));
  for(const {shot,job} of links.stills){
    if(pictured.has(shot)) continue;
    try{ await (deps.cancelPicture??cancelOrDelete)(job); stopped++; }catch{ /* as above */ }
  }
  if(stopped>0) console.info(`[film] stopped ${stopped} child job${stopped===1?"":"s"}`);
  return stopped;
}
export function resumeFilmRun(actor:PersonRow,id:string): FilmRun | {line:string} | null {
  const run=ownedAdult(actor,id); if(!run)return null;
  if(!["failed","cancelled"].includes(run.state))return {line:"This film cannot be resumed right now."};
  if(anotherActiveRun(actor,id)) return {line:"A film is already running. Wait for it to finish or cancel it first."};
  if(!run.plan || !run.production_id) { updateFilmRun(actor,id,{state:"planning",error_line:null}); launch(actor,getFilmRun(actor,id)!,"plan"); return getFilmRun(actor,id); }
  updateFilmRun(actor,id,{state:"running"}); launch(actor,getFilmRun(actor,id)!,"run"); return getFilmRun(actor,id);
}
export function redoFilmRunShot(actor:PersonRow,id:string,shotId:string): FilmRun | {line:string} | null { const run=ownedAdult(actor,id); if(!run)return null; if(anotherActiveRun(actor,id))return {line:"A film is already running. Wait for it to finish or cancel it first."}; if(!run.plan||!run.production_id||run.state!=="done")return {line:"Finish the film before redoing a shot."}; if(!run.plan.shots.some(s=>s.id===shotId))return {line:"That shot is not in the film plan."}; updateFilmRun(actor,id,{state:"running"}); launch(actor,getFilmRun(actor,id)!,"redo",shotId); return getFilmRun(actor,id); }
export function changeFilmRunMusic(actor:PersonRow,id:string): FilmRun | {line:string} | null { const run=ownedAdult(actor,id); if(!run)return null; if(anotherActiveRun(actor,id))return {line:"A film is already running. Wait for it to finish or cancel it first."}; if(!run.plan||!run.production_id||run.state!=="done")return {line:"Finish the film before changing its music."}; updateFilmRun(actor,id,{state:"running"}); launch(actor,getFilmRun(actor,id)!,"music"); return getFilmRun(actor,id); }
/** VF-REPAIR-01 slice 1: "Use the new take" / "Use the earlier take" on a repaired shot. Both takes are kept (`repair.first_clip_id`, `repair.new_clip_id`); this picks which is in the film, puts the film back together and lets the checks run again. The repair itself never runs a second time (the shot's one retry is spent). */
export function useFilmTake(actor:PersonRow,id:string,shotId:string,which:"new"|"first"): FilmRun | {line:string} | null {
  const run=ownedAdult(actor,id); if(!run)return null;
  const shot=run.plan?.shots.find(item=>item.id===shotId); const repair=shot?.repair;
  if(!run.plan||!run.production_id||!shot||!repair?.first_clip_id||!repair.new_clip_id)return {line:"That shot has no other take to use."};
  if(run.state==="running"||run.state==="planning"||anotherActiveRun(actor,id))return {line:BUSY_LINE};
  setShotClip(actor.id,run.production_id,shotId,which==="new"?repair.new_clip_id:repair.first_clip_id);
  updateMediaProduction(actor,run.production_id,{finished_cut_file_ids:[]});
  const plan={...run.plan,shots:run.plan.shots.map(item=>item.id===shotId?{...item,repair:{...repair,state:which==="new"?"fixed" as const:"failed" as const}}:item)};
  updateFilmRun(actor,id,{plan,state:"running",note:null,error_line:null}); launch(actor,getFilmRun(actor,id)!,"run"); return getFilmRun(actor,id);
}
// FILM-PAGE-01: the Film maker page's steps on a planned film (waiting for Go). Each is a plain line or the run; nothing here renders a clip before "finish kept".
const BUSY_LINE="A film is already running. Wait for it to finish or cancel it first.";
function pictured(actor:PersonRow,run:FilmRun): Set<string> { const production=run.production_id?getMediaProduction(actor,run.production_id):null; return new Set((production?.episodes.flatMap(e=>e.scenes.flatMap(sc=>sc.shots))??[]).filter(shot=>!!shot.picture_file_id).map(shot=>shot.id)); }
/** The shots of a waiting film that have a picture yet (the page shows a shot without one as not drafted). */
export function filmDraftedShots(actor:PersonRow,run:FilmRun): Set<string> { return pictured(actor,run); }
/** "Draft all": make the cast and one picture per shot, then stop and wait (no clip, no music, no cut). */
export function draftFilmRun(actor:PersonRow,id:string): FilmRun | {line:string} | null {
  const run=ownedAdult(actor,id); if(!run)return null;
  if(run.state!=="waiting_for_go"||!run.plan||!run.production_id)return {line:"Plan the film first, then draft it."};
  if(anotherActiveRun(actor,id))return {line:BUSY_LINE};
  previewFirst.add(id); updateFilmRun(actor,id,{go_ahead:true,state:"running",note:null,error_line:null}); launch(actor,getFilmRun(actor,id)!,"stills"); return getFilmRun(actor,id);
}
/** "Make this shot again" on a draft: its picture alone is made again; the other pictures stay. */
export function redoDraftShot(actor:PersonRow,id:string,shotId:string): FilmRun | {line:string} | null {
  const run=ownedAdult(actor,id); if(!run)return null;
  if(run.state!=="waiting_for_go"||!run.plan||!run.production_id)return {line:"Plan the film first, then draft it."};
  if(!run.plan.shots.some(s=>s.id===shotId))return {line:"That shot is not in the film plan."};
  if(anotherActiveRun(actor,id))return {line:BUSY_LINE};
  clearShotArtifacts(actor.id,run.production_id,shotId); previewFirst.add(id); updateFilmRun(actor,id,{go_ahead:true,state:"running",note:null,error_line:null}); launch(actor,getFilmRun(actor,id)!,"stills"); return getFilmRun(actor,id);
}
/** Keep or skip one drafted shot (the mark rides in the stored plan; a skipped shot is left out when the film is finished). */
export function reviewFilmShot(actor:PersonRow,id:string,shotId:string,keep:boolean): FilmRun | {line:string} | null {
  const run=ownedAdult(actor,id); if(!run)return null;
  if(run.state!=="waiting_for_go"||!run.plan)return {line:"Draft the film before keeping or skipping shots."};
  if(!run.plan.shots.some(s=>s.id===shotId))return {line:"That shot is not in the film plan."};
  return updateFilmRun(actor,id,{plan:{...run.plan,shots:run.plan.shots.map(s=>s.id===shotId?{...s,kept:keep}:s)}});
}
/** Change one shot's words, seconds or camera before it is drafted again. New words clear its picture so it is drawn again. */
export function editFilmShot(actor:PersonRow,id:string,shotId:string,change:{still?:string;seconds?:number;motion?:string}): FilmRun | {line:string} | null {
  const run=ownedAdult(actor,id); if(!run)return null;
  if(run.state!=="waiting_for_go"||!run.plan||!run.production_id)return {line:"Plan the film first, then change its shots."};
  if(!run.plan.shots.some(s=>s.id===shotId))return {line:"That shot is not in the film plan."};
  const words=change.still!==undefined&&change.still!==run.plan.shots.find(s=>s.id===shotId)!.still;
  if(words) clearShotArtifacts(actor.id,run.production_id,shotId);
  return updateFilmRun(actor,id,{plan:{...run.plan,shots:run.plan.shots.map(s=>s.id===shotId?{...s,...(change.still!==undefined?{still:change.still}:{}),...(change.seconds!==undefined?{seconds:change.seconds}:{}),...(change.motion!==undefined?{motion:change.motion}:{}),...(words?{kept:undefined}:{})}:s)}});
}
/** "Finish kept": leave out the skipped shots, then render the kept ones and join them (the same run a full Go makes). */
export function finishKeptFilm(actor:PersonRow,id:string): FilmRun | {line:string} | null {
  const run=ownedAdult(actor,id); if(!run)return null;
  if(run.state!=="waiting_for_go"||!run.plan||!run.production_id)return {line:"Draft the film first, then finish the shots you kept."};
  const kept=run.plan.shots.filter(s=>s.kept!==false);
  if(kept.length<2)return {line:"Keep at least two shots to finish the film."};
  const have=pictured(actor,run); if(kept.some(s=>!have.has(s.id)))return {line:"Some kept shots have no picture yet. Draft them first."};
  if(anotherActiveRun(actor,id))return {line:BUSY_LINE};
  const plan={...run.plan,shots:kept}; updateFilmRun(actor,id,{plan,total_steps:total(plan,run.faceless),go_ahead:true,state:"running",error_line:null,note:null});
  launch(actor,getFilmRun(actor,id)!,"run"); return getFilmRun(actor,id);
}
export function resumeStoppedFilms(): void { failInterruptedFilmRuns(); }
