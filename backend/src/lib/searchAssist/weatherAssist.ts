// RECENCY-02: the weather detector, the weather sibling of the search assist. Same pieces, no new engine: the raw
// sentence embedding Home already makes for memory, one linear head (weather-head.json, trained by
// scripts/train/weatherHead.ts and shipped in this release, nothing downloaded), a recorded threshold, the same
// `chat.search_assist` setting as its kill switch (off scores nothing, shadow only records, rescue acts).
//
// Rescue: when the model's first round answers in plain text with no tool call, the weather tool is offered, a
// household home is set and the detector is over its threshold, the engine's place writer reads the place the person
// named (or none) and the weather tool is called, the model then phrases the result. The model's own call always wins.
// Unlike the search rescue it applies to spoken turns and to every age band (owner, 2026-10-21: the rescue is about
// the decision, not where the words came from; weather is allowed for every band, WEATHER-KID-01); the reply still goes
// through the band's output gate, and an anonymous speaker is rescued the same as a known one.
import type { TurnState } from "@/lib/turnMachine/contract";
import type { SearchAssistStats } from "@/wire";
import type { QueryVector } from "@/lib/memory";
import { embed } from "@/lib/llm";
import { householdHomePlaceName } from "@/lib/places";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import type { EligibilityState, SearchAssistMode } from "./eligible";
import { readSearchAssistMode } from "./shadow";
import { stackEmbedModel } from "./embedIdentity";
import { buildFeatures, scoreHead } from "./score";
import { parseSearchAssistManifest, type SearchAssistManifest } from "./weights";
import { bumpSearchAssistCounter } from "./counters";
import shipped from "./weather-head.json";

export const WEATHER_TOOL = "weather";
const EXTRA_EMBED_TIMEOUT_MS = 1500;

let head: SearchAssistManifest | null | undefined;
let headOverride: SearchAssistManifest | null | undefined;
/** The shipped head, parsed once; null when the file does not parse (the assist then does nothing). */
export function weatherHead(): SearchAssistManifest | null {
  if (headOverride !== undefined) return headOverride;
  if (head === undefined) {
    try { head = parseSearchAssistManifest(shipped); } catch { head = null; }
  }
  return head;
}
export function __setWeatherHeadForTests(manifest: SearchAssistManifest | null | undefined): void { headOverride = manifest; }

export type WeatherEligibilityState = EligibilityState;
export type WeatherOffReason = "mode_off" | "no_weather_tool" | "no_tools_turn" | "no_home" | "weights_missing" | "embed_mismatch" | "no_recall_vector" | "error";

function noToolsTurn(state: WeatherEligibilityState): boolean {
  return state.bare === true || state.continuation !== undefined || state.crisis === true || state.promptLimit !== undefined;
}

/** Who the detector may score and rescue. No band and no surface gate (see the header); the tool being offered, a home
 * being set and a turn that offers tools at all are the only conditions, and the rescue needs round 1 with no call. */
export function weatherAssistEligibility(state: WeatherEligibilityState, mode: SearchAssistMode, ctx: { modelToolCalls?: number } = {}): { scored: boolean; rescuable: boolean; off_reason?: WeatherOffReason } {
  const no = (off_reason: WeatherOffReason) => ({ scored: false, rescuable: false, off_reason });
  if (mode === "off") return no("mode_off");
  if (!state.budget.tools_offered.includes(WEATHER_TOOL)) return no("no_weather_tool");
  if (noToolsTurn(state)) return no("no_tools_turn");
  if (householdHomePlaceName() === null) return no("no_home");
  return { scored: true, rescuable: mode === "rescue" && state.outcomes.length === 0 && ctx.modelToolCalls === 0 };
}

const record = (mode: SearchAssistMode, over: Partial<SearchAssistStats>): SearchAssistStats => ({ mode, eligible: false, bucket: "none", p_rounded: null, action: "none", ...over });

/** The detector's record for a turn. Fails open: any problem is an off_reason on the record and the turn runs as before. */
export async function runWeatherAssistShadow(state: WeatherEligibilityState & Pick<TurnState, "surface" | "actor" | "speakerEvidence" | "deviceId">, utterance: string, recallVector: QueryVector | undefined): Promise<SearchAssistStats> {
  let mode: SearchAssistMode = "shadow";
  try {
    mode = readSearchAssistMode();
    const eligibility = weatherAssistEligibility(state, mode);
    if (!eligibility.scored) return record(mode, { off_reason: eligibility.off_reason });
    const manifest = weatherHead();
    if (!manifest) { bumpSearchAssistCounter("weights_missing"); return record(mode, { eligible: true, off_reason: "weights_missing" }); }
    const stackModel = await stackEmbedModel();
    if (!stackModel || manifest.embed.model !== stackModel) { bumpSearchAssistCounter("embed_mismatch"); return record(mode, { eligible: true, off_reason: "embed_mismatch" }); }
    const same = (v: QueryVector) => v.dims === manifest.embed.dims && v.preprocess === manifest.embed.preprocess;
    let vector = recallVector && manifest.embed.prefix === "" && same(recallVector) ? recallVector : undefined;
    const band = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId);
    // The search assist's rule stands here too: a minor's turn never pays for a fallback embed of their words.
    if (!vector && band !== "adult") return record(mode, { eligible: false, off_reason: "no_recall_vector" });
    if (!vector) {
      // One extra embed through the Stack's embed role, bounded: a slow Stack never holds the turn.
      const result = await Promise.race([
        embed([`${manifest.embed.prefix}${utterance}`]),
        new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), EXTRA_EMBED_TIMEOUT_MS).unref?.()),
      ]);
      if (!result.ok) { bumpSearchAssistCounter("error"); return record(mode, { eligible: true, off_reason: "error" }); }
      const v = result.value.vectors[0]!;
      vector = { vector: Float32Array.from(v), space: result.value.model, dims: v.length, preprocess: result.value.preprocess };
    }
    if (!same(vector)) { bumpSearchAssistCounter("embed_mismatch"); return record(mode, { eligible: true, off_reason: "embed_mismatch" }); }
    const features = buildFeatures({ alone: Array.from(vector.vector) }, manifest);
    if (!features) { bumpSearchAssistCounter("embed_mismatch"); return record(mode, { eligible: true, off_reason: "embed_mismatch" }); }
    const score = scoreHead(features, manifest, WEATHER_TOOL);
    bumpSearchAssistCounter("weather_scored", band);
    if (score.over) bumpSearchAssistCounter("weather_over_threshold", band);
    return record(mode, { eligible: true, bucket: score.bucket, p_rounded: Math.round(score.p * 100) / 100 });
  } catch {
    try { bumpSearchAssistCounter("error"); } catch { /* counters never fail a turn */ }
    return record(mode, { off_reason: "error" });
  }
}
