import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { attachments, clonedVoices, conversationTurns, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { createAttachment } from "@/lib/attachments";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { clonedVoicesDir } from "@/lib/paths";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { encodeWavClip } from "@/lib/voiceShift";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, IDENTITY_HEADERS, type StackFixture } from "./stackFixture";
import { makeInspiredVoiceToolSpec, MAKE_INSPIRED_VOICE_TOOL_ID, runMakeInspiredVoiceTool } from "@/lib/voiceTools";

function person(name: string, role: string) {
  const now = new Date().toISOString();
  const row = { id: newPersonId(), displayName: name, role, avatarSeed: name, source: "manual", createdAt: now, updatedAt: now, hlc: `1:0:${name}` };
  db.insert(people).values(row).run();
  return db.select().from(people).where(eq(people.id, row.id)).get()!;
}
const RATE = 24000;
function tone(seconds = 7): Uint8Array {
  const samples = new Float32Array(RATE * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.4 * Math.sin((2 * Math.PI * 130 * i) / RATE);
  return encodeWavClip({ samples, sampleRate: RATE });
}
function chatFor(actor: ReturnType<typeof person>): string {
  const chat = resolveOrCreateConversation(actor, "chat");
  if (!chat.ok) throw new Error(chat.error);
  return chat.value.id;
}
function attachment(actor: ReturnType<typeof person>, conversationId: string, bytes = tone()) {
  const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, conversationId, surface: "chat", userText: "audio", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
  const result = createAttachment(actor, { conversationId, turnId, mediaType: "audio/wav", bytes });
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

let fixture: StackFixture | undefined;
beforeEach(() => {
  resetDb();
  fixture = startStackFixture({
    "GET /stack/v1/voices": () => Response.json({ voices: [] }),
    "POST /v1/audio/speech": () => new Response(new Uint8Array(2048), { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } }),
  });
  setHouseholdSettingValue("engines.stack.url", fixture.url);
  __setStackClientForTests(fixture.client);
  if (existsSync(clonedVoicesDir)) for (const file of readdirSync(clonedVoicesDir)) rmSync(join(clonedVoicesDir, file), { force: true });
});
afterEach(() => { fixture?.stop(); fixture = undefined; __resetStackEngineForTests(); });

describe("make_inspired_voice chat tool", () => {
  test("is described with the required source and name", () => {
    expect(makeInspiredVoiceToolSpec()).toMatchObject({ id: MAKE_INSPIRED_VOICE_TOOL_ID, args: { required: ["clip", "name"] } });
  });
  test("members may make an inspired voice saved with inspired provenance", async () => {
    const actor = person("member", "member"), conversationId = chatFor(actor), fileId = attachment(actor, conversationId);
    const result = await runMakeInspiredVoiceTool(actor, { clip: fileId, name: "Bright", level: "different" }, "call", conversationId);
    expect(result.status).toBe("succeeded");
    const row = db.select().from(clonedVoices).get();
    expect(row).toMatchObject({ label: "Bright", kind: "inspired", inspiredLevel: "different" });
    expect(result.result?.reply?.text).toContain("Voices page");
  });
  test("guest is refused", async () => {
    const actor = person("guest", "guest"), conversationId = chatFor(actor), fileId = attachment(actor, conversationId);
    const result = await runMakeInspiredVoiceTool(actor, { clip: fileId, name: "Nope" }, "call", conversationId);
    expect(result.status).toBe("failed");
    expect(db.select().from(clonedVoices).all()).toHaveLength(0);
  });
  test("a file belonging to someone else is refused", async () => {
    const actor = person("member", "member"), other = person("other", "member"), conversationId = chatFor(actor);
    const otherChat = chatFor(other), fileId = attachment(other, otherChat);
    const result = await runMakeInspiredVoiceTool(actor, { clip: fileId, name: "Nope" }, "call", conversationId);
    expect(result.status).toBe("failed");
    expect(db.select().from(clonedVoices).all()).toHaveLength(0);
  });
  test("invalid level is refused", async () => {
    const actor = person("member", "member"), conversationId = chatFor(actor), fileId = attachment(actor, conversationId);
    const result = await runMakeInspiredVoiceTool(actor, { clip: fileId, name: "Nope", level: "extreme" }, "call", conversationId);
    expect(result.status).toBe("failed");
    expect(db.select().from(clonedVoices).all()).toHaveLength(0);
  });
  test("latest resolves to the person's newest audio attachment in this chat", async () => {
    const actor = person("member", "member"), conversationId = chatFor(actor); attachment(actor, conversationId);
    const result = await runMakeInspiredVoiceTool(actor, { clip: "latest", name: "Latest" }, "call", conversationId, db.select().from(attachments).all().map((row) => row.id));
    expect(result.status).toBe("succeeded");
    expect(db.select().from(clonedVoices).get()?.kind).toBe("inspired");
    expect(db.select().from(attachments).all()).toHaveLength(1);
  });
});
