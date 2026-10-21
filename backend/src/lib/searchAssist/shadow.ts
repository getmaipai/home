// ROUTER-BUILD-01d: the search assist's shadow step. It scores an eligible
// adult written turn and records a number and closed names on the turn's
// stats; it changes no reply (action is always "none"). Eligibility is
// decided first, so a child, teen or anonymous speaker never reaches an
// embed. The whole step fails open: any throw becomes off_reason "error".
// The record carries numbers and closed names only, never the utterance.
import type { TurnState } from "@/lib/turnMachine/contract";
import type { SearchAssistStats } from "@/wire";
import { getHouseholdSettingValue } from "@/lib/settings";
import { embed } from "@/lib/llm";
import type { QueryVector } from "@/lib/memory";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import { searchAssistEligibility, cappedSearchAssistMode, type MinorEligibility, type EligibilityState, type SearchAssistMode } from "./eligible";
import { loadSearchAssistWeights, type LoadedWeights, type WeightsResult } from "./weights";
import { buildFeatures, scoreHead } from "./score";
import { bumpSearchAssistCounter } from "./counters";
import { stackEmbedModel, __setStackEmbedModelReaderForTests } from "./embedIdentity";

const TOOL = "websearch";
const MISSING_RETRY_MS = 60_000;

let cache: { at: number; key: string; result: WeightsResult } | null = null;
const EXTRA_EMBED_TIMEOUT_MS = 1500;
let loader: typeof loadSearchAssistWeights = loadSearchAssistWeights;

async function weightsFor(expected: { model?: string; dims?: number }): Promise<WeightsResult> {
  const key = `${expected.model ?? ""}|${expected.dims ?? ""}`;
  if (cache && cache.key === key && (!("missing" in cache.result) || Date.now() - cache.at < MISSING_RETRY_MS)) return cache.result;
  const result = await loader({ expected });
  cache = { at: Date.now(), key, result };
  return result;
}

export function __setSearchAssistLoaderForTests(fn: typeof loadSearchAssistWeights | null): void {
  loader = fn ?? loadSearchAssistWeights;
  cache = null;
  __setStackEmbedModelReaderForTests(null);
}

export function readSearchAssistMode(): SearchAssistMode {
  const value = getHouseholdSettingValue("chat.search_assist");
  return value === "off" || value === "rescue" ? value : "shadow";
}

const record = (mode: SearchAssistMode, over: Partial<SearchAssistStats>): SearchAssistStats => ({ mode, eligible: false, bucket: "none", p_rounded: null, action: "none", ...over });

// The vector's `space` is the Stack's role alias ("embed"), not a model, so the
// model is checked against the Stack's reported embed model file (stackModel).
function sameSpace(manifest: LoadedWeights, stackModel: string, v: { dims: number; preprocess: string }): boolean {
  return manifest.embed.model === stackModel && v.dims === manifest.embed.dims && v.preprocess === manifest.embed.preprocess;
}

/** `recallVector` is the raw recall embedding when the turn made one. */
export async function runSearchAssistShadow(state: EligibilityState & Pick<TurnState, "surface" | "actor" | "speakerEvidence" | "deviceId">, utterance: string, recallVector: QueryVector | undefined, minorGate?: Omit<MinorEligibility, "recallVector">): Promise<SearchAssistStats> {
  let mode: SearchAssistMode = "shadow";
  let eligible = false;
  try {
    const band = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId);
    const minor = band !== "adult";
    const bandKey = minor ? band : undefined;
    mode = cappedSearchAssistMode(band, readSearchAssistMode());
    const eligibility = searchAssistEligibility(state, mode, minor ? { minor: { gateAllows: minorGate?.gateAllows === true, webOn: minorGate?.webOn === true, recallVector: recallVector !== undefined } } : {});
    if (!eligibility.scored) {
      const reason = eligibility.off_reason;
      if (reason === "mode_off") bumpSearchAssistCounter("off");
      else if (bandKey && (reason === "gate_not_allow" || reason === "web_off_for_mode" || reason === "no_recall_vector")) bumpSearchAssistCounter("skipped_band", bandKey);
      // anonymous, no websearch offered, or a turn shape that offers no tool.
      else bumpSearchAssistCounter("skipped_surface");
      return record(mode, { off_reason: reason });
    }
    eligible = true;
    // The real model file the Stack's embed role runs. Unknown (Stack
    // unreachable or too old to say) fails open without a Repairs row.
    const stackModel = await stackEmbedModel();
    if (!stackModel) {
      bumpSearchAssistCounter("error");
      return record(mode, { eligible: true, off_reason: "error" });
    }
    const weights = await weightsFor({ model: stackModel, ...(recallVector ? { dims: recallVector.dims } : {}) });
    if ("missing" in weights) {
      const reason = weights.missing === "embed_mismatch" ? "embed_mismatch" : "weights_missing";
      bumpSearchAssistCounter(reason);
      return record(mode, { eligible: true, off_reason: reason });
    }
    let vector: QueryVector | undefined = recallVector && weights.embed.prefix === "" && sameSpace(weights, stackModel, recallVector) ? recallVector : undefined;
    if (!vector && minor) {
      // A minor's turn never pays for a fallback embed: no usable recall vector is not scored.
      bumpSearchAssistCounter("skipped_band", bandKey);
      return record(mode, { eligible: false, off_reason: "no_recall_vector" });
    }
    if (!vector) {
      // Temporary chats, a failed recall embed, or a prefixed head: one extra
      // embed through the Stack's embed role.
      // A shadow step never holds the turn: a slow Stack costs a bounded wait.
      const result = await Promise.race([
        embed([`${weights.embed.prefix}${utterance}`]),
        new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), EXTRA_EMBED_TIMEOUT_MS).unref?.()),
      ]);
      if (!result.ok) {
        bumpSearchAssistCounter("error");
        return record(mode, { eligible: true, off_reason: "error" });
      }
      const v = result.value.vectors[0]!;
      vector = { vector: Float32Array.from(v), space: result.value.model, dims: v.length, preprocess: result.value.preprocess };
    }
    if (!sameSpace(weights, stackModel, vector)) {
      bumpSearchAssistCounter("embed_mismatch");
      return record(mode, { eligible: true, off_reason: "embed_mismatch" });
    }
    // A pair or concat head takes the previous exchange too; until that text
    // shape is fixed (RAW-01) the shadow step scores the standalone message.
    const features = buildFeatures({ alone: Array.from(vector.vector) }, weights);
    if (!features) {
      bumpSearchAssistCounter("embed_mismatch");
      return record(mode, { eligible: true, off_reason: "embed_mismatch" });
    }
    const head = scoreHead(features, weights, TOOL);
    bumpSearchAssistCounter("scored", bandKey);
    if (head.over) bumpSearchAssistCounter("over_threshold", bandKey);
    return record(mode, { eligible: true, bucket: head.bucket, p_rounded: Math.round(head.p * 100) / 100 });
  } catch {
    try {
      bumpSearchAssistCounter("error");
    } catch {
      // counters never fail a turn
    }
    return record(mode, { eligible, off_reason: "error" });
  }
}
