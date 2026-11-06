import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { __setFilmPlanCompleterForTests } from "@/lib/films/plan";
import { __setFilmEnginesForTests, cancelFilm, resumeStoppedFilms, startFilm } from "@/lib/films/background";
import { createFilmRun, getFilmRun, updateFilmRun } from "@/lib/films/store";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

function person(id:string):PersonRow { const now=new Date().toISOString(); db.insert(people).values({id,displayName:id,role:"adult",avatarSeed:id,source:"local",createdAt:now,updatedAt:now,hlc:"1:0:test"}).run(); return db.select().from(people).all().find(p=>p.id===id)!; }
const plan={title:"Crossing",summary:"A short crossing.",cast:[{name:"Mira",kind:"character",locked:"Blue coat."}],shots:[{id:"one",subject_ids:[],framing:"wide",still:"Mira in a blue coat.",motion:"Walks slowly.",seconds:5},{id:"two",subject_ids:[],framing:"close",still:"Mira in a blue coat.",motion:"Looks up.",seconds:5}],music:"Soft piano.",credits:[]};
const wait=()=>new Promise(r=>setTimeout(r,10));
async function until(fn:()=>boolean) { for(let i=0;i<100&&!fn();i++) await wait(); expect(fn()).toBe(true); }
beforeEach(()=>resetDb()); afterEach(()=>{__setFilmPlanCompleterForTests(null);__setFilmEnginesForTests(null);});
describe("film background runner",()=>{
 test("returns immediately, waits for Go, stores progress, and refuses a second active run",async()=>{
  const actor=person("film-bg"), calls:string[]=[]; let release!:()=>void; const gate=new Promise<void>(resolve=>{release=resolve}); let gated=false;
  __setFilmPlanCompleterForTests(async()=>({ok:true,text:JSON.stringify(plan)}));
  __setFilmEnginesForTests(({actor,productionId})=>({waitForIdle:async()=>{if(!gated){gated=true;await gate;}},ensureSubject:async({name,kind,locked})=>{calls.push("cast");return createMediaSubject(actor,{name,kind,look:locked}).id;},makeStill:async({shot})=>{calls.push(`still:${shot.id}`);return `pic:${shot.id}`;},makeClip:async({shot})=>{calls.push(`clip:${shot.id}`);return `clip:${shot.id}`;},makeMusic:async()=>{calls.push("music");return "music";},assemble:async()=>{calls.push("assemble");return "cut";}}));
  const created=startFilm({actor,idea:"A crossing",goAhead:false}); expect("id" in created).toBe(true); if(!("id" in created))return;
  expect(getFilmRun(actor,created.id)?.state).toBe("planning");
  await until(()=>getFilmRun(actor,created.id)?.state==="waiting_for_go"); expect(calls).toEqual([]);
  const {goFilm}=await import("@/lib/films/background"); goFilm(actor,created.id);
  await until(()=>getFilmRun(actor,created.id)?.state==="running");
  expect(startFilm({actor,idea:"Another",goAhead:true})).toMatchObject({line:expect.any(String)});
  release(); await until(()=>getFilmRun(actor,created.id)?.state==="done");
  expect(calls.length).toBeGreaterThan(0); expect(getFilmRun(actor,created.id)).toMatchObject({stage:"Assemble",done_steps:expect.any(Number),film_file_id:"cut"});
 });
 test("restart fails interrupted work with a resume instruction",()=>{ const actor=person("film-restart"),run=createFilmRun(actor,{idea:"A crossing",goAhead:true}); updateFilmRun(actor,run.id,{state:"running"}); resumeStoppedFilms(); expect(getFilmRun(actor,run.id)).toMatchObject({state:"failed",error_line:"The hub restarted while this film was being made. Press Resume to continue."}); });
 test("a failed engine leaves the run failed with a plain next step",async()=>{ const actor=person("film-failed"); __setFilmPlanCompleterForTests(async()=>({ok:true,text:JSON.stringify(plan)})); __setFilmEnginesForTests(()=>({waitForIdle:async()=>{},ensureSubject:async()=>{throw new Error("private backend detail");},makeStill:async()=>"",makeClip:async()=>"",makeMusic:async()=>"",assemble:async()=>""})); const created=startFilm({actor,idea:"A crossing",goAhead:true}); expect("id" in created).toBe(true); if(!("id" in created))return; await until(()=>getFilmRun(actor,created.id)?.state==="failed"); expect(getFilmRun(actor,created.id)?.error_line).toContain("try again"); });
});
