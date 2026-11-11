import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { createAttachment, storeFile } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { createMediaSubject, shareMediaSubject } from "@/lib/mediaSubjects";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { runGenerateVideo } from "@/lib/videos/tool";
import { resetDb } from "./reset-db";
import { installFakeVideoStack } from "./videoFixture";
import { createBenchPeople } from "../scripts/bench/conversationRunner";

describe("generate_video saved subjects", () => {
  let owner: ReturnType<typeof createBenchPeople>["owner"];
  let fake: ReturnType<typeof installFakeVideoStack>;
  beforeEach(() => { resetDb(); owner = createBenchPeople().owner; fake = installFakeVideoStack(); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } }))); });

  afterEach(async () => { await new Promise((r) => setTimeout(r, 50)); fake.restore(); });

  async function subject(person = owner, audience = "all-ages") {
    const bytes = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "blue" } }).png().toBuffer());
    const attachment = storeFile(person, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance: `media-subject-reference:${JSON.stringify({ audience })}`, deduplicate: false, retention: "kept" });
    if (!attachment.ok) throw new Error("reference attachment failed");
    return createMediaSubject(person, { name: "Pip", kind: "character", look: "A tiny blue fox", referenceIds: [attachment.value.id] });
  }
  async function call(person: typeof owner, args: Record<string, unknown>) {
    return runGenerateVideo({ state: { actor: person, temporary: false, conversationId: null, turnId: null }, args: { prompt: "Pip waves hello", ...args }, callId: "c", spoken: false, audience: { actor: person, band: "adult", surface: "chat", surfaceClass: "written", spoken: false } as never });
  }
  test("adds subject look and uses its screened reference as start image", async () => {
    const saved = await subject();
    // The input screen is independently exercised by the existing age-check tests; stub only its vision verdict here.
    const conversation = resolveOrCreateConversation(owner, "chat");
    if (!conversation.ok) throw new Error("conversation");
    const turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: owner.id, surface: "chat", conversationId: conversation.value.id, userText: "hi", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: "1:0:test" }).run();
    const result = await runGenerateVideo({ state: { actor: owner, temporary: false, conversationId: conversation.value.id, turnId }, args: { prompt: "Pip waves hello", subjects: [saved.name] }, callId: "c", spoken: false, audience: { actor: owner, band: "adult", surface: "chat", surfaceClass: "written", spoken: false } as never });
    expect(result.status).toBe("succeeded");
    const job = db.select().from((await import("@/db/schema")).videoJobs).all()[0]!;
    const request = JSON.parse(job.request);
    expect(JSON.parse(job.request).stackBody.prompt).toContain("A tiny blue fox. Pip waves hello");
    expect(request.source_file_id).not.toBeNull();
  });
  test("unknown names refuse without contacting Stack", async () => {
    const result = await call(owner, { subjects: ["Missing"] });
    expect(result.status).toBe("succeeded");
    expect(fake.submitted).toHaveLength(0);
  });
  test("several attached photos send the model to make_film instead of asking for one photo", async () => {
    const conversation = resolveOrCreateConversation(owner, "chat");
    if (!conversation.ok) throw new Error("conversation");
    const turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: owner.id, surface: "chat", conversationId: conversation.value.id, userText: "hi", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: "1:0:test" }).run();
    const bytes = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).png().toBuffer());
    const a = createAttachment(owner, { conversationId: conversation.value.id, turnId, mediaType: "image/png", bytes }), b = createAttachment(owner, { conversationId: conversation.value.id, turnId, mediaType: "image/png", bytes });
    if (!a.ok || !b.ok) throw new Error("upload");
    const result = await runGenerateVideo({ state: { actor: owner, temporary: false, conversationId: conversation.value.id, turnId, images: [{ id: a.value.id }, { id: b.value.id }] as never }, args: { prompt: "A commercial for a mug", from_picture: "attached" }, callId: "c", spoken: false, audience: { actor: owner, band: "adult", surface: "chat", surfaceClass: "written", spoken: false } as never });
    expect(result.status).toBe("succeeded");
    expect(JSON.stringify(result.result?.reply)).toContain("make_film");
    expect(fake.submitted).toHaveLength(0);
  });
  test("explicit from_picture takes precedence over subject reference", async () => {
    await subject();
    const conversation = resolveOrCreateConversation(owner, "chat");
    if (!conversation.ok) throw new Error("conversation");
    const turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: owner.id, surface: "chat", conversationId: conversation.value.id, userText: "hi", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: "1:0:test" }).run();
    const uploaded = createAttachment(owner, { conversationId: conversation.value.id, turnId, mediaType: "image/png", bytes: new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).png().toBuffer()) });
    if (!uploaded.ok) throw new Error("upload");
    const result = await runGenerateVideo({ state: { actor: owner, temporary: false, conversationId: conversation.value.id, turnId, images: [{ id: uploaded.value.id }] as never }, args: { prompt: "Pip waves hello", subjects: ["Pip"], from_picture: "attached" }, callId: "c", spoken: false, audience: { actor: owner, band: "adult", surface: "chat", surfaceClass: "written", spoken: false } as never });
    expect(result.status).toBe("succeeded");
    const job = db.select().from((await import("@/db/schema")).videoJobs).all()[0]!;
    expect(JSON.parse(job.request).source_file_id).toBe(uploaded.value.id);
  });
  test("adult-only subject makes the job adult-only", async () => {
    await subject(owner, "adult-only");
    // A failed input screen may refuse a reference in this isolated unit test, but it must never downgrade audience.
    const conversation = resolveOrCreateConversation(owner, "chat");
    if (!conversation.ok) throw new Error("conversation");
    const turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: owner.id, surface: "chat", conversationId: conversation.value.id, userText: "hi", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: "1:0:test" }).run();
    const result = await runGenerateVideo({ state: { actor: owner, temporary: false, conversationId: conversation.value.id, turnId }, args: { prompt: "Pip waves hello", subjects: ["Pip"] }, callId: "c", spoken: false, audience: { actor: owner, band: "adult", surface: "chat", surfaceClass: "written", spoken: false } as never });
    expect(result.status).toBe("succeeded");
    const job = db.select().from((await import("@/db/schema")).videoJobs).all()[0]!;
    expect(JSON.parse(job.request).adultOnly).toBe(true);
  });
  test("child cannot use a shared real-person subject", async () => {
    const childRow = db.select().from(people).all().find((p) => p.role === "child")!;
    const real = createMediaSubject(owner, { name: "Real", kind: "character", look: "A person", real: true });
    shareMediaSubject(owner, real.id, childRow.id, true);
    const result = await call(childRow as typeof owner, { subjects: [real.name] });
    expect(result.status).toBe("succeeded");
    expect(fake.submitted).toHaveLength(0);
  });
});
