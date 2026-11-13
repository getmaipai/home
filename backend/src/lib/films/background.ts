import type { PersonRow } from "@/types";
import { recordFilmCreation, safely } from "@/lib/creations/writers";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { createMediaProduction } from "@/lib/mediaProductions";
import { planFilm, type FilmPlan, type PlanFilmInput } from "./plan";
import { changeFilmMusic, realFilmEngines, redoFilmShot, resumeFilm } from "./engines";
import { FilmStepError, runFilm, type FilmEngines, type FilmStage } from "./run";
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
function launch(actor: PersonRow, run: FilmRun, mode: "plan" | "run" | "redo" | "music" | "stills", shotId?: string, planInput?: PlanFilmInput): Promise<void> {
  const controller=new AbortController(); active.set(run.id,controller);
  return (async()=>{
    try {
      let current=getFilmRun(actor,run.id); if(!current) return;
      let plan=current.plan;
      if(mode==="plan" || !plan) {
        const planned=await planFilm(planInput ?? {idea:current.idea,faceless:current.faceless});
        if(controller.signal.aborted) return;
        if(!planned.ok){updateFilmRun(actor,run.id,{state:"failed",error_line:planned.line});return;}
        plan=planned.plan;
        const ownSong=ownMusic.get(run.id);
        const production=createMediaProduction(actor,{title:plan.title,summary:plan.summary,...(ownSong?{music_line_ids:[ownSong]}:{})},"film");
        updateFilmRun(actor,run.id,{plan,faceless:planInput?.faceless ?? current.faceless,production_id:production.id,total_steps:total(plan,planInput?.faceless ?? current.faceless),stage:"Plan",done_steps:1});
        current=getFilmRun(actor,run.id)!;
        if(!current.go_ahead && mode==="plan") { updateFilmRun(actor,run.id,{state:"waiting_for_go"}); return; }
      }
      current=getFilmRun(actor,run.id)!;
      if(!current.production_id || !plan) throw new Error("The film plan is unavailable. Start a new film.");
      updateFilmRun(actor,run.id,{state:"running",error_line:null});
      const engines=engineFactory({actor,signal:controller.signal,productionId:current.production_id,faceless:current.faceless}); engines.onProgress=onProgress(actor,run.id);
      const input={actor,productionId:current.production_id,plan,faceless:current.faceless,engines,signal:controller.signal};
      if((mode==="plan" || mode==="stills") && previewFirst.delete(run.id)) {
        await runFilm({...input,stopAfterStills:true});
        if(controller.signal.aborted) return;
        updateFilmRun(actor,run.id,{state:"waiting_for_go",stage:"Stills",error_line:null,note:"The pictures are ready. Play the animatic, then press Go to make the clips."});
        return;
      }
      if(mode==="redo" && shotId) await redoFilmShot({...input,shotId});
      else if(mode==="music") await changeFilmMusic(input);
      else if(mode==="run" && engineFactory===realFilmEngines) await resumeFilm({actor,productionId:current.production_id,plan,faceless:current.faceless,signal:controller.signal,onProgress:engines.onProgress});
      else await runFilm(input);
      if(controller.signal.aborted) return;
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
export function startFilm(input: {actor:PersonRow;idea:string;shots?:number;seconds?:number;look?:string;castHints?:string[];faceless?:boolean;goAhead:boolean;stillsFirst?:boolean;musicFileId?:string}): StartFilmResult {
  const {actor}=input;
  if(!allowed(actor)) return {line:"Making a film is for adults on their own written screen."};
  if(listFilmRunsInStates(["planning","running"]).some((r)=>r.person_id===actor.id)) return {line:"A film is already running. Wait for it to finish or cancel it first."};
  const run=createFilmRun(actor,{idea:input.idea,goAhead:input.goAhead,faceless:input.faceless});
  if(input.stillsFirst) previewFirst.add(run.id);
  if(input.musicFileId) ownMusic.set(run.id,input.musicFileId);
  launch(actor,run,"plan",undefined,{idea:input.idea,shots:input.shots,targetSeconds:input.seconds,look:input.look,castHints:input.castHints,faceless:input.faceless}); return {id:run.id};
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
  return updateFilmRun(actor,id,{state:"cancelled",error_line:null});
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
export function resumeStoppedFilms(): void { failInterruptedFilmRuns(); }
