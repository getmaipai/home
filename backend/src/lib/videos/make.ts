// VIDEO-CREATE-01: "Make a video" on the Create page. One entry point for the page's action (`/api/plugins/videos/actions/make`) and the
// plain route (`POST /api/videos/make`). It holds no generation logic of its own: after the same gate the other routes use, it calls
// `runGenerateVideo`, the one definition the chat tool also runs, as the person's own screen with no chat behind it.
import type { PersonRow } from "@/types";
import { runGenerateVideo } from "./tool";
import { getVideoJobFor, type VideoJob } from "./jobs";
import { videoRecipeFor } from "./recipes";
import { MAX_NEEDS_ADMIN_LINE, tierArgument } from "@/lib/tiers";
import { speakerAgeBand } from "@/lib/ageBand";
import { laneOf } from "@/lib/pictures/lane";
import { videoDenial, VIDEO_DENIAL_LINE, type VideoAudience } from "./policy";

export const MINOR_MAKE_LINE = "Making videos on the Create page is for adults. Ask an adult in your home to help.";

export interface MakeVideoBody { prompt: string; orientation?: "landscape" | "portrait"; seconds?: number; tier?: "standard" | "boost" | "max"; recipe?: string }
export type MakeVideoResult = { ok: true; job: VideoJob } | { ok: false; status: 403 | 422 | 502 | 503; error: string; code: string };

/** The audience of the Create page: the signed-in person on their own written screen. */
export function makeAudienceOf(actor: PersonRow): VideoAudience {
  return { actor, band: speakerAgeBand(actor, new Date()), surface: "chat", surfaceClass: "written", spoken: false };
}

/** Read what the page sent: a form sends text for every field, so words and numbers are taken as typed. Returns a plain error line when a value is unusable. */
export function readMakeBody(raw: Record<string, unknown>): { ok: true; body: MakeVideoBody } | { ok: false; error: string } {
  // A row action leaves `{name}` in place for a field the person never filled, and the camera-move picker has a "none" option; both mean not given.
  const notGiven = (value: unknown): boolean => typeof value === "string" && (/^\{[a-z_]+\}$/.test(value.trim()) || value.trim().toLowerCase() === "none");
  raw = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, notGiven(value) ? "" : value]));
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (prompt.length < 3 || prompt.length > 1200) return { ok: false, error: "Describe the video in 3 to 1200 characters, then try again." };
  const text = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
  const body: MakeVideoBody = { prompt };
  const orientation = text(raw.orientation);
  if (orientation) {
    if (orientation !== "landscape" && orientation !== "portrait") return { ok: false, error: "Choose landscape or portrait for the shape, or leave it empty." };
    body.orientation = orientation;
  }
  const secondsRaw = typeof raw.seconds === "number" ? raw.seconds : typeof raw.seconds === "string" && raw.seconds.trim() !== "" ? Number(raw.seconds) : undefined;
  if (secondsRaw !== undefined) {
    if (!Number.isFinite(secondsRaw) || secondsRaw < 1 || secondsRaw > 30) return { ok: false, error: "Choose a length from 1 to 30 seconds, or leave it empty." };
    body.seconds = Math.round(secondsRaw);
  }
  const tier = text(raw.tier);
  if (tier) {
    if (tier !== "standard" && tier !== "boost" && tier !== "max") return { ok: false, error: "Choose Standard, Boost or Max for the level, or leave it empty." };
    body.tier = tier;
  }
  const recipe = typeof raw.recipe === "string" ? raw.recipe.trim() : "";
  if (recipe) {
    if (!videoRecipeFor(recipe)) return { ok: false, error: "That camera move is not in the list. Use a name from the list on this page, or leave it empty." };
    body.recipe = recipe;
  }
  return { ok: true, body };
}

export async function makeVideoFor(actor: PersonRow, body: MakeVideoBody): Promise<MakeVideoResult> {
  const audience = makeAudienceOf(actor);
  // Create is for adults on their own screen; nobody under adult is a maker here, whatever the household switch for them says.
  const denial = videoDenial(audience);
  if (denial === "minor" || (denial === null && laneOf(audience) !== "adult")) return { ok: false, status: 403, error: MINOR_MAKE_LINE, code: "minor" };
  if (denial) return { ok: false, status: 403, error: VIDEO_DENIAL_LINE[denial], code: denial };
  // A level this person may not use is refused with one plain line (the chat tool lowers it and says so instead).
  if (body.tier && tierArgument({ person: actor, category: "video", arg: body.tier, band: audience.band }).line === MAX_NEEDS_ADMIN_LINE) {
    return { ok: false, status: 422, error: MAX_NEEDS_ADMIN_LINE, code: "max_needs_admin" };
  }
  const outcome = await runGenerateVideo({
    state: { actor, persona: null, conversationId: null, turnId: null, temporary: false },
    args: { prompt: body.prompt, ...(body.orientation ? { orientation: body.orientation } : {}), ...(body.seconds ? { seconds: body.seconds } : {}), ...(body.tier ? { tier: body.tier } : {}), ...(body.recipe ? { recipe: body.recipe } : {}) },
    callId: "make", spoken: false, audience,
  });
  const data = outcome.result?.data as { videoJobId?: string; refused?: string } | undefined;
  if (outcome.status === "succeeded" && data?.videoJobId) {
    const job = getVideoJobFor(actor, data.videoJobId);
    if (job) return { ok: true, job };
  }
  if (outcome.status === "succeeded") {
    // A refusal keeps its own line in the reply, after the instruction to the model; the person reads the line alone.
    const line = (outcome.result?.reply?.text ?? "").replace(/^No (?:new )?video was (?:made|started)\. Say this to the person in your own words and keep its meaning:\s*/, "").trim();
    return { ok: false, status: 422, error: line || "That video could not be started. Change the words and try again.", code: data?.refused ?? "refused" };
  }
  if (outcome.failureKind === "bad_arguments") return { ok: false, status: 422, error: "Describe the video in 3 to 1200 characters, then try again.", code: "bad_arguments" };
  return { ok: false, status: outcome.failureKind === "unavailable" ? 503 : 502, error: outcome.detail ?? "The video could not be made. Try again in a minute.", code: outcome.errorCode ?? "failed" };
}
