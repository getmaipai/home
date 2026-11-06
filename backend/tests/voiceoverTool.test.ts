import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { resolveTurnBudgetBase, withTurnToolGates } from "@/lib/turnMachine/budget";
import { budgetWithTurnToolGates } from "@/lib/turnMachine/toolGates";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { VOICEOVER_TOOL_ID, CHANGE_VOICE_TOOL_ID, runVoiceoverTool, voiceoverToolSpec } from "@/lib/voiceTools";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

function person(role: string, age: number): PersonRow {
  const now = new Date().toISOString(); const id = `voice-tool-${role}`;
  db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", birthdate: new Date(Date.now() - age * 365.25 * 86400000).toISOString().slice(0, 10), createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
const input = (actor: PersonRow, overrides: Record<string, unknown> = {}) => ({ budget: resolveTurnBudgetBase(undefined, "adult"), actor, band: "adult" as const, surface: "chat" as const, surfaceClass: "written" as const, spoken: false, temporary: false, bare: false, ephemeral: false, text: "hello", musicEditAvailable: () => false, ...overrides });
beforeEach(() => { resetDb(); __setRoleHealthForTests({ voice: { availability: "ready", reason: null } }); });

describe("voice chat tools", () => {
  test("adult written offer requires voice readiness and every other audience/surface stays out", async () => {
    const adult = person("owner", 40), teen = person("teen", 15), child = person("child", 10), guest = person("guest", 30);
    const offers = async (actor: PersonRow, over = {}) => (await budgetWithTurnToolGates(input(actor, over))).budget.tools_offered;
    expect(await offers(adult)).toContain(VOICEOVER_TOOL_ID);
    expect(await offers(teen, { band: "teen" })).not.toContain(VOICEOVER_TOOL_ID);
    expect(await offers(child, { band: "child" })).not.toContain(CHANGE_VOICE_TOOL_ID);
    expect(await offers(guest)).not.toContain(VOICEOVER_TOOL_ID);
    expect(await offers(adult, { spoken: true, surfaceClass: "spoken" })).not.toContain(VOICEOVER_TOOL_ID);
    __setRoleHealthForTests({ voice: { availability: "unavailable", reason: "down" } });
    expect(await offers(adult)).not.toContain(VOICEOVER_TOOL_ID);
  });
  test("all gates fit the cap and voiceover tools shrink first", () => {
    const full = withTurnToolGates(resolveTurnBudgetBase("qwen3-8b-instruct-q4-k-m", "adult"), true, true, true, true, true, false, false, true, "none", true, true, true);
    expect(full.tools_offered.length).toBeLessThanOrEqual(16);
  });
  test("policy denies a call that was not offered", async () => {
    const actor = person("owner", 40); const state = { ...input(actor), voiceoverAllowed: false, context: [], crisis: false } as unknown as TurnState;
    const result = await policyNode(state, { calls: [{ id: "v", tool: VOICEOVER_TOOL_ID, args: { script: "hello" } }] }, new AbortController().signal);
    expect(result.output.entries[0]?.decision).toMatchObject({ allow: false, reason: "format_not_here" });
  });
  test("validates args; result persistence never contains a spoken script", async () => {
    const actor = person("owner", 40);
    expect(voiceoverToolSpec().args).toMatchObject({ required: ["script"] });
    const invalid = await runVoiceoverTool(actor, { script: "" }, "bad"); expect(invalid.status).toBe("failed");
    const result = await runVoiceoverTool(actor, { script: "secret exact words", voice: "not-a-voice" }, "call");
    expect(JSON.stringify(result)).not.toContain("secret exact words");
  });
});
