// VF-WORDS-01: three cases of "the video cannot be made", each with its own line. The picture line shows only when the Stack's answer for the same request
// is "no with the picture, yes without it"; the no-model line stays for the true no-model case; a child with a picture gets the no-photos redirect, never the capability line (C8, C10).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { CHILD_NO_PHOTOS_LINE } from "@/lib/pictures/lane";
import { __setVideoStatusForTests, NO_PICTURE_START_LINE, readyVideoStatusForTests } from "@/lib/videos/ready";
import { runGenerateVideo } from "@/lib/videos/tool";
import type { TurnState } from "@/lib/turnMachine/contract";
import { resetDb } from "./reset-db";
import { installFakeVideoStack } from "./videoFixture";
import { createBenchPeople } from "../scripts/bench/conversationRunner";

describe("the three 'cannot make a video' lines", () => {
  let fake: ReturnType<typeof installFakeVideoStack>;
  let owner: ReturnType<typeof createBenchPeople>["owner"];
  beforeEach(() => {
    resetDb(); owner = createBenchPeople().owner; fake = installFakeVideoStack();
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
  });
  afterEach(async () => { await new Promise((r) => setTimeout(r, 50)); fake.restore(); });

  const png = async () => new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer());
  async function ask(actor: typeof owner, band: "adult" | "child", withPicture: boolean): Promise<string> {
    const conversation = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false });
    if (!conversation.ok) throw new Error("conversation");
    const conversationId = conversation.value.id, turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId, userText: "hi", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: "1:0:test" }).run();
    let state = { actor, temporary: false, conversationId, turnId } as unknown as TurnState;
    if (withPicture) {
      const made = createAttachment(actor, { conversationId, turnId, mediaType: "image/png", bytes: await png(), provenance: "upload", deduplicate: false });
      if (!made.ok) throw new Error("attachment");
      state = { ...state, images: [{ id: made.value.id, name: "p.png", width: 64, height: 48, media_type: "image/png" }] } as unknown as TurnState;
    }
    const result = await runGenerateVideo({ state, args: { prompt: "the fox turns its head", ...(withPicture ? { from_picture: "attached" } : {}) }, callId: "c", spoken: false, audience: { actor, band, surface: "chat", surfaceClass: "written", spoken: false } as never });
    return JSON.stringify(result);
  }

  test("the model works from words but cannot start from a picture: the picture line with the picture, and the same request without it is made", async () => {
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));   // ready for words; no image_to_video
    expect(await ask(owner, "adult", true)).toContain(NO_PICTURE_START_LINE);
    expect(fake.submitted).toHaveLength(0);
    const words = await ask(owner, "adult", false);
    expect(words).not.toContain(NO_PICTURE_START_LINE);
    await new Promise((r) => setTimeout(r, 100));
    expect(fake.submitted.length).toBeGreaterThan(0);
  });

  test("no video model at all keeps the not-installed line, with or without a picture, and never the picture line", async () => {
    __setVideoStatusForTests(null);
    for (const withPicture of [false, true]) {
      const text = await ask(owner, "adult", withPicture);
      expect(text).not.toContain(NO_PICTURE_START_LINE);
      expect(text).toMatch(/no video model is installed|isn't ready|not ready|unavailable/i);
    }
    expect(fake.submitted).toHaveLength(0);
  });

  test("a child with a picture gets the no-photos redirect, never the capability line, whatever the Stack can do", async () => {
    const child = db.select().from(people).all().find((p) => p.role === "child")! as typeof owner;
    for (const status of [readyVideoStatusForTests({ ltx25: "ready" }), readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true })]) {
      __setVideoStatusForTests(status);
      const text = await ask(child, "child", true);
      expect(text).toContain(CHILD_NO_PHOTOS_LINE);
      expect(text).not.toContain(NO_PICTURE_START_LINE);
    }
    expect(fake.submitted).toHaveLength(0);
  });
});
