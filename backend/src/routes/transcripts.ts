import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { TranscriptError, createTranscript, getTranscript, getTranscriptDatabaseRow, listTranscriptsForItem, revisionsForTranscript } from "@/lib/transcripts/store";
import { applyOps, restoreRevision, undo } from "@/lib/transcripts/revisions";
import { importTranscript } from "@/lib/transcripts/import";
import { buildCues } from "@/lib/transcripts/cues";
import { writeSrt, writeVtt, writeText, writeMarkdown, writeJson } from "@/lib/transcripts/writers";
import { translateCaptionTrack, TRANSLATION_LANGUAGES } from "@/lib/transcripts/captionTranslate";
import { burnJob, startBurnIn } from "@/lib/transcripts/burnIn";
import { captionTrackCues, createCaptionTrack, listCaptionTracks, refreshCaptionTrack } from "@/lib/transcripts/captions";
import { applyFindReplace, previewFindReplace } from "@/lib/transcripts/findReplace";
import { transcribeJob } from "@/lib/transcripts/stack";
import { detectSpeakers, regenerateRange } from "@/lib/transcripts/rework";
import { db } from "@/db";
import { transcripts } from "@/db/schema";

export const transcriptRoutes=apiRouter();
const idParam=z.object({id:z.string().min(1)}), itemParam=z.object({item:z.string().min(1)});
const op=z.discriminatedUnion("kind",[
 z.object({kind:z.enum(["replace_text","edit_text"]),segment_id:z.string(),text:z.string()}), z.object({kind:z.literal("retime"),segment_id:z.string(),start:z.number().nonnegative(),end:z.number().positive()}),
 z.object({kind:z.literal("split"),segment_id:z.string(),at:z.number().nonnegative(),new_segment_id:z.string()}),z.object({kind:z.literal("merge"),segment_ids:z.tuple([z.string(),z.string()])}),
 z.object({kind:z.literal("set_speaker"),segment_id:z.string(),speaker:z.string()}),z.object({kind:z.enum(["add_speaker","rename_speaker"]),speaker_id:z.string().min(1),label:z.string()}),
 z.object({kind:z.literal("replace_range"),start:z.number().nonnegative(),end:z.number().positive(),segments:z.array(z.object({id:z.string(),start:z.number().nonnegative(),end:z.number().positive(),text:z.string(),speaker:z.string().optional()})),speakers:z.array(z.object({id:z.string().min(1),label:z.string()})).optional()})
]);
function handle(e:unknown,c:any){if(e instanceof TranscriptError)return c.json({error:e.message},e.status);throw e;}
transcriptRoutes.openapi(createRoute({method:"post",path:"/library/{item}/transcript",tags:["Transcripts"],summary:"Start a local transcript job",middleware:[requireAuth] as const,request:{params:itemParam,body:{content:{"application/json":{schema:z.object({language:z.string().optional(),vocabulary:z.array(z.string()).optional()})}}}},responses:{201:{description:"Transcript created",content:{"application/json":{schema:z.any()}}},...errorResponses({401:"Not signed in",403:"Transcripts are available to teens and adults",404:"Library item unavailable",502:"Stack could not transcribe this item"})}}),async c=>{
 try{const actor=c.get("person"),{item}=c.req.valid("param"),opts=c.req.valid("json");if(listTranscriptsForItem(actor,item)[0])return c.json({error:"This item already has a transcript."},409);
 const started=Date.now(),result=await transcribeJob(actor,{item_id:item,...opts});const record=createTranscript(actor,{itemId:item,language:result.language??opts.language??"und",segments:result.segments,speakers:result.speakers,vocabulary:result.vocabulary??opts.vocabulary,provenance:{engine:result.engine??"stack",model_id:result.model_id??"unknown",source_kind:"generated"}});
 console.info(JSON.stringify({event:"transcript.generated",segments:result.segments.length,elapsed_ms:Date.now()-started}));return c.json(record,201);
 }catch(e){if(e instanceof TranscriptError)return handle(e,c);return c.json({error:"The Stack could not transcribe this item. Check that the local Stack is ready, then try again."},502);}
});
transcriptRoutes.openapi(createRoute({method:"get",path:"/library/{item}/transcript",tags:["Transcripts"],summary:"Read the transcript a Library item already has",middleware:[requireAuth] as const,request:{params:itemParam},responses:{200:{description:"Transcript",content:{"application/json":{schema:z.any()}}},...errorResponses({401:"Not signed in",404:"This item has no transcript yet"})}}),c=>{
 try{const found=listTranscriptsForItem(c.get("person"),c.req.valid("param").item)[0];if(!found)return c.json({error:"This item has no transcript yet. Make one to get started."},404);return c.json(found,200);}catch(e){return handle(e,c);}
});
transcriptRoutes.openapi(createRoute({method:"get",path:"/transcripts/{id}",tags:["Transcripts"],summary:"Read a transcript",middleware:[requireAuth] as const,request:{params:idParam},responses:{200:{description:"Transcript",content:{"application/json":{schema:z.any()}}},...errorResponses({401:"Not signed in",404:"Transcript unavailable"})}}),c=>{try{const actor=c.get("person"),{id}=c.req.valid("param");return c.json({...getTranscript(actor,id),caption_tracks:listCaptionTracks(actor,id)},200);}catch(e){return handle(e,c);}});
transcriptRoutes.openapi(createRoute({method:"patch",path:"/transcripts/{id}",tags:["Transcripts"],summary:"Edit a transcript",middleware:[requireAuth] as const,request:{params:idParam,body:{content:{"application/json":{schema:z.object({ops:z.array(op).min(1),reason:z.string().optional()})}}}},responses:{200:{description:"Updated transcript revision",content:{"application/json":{schema:z.any()}}},...errorResponses({400:"Invalid edit",401:"Not signed in",404:"Transcript unavailable"})}}),c=>{try{const {id}=c.req.valid("param"),body=c.req.valid("json");applyOps(c.get("person"),id,c.get("person").id,body.ops as never,body.reason);return c.json(getTranscript(c.get("person"),id),200);}catch(e){return handle(e,c);}});
transcriptRoutes.openapi(createRoute({method:"get",path:"/transcripts/{id}/revisions",tags:["Transcripts"],summary:"List transcript revisions",middleware:[requireAuth] as const,request:{params:idParam},responses:{200:{description:"Append-only revision history",content:{"application/json":{schema:z.array(z.any())}}},...errorResponses({401:"Not signed in",404:"Transcript unavailable"})}}),c=>{try{return c.json(revisionsForTranscript(c.get("person"),c.req.valid("param").id),200);}catch(e){return handle(e,c);}});
transcriptRoutes.openapi(createRoute({method:"post",path:"/transcripts/{id}/restore",tags:["Transcripts"],summary:"Restore a prior revision as a new revision",middleware:[requireAuth] as const,request:{params:idParam,body:{content:{"application/json":{schema:z.object({revision:z.number().int().positive()})}}}},responses:{200:{description:"Restored transcript",content:{"application/json":{schema:z.any()}}},...errorResponses({400:"Revision unavailable",401:"Not signed in",404:"Transcript unavailable"})}}),c=>{try{const {id}=c.req.valid("param");restoreRevision(c.get("person"),id,c.req.valid("json").revision,c.get("person").id);return c.json(getTranscript(c.get("person"),id),200);}catch(e){return handle(e,c);}});
transcriptRoutes.openapi(createRoute({method:"post",path:"/transcripts/{id}/undo",tags:["Transcripts"],summary:"Undo by adding a new revision",middleware:[requireAuth] as const,request:{params:idParam},responses:{200:{description:"Transcript with an undo revision",content:{"application/json":{schema:z.any()}}},...errorResponses({400:"No earlier revision",401:"Not signed in",404:"Transcript unavailable"})}}),c=>{try{const {id}=c.req.valid("param");undo(c.get("person"),id,c.get("person").id);return c.json(getTranscript(c.get("person"),id),200);}catch(e){return handle(e,c);}});
transcriptRoutes.openapi(createRoute({method:"get",path:"/transcripts/{id}/export",tags:["Transcripts"],summary:"Export transcript",middleware:[requireAuth] as const,request:{params:idParam,query:z.object({format:z.enum(["srt","vtt","txt","md","json"]),track:z.string().optional()})},responses:{200:{description:"Exported transcript text",content:{"text/plain":{schema:z.string()},"application/json":{schema:z.any()}}},...errorResponses({400:"Unknown export format",401:"Not signed in",404:"Transcript or caption track unavailable"})}}),c=>{try{const value=getTranscript(c.get("person"),c.req.valid("param").id),fmt=c.req.valid("query").format,q=c.req.valid("query"),cues=q.track&&(fmt==="srt"||fmt==="vtt")?captionTrackCues(c.get("person"),c.req.valid("param").id,q.track):buildCues(value.segments),text=fmt==="srt"?writeSrt(cues):fmt==="vtt"?writeVtt(cues):fmt==="txt"?writeText(value):fmt==="md"?writeMarkdown(value):writeJson(value);return fmt==="json"?c.json(JSON.parse(text),200):c.text(text,200);}catch(e){return handle(e,c);}});
transcriptRoutes.openapi(createRoute({method:"post",path:"/library/{item}/transcript/import",tags:["Transcripts"],summary:"Import a timed transcript",middleware:[requireAuth] as const,request:{params:itemParam,body:{content:{"application/json":{schema:z.object({format:z.enum(["srt","vtt","txt","text"]),text:z.string().max(2_000_000),language:z.string().optional()})}}}},responses:{201:{description:"Imported transcript",content:{"application/json":{schema:z.any()}}},...errorResponses({400:"Transcript file could not be read",401:"Not signed in",403:"Transcripts are available to teens and adults",404:"Library item unavailable"})}}),c=>{try{const b=c.req.valid("json");return c.json(importTranscript(c.get("person"),c.req.valid("param").item,b.text,b.format,b.language),201);}catch(e){return handle(e,c);}});

const STACK_FAILED = "The Stack could not finish this. Check that the local Stack is ready, then try again.";
transcriptRoutes.openapi(createRoute({method:"post",path:"/transcripts/{id}/detect-speakers",tags:["Transcripts"],summary:"Detect who is speaking and label the lines",description:"Optional JSON body {num_speakers: 1..20}. An empty body lets the Stack count the speakers.",middleware:[requireAuth] as const,request:{params:idParam},responses:{200:{description:"The transcript, plus whether detection worked. When diarization is unavailable the transcript is unchanged and note says why.",content:{"application/json":{schema:z.object({transcript:z.any(),diarization:z.enum(["done","unavailable"]),note:z.string().nullable()})}}},...errorResponses({401:"Not signed in",403:"Transcripts are available to teens and adults",404:"Transcript unavailable",502:"Stack could not detect speakers"})}}),async c=>{
 try{const actor=c.get("person"),{id}=c.req.valid("param"),body=await c.req.json().catch(()=>({})) as {num_speakers?:unknown};
  const wanted=body.num_speakers===undefined?undefined:Number(body.num_speakers);
  if(wanted!==undefined&&(!Number.isInteger(wanted)||wanted<1||wanted>20))return c.json({error:"Give a number of speakers from 1 to 20, or leave it empty."},400);
  const outcome=await detectSpeakers(actor,id,{num_speakers:wanted});return c.json({transcript:getTranscript(actor,id),...outcome},200);
 }catch(e){if(e instanceof TranscriptError)return handle(e,c);return c.json({error:STACK_FAILED},502);}
});
transcriptRoutes.openapi(createRoute({method:"post",path:"/transcripts/{id}/regenerate-range",tags:["Transcripts"],summary:"Redo one time range of a transcript",middleware:[requireAuth] as const,request:{params:idParam,body:{content:{"application/json":{schema:z.object({start:z.number().nonnegative(),end:z.number().positive(),language:z.string().min(1).optional()})}}}},responses:{200:{description:"The transcript with only that range redone, as one revision",content:{"application/json":{schema:z.any()}}},...errorResponses({400:"Invalid range",401:"Not signed in",403:"Transcripts are available to teens and adults",404:"Transcript unavailable",409:"No speech found in that range",502:"Stack could not redo this range"})}}),async c=>{
 try{const actor=c.get("person"),{id}=c.req.valid("param");await regenerateRange(actor,id,c.req.valid("json"));return c.json(getTranscript(actor,id),200);
 }catch(e){if(e instanceof TranscriptError)return handle(e,c);return c.json({error:STACK_FAILED},502);}
});

const trackParam = z.object({ id: z.string().min(1), track: z.string().min(1) });
const findBody = z.object({
  find: z.string().max(500),
  replace: z.string().max(2000),
  match_case: z.boolean().optional(),
  whole_word: z.boolean().optional(),
});
const jsonAnswer = (description: string) => ({ description, content: { "application/json": { schema: z.any() } } });

transcriptRoutes.openapi(createRoute({
  method: "get", path: "/transcripts/{id}/caption-tracks", tags: ["Transcripts"], summary: "List caption tracks and whether each needs refreshing",
  middleware: [requireAuth] as const, request: { params: idParam },
  responses: { 200: jsonAnswer("Caption tracks"), ...errorResponses({ 401: "Not signed in", 403: "Transcripts are available to teens and adults", 404: "Transcript unavailable" }) },
}), (c) => {
  try { return c.json(listCaptionTracks(c.get("person"), c.req.valid("param").id), 200); } catch (e) { return handle(e, c); }
});

transcriptRoutes.openapi(createRoute({
  method: "post", path: "/transcripts/{id}/caption-tracks", tags: ["Transcripts"], summary: "Make a caption track from the transcript as it is now",
  middleware: [requireAuth] as const, request: { params: idParam },
  responses: { 201: jsonAnswer("The new caption track"), ...errorResponses({ 401: "Not signed in", 403: "Transcripts are available to teens and adults", 404: "Transcript unavailable" }) },
}), (c) => {
  try { return c.json(createCaptionTrack(c.get("person"), c.req.valid("param").id), 201); } catch (e) { return handle(e, c); }
});

transcriptRoutes.openapi(createRoute({
  method: "post", path: "/transcripts/{id}/caption-tracks/{track}/refresh", tags: ["Transcripts"], summary: "Rebuild a caption track from the current transcript, keeping hand-edited captions",
  middleware: [requireAuth] as const, request: { params: trackParam },
  responses: { 200: jsonAnswer("The refreshed caption track"), ...errorResponses({ 401: "Not signed in", 403: "Transcripts are available to teens and adults", 404: "Transcript or caption track unavailable" }) },
}), (c) => {
  try {
    const { id, track } = c.req.valid("param");
    return c.json(refreshCaptionTrack(c.get("person"), id, track), 200);
  } catch (e) { return handle(e, c); }
});

transcriptRoutes.openapi(createRoute({
  method: "get", path: "/transcript-languages", tags: ["Transcripts"], summary: "Languages a caption track can be translated into",
  middleware: [requireAuth] as const,
  responses: { 200: jsonAnswer("Language codes and names"), ...errorResponses({ 401: "Not signed in" }) },
}), (c) => c.json(Object.entries(TRANSLATION_LANGUAGES).map(([code, name]) => ({ code, name })), 200));

transcriptRoutes.openapi(createRoute({
  method: "post", path: "/transcripts/{id}/caption-tracks/{track}/translate", tags: ["Transcripts"], summary: "Translate a caption track into another language as its own track",
  middleware: [requireAuth] as const, request: { params: trackParam, body: { content: { "application/json": { schema: z.object({ language: z.string().min(2).max(8) }) } } } },
  responses: { 201: jsonAnswer("The new translated caption track"), ...errorResponses({ 400: "Unknown or same language", 401: "Not signed in", 403: "Transcripts are available to teens and adults", 404: "Transcript or caption track unavailable", 413: "Too many captions", 422: "Held back by the age filter", 502: "The language model could not translate" }) },
}), async (c) => {
  try {
    const { id, track } = c.req.valid("param");
    return c.json(await translateCaptionTrack(c.get("person"), id, track, c.req.valid("json").language), 201);
  } catch (e) { return handle(e, c); }
});

transcriptRoutes.openapi(createRoute({
  method: "post", path: "/transcripts/{id}/caption-tracks/{track}/burn-in", tags: ["Transcripts"], summary: "Start burning a caption track into a copy of the video",
  middleware: [requireAuth] as const, request: { params: trackParam, body: { content: { "application/json": { schema: z.object({ position: z.enum(["bottom", "middle", "top"]).default("bottom") }) } } } },
  responses: { 202: jsonAnswer("The running burn-in job"), ...errorResponses({ 400: "Audio only or no captions", 401: "Not signed in", 403: "Transcripts are available to teens and adults", 404: "Transcript, caption track or video unavailable", 413: "Too many captions" }) },
}), async (c) => {
  try {
    const { id, track } = c.req.valid("param");
    return c.json(await startBurnIn(c.get("person"), id, track, c.req.valid("json").position), 202);
  } catch (e) { return handle(e, c); }
});

transcriptRoutes.openapi(createRoute({
  method: "get", path: "/transcript-burn-ins/{job}", tags: ["Transcripts"], summary: "Progress of a caption burn-in and the new file when done",
  middleware: [requireAuth] as const, request: { params: z.object({ job: z.string().min(1).max(64) }) },
  responses: { 200: jsonAnswer("Burn-in state, progress 0 to 1, file_id when done"), ...errorResponses({ 401: "Not signed in", 404: "Burn-in not found" }) },
}), (c) => {
  try { return c.json(burnJob(c.get("person"), c.req.valid("param").job), 200); } catch (e) { return handle(e, c); }
});

transcriptRoutes.openapi(createRoute({
  method: "post", path: "/transcripts/{id}/find-replace/preview", tags: ["Transcripts"], summary: "Preview a find and replace without changing anything",
  middleware: [requireAuth] as const, request: { params: idParam, body: { content: { "application/json": { schema: findBody } } } },
  responses: { 200: jsonAnswer("Matching lines, at most 500, with a more flag"), ...errorResponses({ 400: "Nothing to find", 401: "Not signed in", 403: "Transcripts are available to teens and adults", 404: "Transcript unavailable" }) },
}), (c) => {
  try { return c.json(previewFindReplace(c.get("person"), c.req.valid("param").id, c.req.valid("json")), 200); } catch (e) { return handle(e, c); }
});

transcriptRoutes.openapi(createRoute({
  method: "post", path: "/transcripts/{id}/find-replace", tags: ["Transcripts"], summary: "Apply a find and replace as one revision",
  middleware: [requireAuth] as const,
  request: { params: idParam, body: { content: { "application/json": { schema: findBody.extend({ segment_ids: z.array(z.string()).optional() }) } } } },
  responses: { 200: jsonAnswer("The transcript and how many lines changed"), ...errorResponses({ 400: "Nothing to find", 401: "Not signed in", 403: "Transcripts are available to teens and adults", 404: "Transcript unavailable" }) },
}), (c) => {
  try {
    const actor = c.get("person"), { id } = c.req.valid("param");
    const outcome = applyFindReplace(actor, id, c.req.valid("json"));
    return c.json({ transcript: getTranscript(actor, id), ...outcome }, 200);
  } catch (e) { return handle(e, c); }
});
