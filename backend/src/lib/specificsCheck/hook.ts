import { getHouseholdSettingValue } from "@/lib/settings";
import { hasFactCue } from "@/lib/turnMachine/fabrication";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import type { TurnState } from "@/lib/turnMachine/contract";
import { runSpecificsCheck } from "./check";
import { bumpSpecificsCheckCounter } from "./counters";

let runner: typeof runSpecificsCheck = runSpecificsCheck;
export function __setSpecificsCheckRunnerForTests(value: typeof runSpecificsCheck | null): void { runner = value ?? runSpecificsCheck; }

export async function checkReleasedSpecifics(state: Pick<TurnState, "surface" | "actor" | "speakerEvidence" | "deviceId" | "outcomes" | "memoryTrace">, question: string, reply: string): Promise<void> {
  try {
    if (getHouseholdSettingValue("chat.specifics_check") !== "shadow") return;
    const band = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId);
    const evidence = state.speakerEvidence;
    const unidentified = state.surface === "robot" || (evidence != null && (evidence.level === "unknown" || evidence.person !== state.actor.id));
    if (band !== "adult" || unidentified) { bumpSpecificsCheckCounter("skipped"); return; }
    if (state.outcomes.length > 0 || !hasFactCue(reply)) return;
    const result = await runner({ question, reply, memoryInjected: Boolean(state.memoryTrace && Object.keys(state.memoryTrace).length > 0) });
    bumpSpecificsCheckCounter("checked");
    bumpSpecificsCheckCounter(result);
  } catch {
    // This observer must never affect a released turn.
    try { bumpSpecificsCheckCounter("checked"); bumpSpecificsCheckCounter("unavailable"); } catch { /* fail open */ }
  }
}
