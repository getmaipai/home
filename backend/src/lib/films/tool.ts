import { z } from "zod";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome, TurnState } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { refuseVideoPrompt, VIDEO_REFUSAL_LINE } from "@/lib/videos/policy";
import { startFilm } from "./background";
import { checkTrack } from "@/lib/videos/editGate";
import { prepareFilmPictures } from "./pictures";

export const MAKE_FILM_TOOL_ID = "make_film";
export const makeFilmArgs = z.object({
  idea: z.string().trim().min(3).max(4000),
  shots: z.number().int().min(4).max(12).optional(),
  seconds: z.number().int().min(10).max(300).optional(),
  look: z.string().trim().min(1).max(160).optional(),
  characters: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  /** FILM-PICTURES-01: set by Home from the attached pictures (what each one is for); never by the model. */
  picture_notes: z.array(z.string().trim().min(1).max(700)).max(8).optional(),
  /** MP-06: a song of the person's own to use as the film's music instead of making one: a song's job id or Library file id, or "latest" for the newest finished song. */
  track: z.string().trim().min(1).max(80).optional(),
  go_ahead: z.boolean().optional(),
  stills_first: z.boolean().optional().describe("Make the pictures first and stop, so the person can play the animatic before any clip is rendered."),
  faceless: z.boolean().optional().default(false),
});

type FilmState = Pick<TurnState, "actor" | "surface" | "planBasis" | "temporary"> & Partial<Pick<TurnState, "conversationId">>;
type Starter = typeof startFilm;
let starter: Starter = startFilm;
export function __setStartFilmForTests(fn: Starter | null): void { starter = fn ?? startFilm; }

function refused(callId: string, args: Record<string, unknown>, line: string, why: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: MAKE_FILM_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: { reply: { text: `No film was started. Say this to the person in your own words and keep its meaning: ${line}` }, data: { refused: why }, actions: [] } });
}
function failed(callId: string, args: Record<string, unknown>): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: MAKE_FILM_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: "bad_arguments", failureKind: "bad_arguments", durationMs: 0 });
}

/** A turn with pictures attached: read each one, save it as cast, and hand the planner what each is for. Without pictures this is runMakeFilm. */
export async function runMakeFilmTurn(input: { state: FilmState & Partial<Pick<TurnState, "images" | "conversationId">>; args: Record<string, unknown>; callId: string; spoken: boolean }): Promise<ToolExecutionOutcome> {
  const images = input.state.images ?? [];
  if (!images.length) return runMakeFilm(input);
  // The model often fills `characters` with the pictures' file names; those say nothing, so attached pictures are always read, and only names that are
  // not file names (a saved character or a synth) are kept from the model's list.
  const given = (Array.isArray(input.args.characters) ? input.args.characters : []).filter((name): name is string => typeof name === "string" && !FILE_NAME.test(name.trim()));
  const prepared = await prepareFilmPictures(input.state.actor as PersonRow, { images, conversationId: input.state.conversationId });
  if (!prepared.ok) return refused(input.callId, input.args, prepared.line, "pictures");
  return runMakeFilm({ ...input, args: { ...input.args, characters: given.length ? given : undefined, picture_notes: prepared.hints.slice(0, 8) } });
}
const FILE_NAME = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i;

export function runMakeFilm(input: { state: FilmState; args: Record<string, unknown>; callId: string; spoken: boolean }): ToolExecutionOutcome {
  const { state, args, callId } = input;
  const parsed = makeFilmArgs.safeParse(args);
  if (!parsed.success) return failed(callId, args);
  const { actor } = state;
  const idea = parsed.data.idea;
  const refusal = refuseVideoPrompt(idea, { lane: "adult" });
  if (refusal) return refused(callId, args, VIDEO_REFUSAL_LINE[refusal], refusal);
  // MP-06: the person's own song as the film's music; a song that is locked, unfinished or not theirs is refused with its own plain line.
  let musicFileId: string | undefined;
  if (parsed.data.track) {
    const checked = checkTrack(actor as PersonRow, parsed.data.track, state.temporary === true, state.conversationId ?? null);
    if (!checked.ok) return refused(callId, args, checked.line, checked.why);
    if (!checked.found.fileId || state.temporary === true) return refused(callId, args, "I can't find that song. A film can only use one of your saved songs.", "no_track");
    musicFileId = checked.found.fileId;
  }
  const result = starter({ actor: actor as PersonRow, idea, musicFileId, shots: parsed.data.shots, seconds: parsed.data.seconds, look: parsed.data.look, castHints: [...(parsed.data.characters ?? []), ...(parsed.data.picture_notes ?? [])], faceless: parsed.data.faceless, goAhead: parsed.data.go_ahead === true, stillsFirst: parsed.data.stills_first === true });
  if ("line" in result) return refused(callId, args, result.line, "not_started");
  const awaitingGo = parsed.data.go_ahead !== true;
  return outcomeOf({ callId, packageId: MAKE_FILM_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: { reply: { text: awaitingGo ? "The film is planned and waiting for the person to press Go." : "The film has started." }, data: { filmRunId: result.id, awaitingGo }, actions: [] } });
}
