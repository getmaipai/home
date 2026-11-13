import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
  test("all gates fit the cap", () => {
    const full = withTurnToolGates(resolveTurnBudgetBase("qwen3-8b-instruct-q4-k-m", "adult"), true, true, true, true, true, false, false, true, "none", true, true, true);
    expect(full.tools_offered.length).toBeLessThanOrEqual(16);
  });
  test("TOOL-OFFER-VOICEOVER-01: no code in turnMachine reads the person's wording for the voice tools", () => {
    const root = join(import.meta.dir, "../src/lib/turnMachine");
    const files: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const full = join(dir, name); if (statSync(full).isDirectory()) walk(full); else if (full.endsWith(".ts")) files.push(full); } };
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const code = readFileSync(file, "utf8").split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).map((line) => line.replace(/\s\/\/.*$/, "")).join("\n");
      expect(code, file).not.toMatch(/voice\[- \]\?over|VOICEOVER_INTENT|\/[^/\n]*narrat[^/\n]*\/[a-z]*\s*\.test\(|\/[^/\n]*(?:aloud|out loud)[^/\n]*\/[a-z]*\s*\.test\(/i);
    }
  });
  test("TOOL-OFFER-VOICEOVER-01: an adult written turn is offered voiceover whatever it says or attaches", async () => {
    const adult = person("owner", 40);
    for (const text of ["hello", "Read this out loud as a narrator", "make a voice-over for my clip maipai://audio/track/abc123", "what is the weather"]) {
      expect((await budgetWithTurnToolGates(input(adult, { text }))).budget.tools_offered).toContain(VOICEOVER_TOOL_ID);
    }
  });
  test("TOOL-OFFER-VOICEOVER-01: a child, a teen, a guest and a spoken turn get no voice tools, whatever the message says", async () => {
    const child = person("child", 10), teen = person("teen", 15), guest = person("guest", 30), adult = person("owner", 40);
    for (const [actor, over] of [[child, { band: "child" }], [teen, { band: "teen" }], [guest, {}], [adult, { spoken: true, surfaceClass: "spoken" }]] as const) {
      const offered = (await budgetWithTurnToolGates(input(actor, { ...over, text: "Make a voice-over of this narration, read it out loud" }))).budget.tools_offered;
      expect(offered).not.toContain(VOICEOVER_TOOL_ID);
      expect(offered).not.toContain(CHANGE_VOICE_TOOL_ID);
    }
  });
  test("TOOL-OFFER-VOICEOVER-01: at the cap change_voice gives way first and voiceover displaces a media tool, never past sixteen", () => {
    const base = resolveTurnBudgetBase("qwen3-8b-instruct-q4-k-m", "adult");
    const full = withTurnToolGates(base, true, true, true, true, true, false, false, true, "none", true, true, true, true, true, true);
    expect(full.tools_offered.length).toBeLessThanOrEqual(16);
    expect(full.tools_offered).toContain(VOICEOVER_TOOL_ID);
    expect(full.tools_offered).not.toContain(CHANGE_VOICE_TOOL_ID);
    // With room, both voice tools stay.
    const roomy = withTurnToolGates(base, true, false, false, false, false, false, false, false, null, false, false, true);
    expect(roomy.tools_offered).toEqual(expect.arrayContaining([VOICEOVER_TOOL_ID, CHANGE_VOICE_TOOL_ID]));
    // A cap with no room even after the swap (nothing media to displace) gives up voiceover instead of failing the turn.
    const without = withTurnToolGates(base, false).tools_offered.length;
    const tight = withTurnToolGates({ ...base, max_tools: without }, false, false, false, false, false, false, false, false, null, false, false, true);
    expect(tight.tools_offered).toHaveLength(without);
    expect(tight.tools_offered).not.toContain(VOICEOVER_TOOL_ID);
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
