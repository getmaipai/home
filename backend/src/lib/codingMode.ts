import { CodingModeReadiness, type CodingModeReadiness as Readiness } from "@maipai/spec/gen/ts/coding-mode-readiness.js";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { missingCodingPiece } from "@/lib/stackCodingPieces";
import { getStackClient } from "@/lib/stackEngine";
import { listApiKeysForAdmin } from "@/lib/apiKeys";
import { db } from "@/db";
import { people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { codingClientLater } from "@/lib/setupState";
import { chatLeaseHeld } from "@/lib/chatLease";
import { resolveIssue } from "@/lib/issues";
import reasonVocab from "@maipai/spec/vocab/coding-mode-readiness-reasons.json" with { type: "json" };

const anchors = ["Turn on coding", "Choose a coding engine", "Add the model files", "Check your computer", "Make room in memory", "Test the coding model", "Connect a coding app", "Check coding speed"];
const reasonCopy: Record<string, string> = reasonVocab as Record<string, string>;
export function codingModeReason(key: string): string { return reasonCopy[key] ?? "Home could not reach the AI engine."; }
export async function codingModeReadiness(): Promise<Readiness> {
  const base: Array<{ id: string; state: "done" | "can_do" | "manual"; reason_key: string; doc_anchor: string }> = [];
  const add = (id: string, okay: boolean, falseState: "can_do" | "manual", ix: number) => base.push({ id, state: okay ? "done" : falseState, reason_key: id, doc_anchor: anchors[ix]! });
  const codingOn = getHouseholdSettingValue("coding.enabled") === true;
  add("coding_enabled", false, "can_do", 0);
  let mode;
  let codingRoleInstalled = false;
  try {
    const client = getStackClient();
    mode = await client.getCodingMode();
    const roles = await client.roles();
    codingRoleInstalled = roles.roles.some((role) => role.id === "coding" && role.state.state !== "notInstalled");
  }
  catch {
    if (base[0]) base[0].state = "manual";
    for (const [id, ix] of [["engine",1],["pieces",2],["hardware",3],["memory",4],["self_test",5]] as const) add(id, false, "manual", ix);
    add("client", hasCodeKey() || codingClientLater(), "can_do", 6);
    add("bench", false, "manual", 7);
    return CodingModeReadiness.parse({ ready:false, first_unmet:base.find(x=>x.state!=="done")!.id, checked_at:new Date().toISOString(), items:base, provenance:"home: coding mode readiness check", hlc:nextHlc() });
  }
  if (base[0]) base[0].state = codingOn && codingRoleInstalled && !missingCodingPiece() ? "done" : codingOn ? "manual" : "can_do";
  add("engine", mode.checks.engine, "manual", 1); add("pieces", mode.checks.pieces, "can_do", 2); add("hardware", mode.checks.hardware, "manual", 3); add("memory", mode.checks.memory, "manual", 4);
  add("self_test", !!mode.self_test.passed_at && !mode.self_test.stale, "can_do", 5);
  add("client", hasCodeKey() || codingClientLater(), "can_do", 6); add("bench", mode.checks.bench, "manual", 7);
  return CodingModeReadiness.parse({ ready:base.every(x=>x.state==="done"), first_unmet:base.find(x=>x.state!=="done")?.id ?? null, checked_at:new Date().toISOString(), items:base, provenance:"home: coding mode readiness check", hlc:nextHlc() });
}
/** TIER-HOME-05 migration: coding mode is retired for the Max chat lease. A Home that restarts with the old switch on, or a Stack still in
 * coding mode with no lease, goes back to normal once; nothing else reads `coding.home_mode` any more. A missing Stack never blocks startup. */
export async function reconcileCodingModeAtStartup(): Promise<void> {
  try {
    await resolveIssue("coding_mode", "switch_failed");
    if (getHouseholdSettingValue("coding.home_mode") !== "normal") setHouseholdSettingValue("coding.home_mode", "normal");
    const stack = await getStackClient().getCodingMode();
    if (stack.mode === "coding" && !chatLeaseHeld()) {
      try { await getStackClient().setCodingMode("normal"); } catch { /* the lease's own release retries on the next idle tick */ }
    }
  } catch { /* A missing Stack must never prevent Home from starting. */ }
}
function hasCodeKey(): boolean {
  return db.select().from(people).all().some(person => listApiKeysForAdmin(person as never).some(key => key.status === "active" && key.scopes.includes("code")));
}
