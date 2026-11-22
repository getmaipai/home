// Shared setup for the Code session tests: people, the Max lease with a fake swap, the fake agent and sandbox, and the queue provider.
import { db } from "@/db";
import { people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newPersonId } from "@/lib/id";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setMissingCodingPieceForTests } from "@/lib/stackCodingPieces";
import { createChatLease, registerActiveChatLease } from "@/lib/chatLease";
import { isolateQueueProvidersForTests, registerQueueProvider } from "@/lib/jobs/householdQueue";
import { __resetCodingTurnsForTests, __setCodingRetryMsForTests, codingQueueProvider, setCodingRuntime } from "@/lib/codingTurns";
import { __resetBridgeForTests } from "@/lib/codingBridge";
import { fakeAgent, fakeSandbox } from "./codingFakes";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

export const ENV = "cenv-abcdef12";
export const input = (over: object = {}) => ({ title: "Fix the thermostat bug", repo: { kind: "none" as const, base_branch: "main", work_branch: "code/fix" }, environment_id: ENV, ...over });
export function person(role: "owner" | "adult" | "teen" | "child" = "adult"): PersonRow {
  const id = newPersonId(); const at = new Date().toISOString();
  return db.insert(people).values({ id, displayName: "Willow", role, avatarSeed: id, source: "hub", createdAt: at, updatedAt: at, hlc: nextHlc() }).returning().get() as PersonRow;
}
export const owner = () => person("owner");
export const settled = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 5)); };

export function startRig(agentOver: Parameters<typeof fakeAgent>[0] = {}) {
  resetDb(); const restore = isolateQueueProvidersForTests(); __resetCodingTurnsForTests(); __resetBridgeForTests(); __setCodingRetryMsForTests(20);
  setHouseholdSettingValue("coding.enabled", true); setHouseholdSettingValue("coding.adults_by_default", true); __setMissingCodingPieceForTests(null);
  for (const tier of ["boost", "max"]) setHouseholdSettingValue(`engines.coding.tier.${tier}`, { model: "recommended", options: {} });
  const swaps: string[] = [];
  const lease = createChatLease({ now: Date.now, ready: async () => true, swapToBig: async () => { swaps.push("big"); }, swapToStandard: async () => { swaps.push("standard"); } });
  registerActiveChatLease(lease); registerQueueProvider(codingQueueProvider);
  const agent = fakeAgent(agentOver); const sandbox = fakeSandbox();
  setCodingRuntime({ agent: agent.agent, sandbox: sandbox.sandbox, lease: () => lease });
  return { restore: () => { restore(); __resetCodingTurnsForTests(); __resetBridgeForTests(); registerActiveChatLease(null); }, swaps, lease, agent, sandbox };
}
