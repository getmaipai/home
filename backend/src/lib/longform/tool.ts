import { z } from "zod";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome, TurnState } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { allowed } from "@/lib/films/background";
import { isProducing, produce, progressOf } from "./runner";
import { getDocument } from "./documents";
import { approveStage, startProduction, writeBible, writeOutline, type Bible, type Outline, type StageResult, type Treatment } from "./stages";

// LONGFORM-01: one tool, `make_film`, covers both: a short film is planned in one go, anything past what one film holds becomes a production
// written in steps. (A second tool would pass the sixteen-tool cap for every adult with music and video on.)
export const MAKE_PRODUCTION_TOOL_ID = "make_film";
export const FILM_MAX_SECONDS = 120;
/** True when a make_film call is for a production: it names one, or asks for more than one film holds. */
export function isProductionCall(args: Record<string, unknown>): boolean {
  return typeof args.production_id === "string" || (typeof args.seconds === "number" && args.seconds > FILM_MAX_SECONDS);
}
export const makeProductionArgs = z.object({
  idea: z.string().trim().min(3).max(4000).optional(),
  seconds: z.number().int().min(20).max(14400).optional(),
  look: z.string().trim().min(1).max(160).optional(),
  production_id: z.string().trim().min(1).max(120).optional(),
  approve: z.boolean().optional(),
});

type ProductionState = Pick<TurnState, "actor" | "surface" | "planBasis" | "temporary">;

function reply(callId: string, args: Record<string, unknown>, text: string, data: Record<string, unknown>): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: MAKE_PRODUCTION_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text }, data, actions: [] } });
}
const refused = (callId: string, args: Record<string, unknown>, line: string, why: string) =>
  reply(callId, args, `No production was started. Say this to the person in your own words and keep its meaning: ${line}`, { refused: why });

/** What the person reads next, kept short: the model retells it. */
function describe(actor: PersonRow, productionId: string, stage: "treatment" | "bible" | "outline"): string {
  const json = getDocument(actor, productionId, stage)?.json;
  if (stage === "treatment") { const t = json as Treatment; return `Treatment "${t.title}": ${t.logline} Look: ${t.look}. Tone: ${t.tone}.`; }
  if (stage === "bible") { const b = json as Bible; return `Cast: ${b.cast.map((c) => c.name).join(", ")}. Places: ${b.locations.map((l) => l.name).join(", ") || "none"}. Music: ${b.music.map((m) => m.name).join(", ") || "none"}.`; }
  const o = json as Outline; return `${o.scenes.length} scenes: ${o.scenes.map((s) => s.title).join("; ")}.`;
}

const NEXT: Record<string, string> = {
  treatment: "Tell the person the treatment in a few sentences and ask if it is good or what to change. When they say go on, call this tool again with production_id and approve true.",
  bible: "Tell the person the cast, places and music in a few sentences and ask if they are good. Nothing is made into pictures until they approve this.",
  outline: "Tell the person the scenes in a few sentences and ask if they are good. When they approve, every scene is written and made in the background.",
};

export async function runMakeProduction(input: { state: ProductionState; args: Record<string, unknown>; callId: string; spoken: boolean }): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const parsed = makeProductionArgs.safeParse(args);
  if (!parsed.success) return outcomeOf({ callId, packageId: MAKE_PRODUCTION_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: "bad_arguments", failureKind: "bad_arguments", durationMs: 0 });
  const actor = state.actor as PersonRow;
  if (!allowed(actor)) return refused(callId, args, "Long productions are for adults on their own written screen.", "not_allowed");
  const a = parsed.data;

  if (!a.production_id) {
    if (!a.idea) return refused(callId, args, "Ask what the story is about.", "needs_idea");
    if (!a.seconds) return refused(callId, args, "Ask how long it should be.", "needs_length");
    const r = await startProduction(actor, { idea: a.idea, seconds: a.seconds, look: a.look });
    return r.ok
      ? reply(callId, args, `${describe(actor, r.productionId, "treatment")} ${NEXT.treatment}`, { productionId: r.productionId, stage: "treatment", scenes: r.structure.scenes.length })
      : refused(callId, args, r.line, "not_started");
  }

  const id = a.production_id;
  const have = (k: "treatment" | "bible" | "outline") => getDocument(actor, id, k);
  if (!have("treatment")) return refused(callId, args, "That production is not available.", "unknown");
  if (!a.approve) {
    const last = have("outline") ? "outline" : have("bible") ? "bible" : "treatment";
    return reply(callId, args, `${describe(actor, id, last)} ${NEXT[last]}`, { productionId: id, stage: last });
  }
  // The person said it is good: approve the latest written part and write the next one.
  let result: StageResult | null = null; let stage: "treatment" | "bible" | "outline";
  if (!have("bible")) { approveStage(actor, id, "treatment"); result = await writeBible(actor, id); stage = "bible"; }
  else if (!have("outline")) { approveStage(actor, id, "bible"); result = await writeOutline(actor, id); stage = "outline"; }
  else {
    approveStage(actor, id, "outline");
    if (isProducing(id)) { const p = progressOf(actor, id); return reply(callId, args, `Already being made: ${p.scenes_done} of ${p.scenes_total} scenes done.${p.seconds_left === null ? "" : ` About ${Math.ceil(p.seconds_left / 60)} minutes left.`}`, { productionId: id, stage: "producing", ...p }); }
    void produce(actor, id).catch((e) => console.error("[longform] produce failed", id, e));
    return reply(callId, args, "The outline is approved and the scenes are being written and made now, one after another. Tell the person it runs in the background, can take a long time, and they can ask how far along it is by naming the production.", { productionId: id, stage: "producing", approved: true });
  }
  return result.ok ? reply(callId, args, `${describe(actor, id, stage)} ${NEXT[stage]}`, { productionId: id, stage }) : refused(callId, args, result.line, "stage_failed");
}
