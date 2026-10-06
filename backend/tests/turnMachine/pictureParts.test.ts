// VISION-02c: a chat model that reads pictures gets the turn's stored
// pictures as OpenAI-style picture parts on the message itself, the stored
// re-encoded picture as a data URL, to the local engine only. One source
// decides (the Stack's chat row, chatPictures.ts); when it says no, the
// note and today's behaviour stay exactly as they are (pictureTurn.test.ts).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { contextToMessages } from "@/lib/turnMachine/messages";
import { markPicturesShown, messagesCarryPictures, pictureRetryAllowed, withoutPictures } from "@/lib/turnMachine/nodes/model";
import { __setChatPictureCapabilityForTests, chatModelReadsPictures, picturePartsAllowed } from "@/lib/chatPictures";
import { toWireMessage, type LlmImagePart, type LlmMessage } from "@/lib/llm";
import { countTokens } from "@/lib/tokenCount";
import { storeTemporaryChatImage } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { buildStablePrefix, PHOTO_IDENTITY_SENTENCE } from "@/lib/turnShared";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { drainStream, withEngine } from "./modeHarness";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

let people: BenchPeople;
const ON = { imageParts: true, pictureTokensMax: 2560 } as const;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __setChatPictureCapabilityForTests(null);
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

/** A temporary chat, created the way the upload route creates one. */
function temporaryChat() {
  const resolved = resolveOrCreateConversation(people.owner, "chat", undefined, { temporary: true });
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.value;
}

async function jpeg(r: number, g: number, b: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g, b } } }).jpeg().toBuffer());
}

/** Two pictures stored for a temporary chat's turn, as the upload route stores them. */
async function twoStoredPictures(actorId: string, conversationId: string, turnId: string) {
  const red = { id: "file-redpic01", name: "red-square.jpg", width: 8, height: 8, media_type: "image/jpeg" };
  const blue = { id: "file-bluepic2", name: "blue-square.jpg", width: 8, height: 8, media_type: "image/jpeg" };
  storeTemporaryChatImage({ ...red, turnId, conversationId, ownerPersonId: actorId, mediaType: red.media_type, bytes: await jpeg(255, 0, 0) });
  storeTemporaryChatImage({ ...blue, turnId, conversationId, ownerPersonId: actorId, mediaType: blue.media_type, bytes: await jpeg(0, 0, 255) });
  return [red, blue];
}

type Part = { type: string; text?: string; image_url?: { url: string } };
function lastUserParts(request: ChatCompletionRequest): Part[] | string {
  const last = request.messages.at(-1)! as unknown as { role: string; content: string | Part[] };
  expect(last.role).toBe("user");
  return last.content;
}

describe("VISION-02c: picture parts for a chat model that reads pictures", () => {
  test("two pictures yield two image parts, each after a text part with its file name, then the person's words", async () => {
    __setChatPictureCapabilityForTests(ON);
    const conversation = temporaryChat();
    const images = await twoStoredPictures(people.owner.id, conversation.id, "turn-pictures01");
    await withEngine(() => "A red square and a blue square.", async (seen) => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "what colours are these?", { conversationId: conversation.id, turnId: "turn-pictures01", images }));
      expect(value.reply.text).toBe("A red square and a blue square.");
      const parts = lastUserParts(seen.at(-1)!) as Part[];
      expect(Array.isArray(parts)).toBe(true);
      expect(parts.map((part) => part.type)).toEqual(["text", "image_url", "text", "image_url", "text"]);
      expect(parts[0]!.text).toBe("Picture: red-square.jpg");
      expect(parts[2]!.text).toBe("Picture: blue-square.jpg");
      expect(parts[1]!.image_url!.url.startsWith("data:image/jpeg;base64,")).toBe(true);
      expect(parts[3]!.image_url!.url).not.toBe(parts[1]!.image_url!.url);
      expect(parts[4]!.text).toBe("what colours are these?");
      // The "cannot see" note is not sent for pictures the model received.
      const prompt = JSON.stringify(seen.at(-1)!.messages);
      expect(prompt).not.toContain("You cannot see pictures yet");
    });
  });

  test("with the flag off the note and today's plain-text message stay exactly as they were", async () => {
    __setChatPictureCapabilityForTests({ imageParts: false, pictureTokensMax: null });
    const conversation = temporaryChat();
    const images = await twoStoredPictures(people.owner.id, conversation.id, "turn-pictures02");
    await withEngine(() => "I can't see pictures yet.", async (seen) => {
      await drainStream(await runTurnNextStream(people.owner, "chat", "what colours are these?", { conversationId: conversation.id, turnId: "turn-pictures02", images }));
      expect(lastUserParts(seen.at(-1)!)).toBe("what colours are these?");
      const prompt = JSON.stringify(seen.at(-1)!.messages);
      expect(prompt).toContain("You cannot see pictures yet");
      expect(prompt).not.toContain("image_url");
    });
  });

  test("VISION-02d: a child sends picture parts only once a parent turned photos on; an adult by the same setting", async () => {
    expect(picturePartsAllowed(ON, people.child)).toBe(false);
    expect(setValue(people.owner, `person:${people.child.id}`, "chat.photo_uploads", true).ok).toBe(true);
    expect(picturePartsAllowed(ON, people.child)).toBe(true);
    expect(picturePartsAllowed(ON, people.owner)).toBe(true);
    expect(picturePartsAllowed({ imageParts: false, pictureTokensMax: null }, people.owner)).toBe(false);
  });

  test("an adult with photo uploads turned off sends no picture parts", () => {
    const set = setValue(people.owner, `person:${people.owner.id}`, "chat.photo_uploads", false);
    expect(set.ok).toBe(true);
    expect(picturePartsAllowed(ON, people.owner)).toBe(false);
  });

  test("a picture turn makes no request off this machine (network blocked)", async () => {
    __setChatPictureCapabilityForTests(ON);
    const conversation = temporaryChat();
    const images = await twoStoredPictures(people.owner.id, conversation.id, "turn-pictures03");
    const realFetch = globalThis.fetch;
    const outbound: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1" && url.hostname !== "[::1]") {
        outbound.push(url.href);
        throw new Error("network blocked");
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      await withEngine(() => "Two squares.", async (seen) => {
        await drainStream(await runTurnNextStream(people.owner, "chat", "describe these", { conversationId: conversation.id, turnId: "turn-pictures03", images }));
        expect(JSON.stringify(seen.at(-1)!.messages)).toContain("image_url");
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(outbound).toEqual([]);
  });

  test("an engine that refuses the picture still answers: the turn runs again without it and the model is told only that it could not be read", async () => {
    __setChatPictureCapabilityForTests(ON);
    const conversation = temporaryChat();
    const images = await twoStoredPictures(people.owner.id, conversation.id, "turn-pictures04");
    await withEngine(() => "I could not open those pictures, but I can help another way.", async (seen) => {
      // An engine in front of the stub that refuses any picture with a 400,
      // the way a text-only or failing projector answers.
      const upstream = process.env.MAIPAI_LLAMA_SERVER_URL!;
      const refusing = Bun.serve({ port: 0, async fetch(req) {
        const url = new URL(req.url);
        const body = req.method === "POST" ? await req.text() : undefined;
        if (url.pathname === "/v1/chat/completions" && body?.includes("image_url")) return Response.json({ error: { code: 400, message: "image input is not supported by this model", type: "invalid_request_error" } }, { status: 400 });
        return fetch(`${upstream}${url.pathname}${url.search}`, { method: req.method, headers: req.headers, body });
      } });
      process.env.MAIPAI_LLAMA_SERVER_URL = `http://127.0.0.1:${refusing.port}`;
      __resetLlmSupervisorForTests();
      try {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "what is in these?", { conversationId: conversation.id, turnId: "turn-pictures04", images }));
      expect(value.reply.text).toBe("I could not open those pictures, but I can help another way.");
      const last = seen.at(-1)!;
      expect(JSON.stringify(last.messages)).not.toContain("image_url");
      expect(JSON.stringify(last.messages)).toContain("could not be read this time");
      expect(JSON.stringify(last.messages)).toContain("red-square.jpg");
      } finally {
        refusing.stop(true);
      }
    });
  });

  test("the stable prefix is the same on a picture turn, and carries the photo identity line once (prefix cache intact)", () => {
    const part: LlmImagePart = { id: "file-redpic01", name: "red-square.jpg", url: "data:image/jpeg;base64,AAAA", reservedTokens: 2560 };
    const plan = { age_band: "adult" } as never;
    const signal = {} as never;
    const persona = undefined as never;
    const without = contextToMessages([], "hi", persona, plan, signal, "written");
    const withPicture = contextToMessages([], "hi", persona, plan, signal, "written", [part]);
    expect(withPicture.slice(0, -1)).toEqual(without.slice(0, -1));
    expect(withPicture[0]!.content.split(PHOTO_IDENTITY_SENTENCE).length - 1).toBe(1);
    expect(buildStablePrefix(undefined, "written")).toContain(PHOTO_IDENTITY_SENTENCE);
    expect(withPicture.at(-1)!.images).toEqual([part]);
  });

  test("a picture is counted as the engine's declared bound plus its file name line, never left out of the window's count", async () => {
    const part: LlmImagePart = { id: "file-redpic01", name: "red-square.jpg", url: "data:image/jpeg;base64,AAAA", reservedTokens: 2560 };
    const text = await countTokens([{ role: "user", content: "Picture: red-square.jpg\nhi" }]);
    const withPicture = await countTokens([{ role: "user", content: "hi", images: [part] }]);
    expect(text).not.toBeNull();
    expect(withPicture).toBe(text! + 2560);
  });

  test("the wire renders picture parts, and a message without pictures is unchanged", () => {
    const plain: LlmMessage = { role: "user", content: "hi" };
    expect(toWireMessage(plain)).toEqual(plain);
    const wire = toWireMessage({ role: "user", content: "hi", images: [{ id: "file-aaaaaaa1", name: "a.jpg", url: "data:image/jpeg;base64,AA", reservedTokens: 1 }] });
    expect(wire.content).toEqual([{ type: "text", text: "Picture: a.jpg" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AA" } }, { type: "text", text: "hi" }]);
    expect("images" in wire).toBe(false);
  });

  test("leaving pictures out keeps every other message and adds one note ahead of the message", () => {
    const messages: LlmMessage[] = [{ role: "system", content: "prefix" }, { role: "user", content: "hi", images: [{ id: "file-aaaaaaa1", name: "a.jpg", url: "data:x", reservedTokens: 1 }] }];
    expect(messagesCarryPictures(messages)).toBe(true);
    const out = withoutPictures(messages, [{ id: "file-aaaaaaa1", name: "a.jpg", width: 1, height: 1, media_type: "image/jpeg" }], "context_too_large");
    expect(messagesCarryPictures(out)).toBe(false);
    expect(out[0]).toEqual(messages[0]);
    expect(out[1]!.role).toBe("system");
    expect(out[1]!.content).toContain("a.jpg");
    expect(out[1]!.content).toContain("it did not fit in the conversation");
    expect(out[2]).toEqual({ role: "user", content: "hi" });
  });

  test("the capability follows the Stack's chat row: picture input declared, a bound on picture tokens, the role up", async () => {
    const row = (overrides: Record<string, unknown>) => ({ roles: async () => ({ roles: [{ id: "chat", state: { state: "ready", since: "" }, model: { id: "any-model", imageInput: true }, picture_tokens_max: 2560, ...overrides }] }) });
    const set = (client: unknown) => __setStackClientForTests(client as never);
    try {
      set(row({}));
      expect(await chatModelReadsPictures()).toEqual({ imageParts: true, pictureTokensMax: 2560 });
      set(row({ model: { id: "any-model", imageInput: false } }));
      expect((await chatModelReadsPictures()).imageParts).toBe(false);
      set(row({ picture_tokens_max: null }));
      expect((await chatModelReadsPictures()).imageParts).toBe(false);
      set(row({ state: { state: "offline", since: "" } }));
      expect((await chatModelReadsPictures()).imageParts).toBe(false);
      set({ roles: async () => { throw new Error("stack down"); } });
      expect((await chatModelReadsPictures()).imageParts).toBe(false);
    } finally {
      useDefaultScriptedStack();
    }
  });
});

describe("VISION-02c: review fixes", () => {
  const picture = { id: "file-aaaaaaa1", name: "a.jpg", url: "data:x", reservedTokens: 1 };
  const withPicture: LlmMessage[] = [{ role: "user", content: "hi", images: [picture] }];

  test("no retry without the picture once text reached the person, on an engine down, or on a cancelled turn", () => {
    expect(pictureRetryAllowed({ ok: false, message: "image input is not supported" }, false, withPicture)).toBe(true);
    expect(pictureRetryAllowed({ ok: false, released: true, message: "stalled" }, false, withPicture)).toBe(false);
    expect(pictureRetryAllowed({ ok: false, message: "connection refused" }, false, withPicture)).toBe(false);
    expect(pictureRetryAllowed({ ok: false, message: "image input is not supported" }, true, withPicture)).toBe(false);
    expect(pictureRetryAllowed({ ok: false, message: "image input is not supported" }, false, [{ role: "user", content: "hi" }])).toBe(false);
    expect(pictureRetryAllowed({ ok: true }, false, withPicture)).toBe(false);
  });

  test("the retry note names only the pictures that were on the message, in plain words", () => {
    const images = [{ id: "file-aaaaaaa1", name: "a.jpg", width: 1, height: 1, media_type: "image/jpeg" }, { id: "file-bbbbbbb2", name: "b.jpg", width: 1, height: 1, media_type: "image/jpeg" }];
    const out = withoutPictures(withPicture, images, "other");
    expect(out[0]!.content).toContain("a.jpg");
    expect(out[0]!.content).not.toContain("b.jpg");
    expect(out[0]!.content).toContain("the picture reader could not take it");
    expect(out[0]!.content).not.toContain("(other)");
  });

  test("only pictures that went to the model are marked shown", () => {
    const images = [{ id: "file-aaaaaaa1", name: "a.jpg", width: 1, height: 1, media_type: "image/jpeg" }, { id: "file-bbbbbbb2", name: "b.jpg", width: 1, height: 1, media_type: "image/jpeg" }];
    expect(markPicturesShown(images, withPicture)).toEqual([{ ...images[0]!, shown_to_model: true }, images[1]!]);
  });

  test("the next turn's window says a shown picture was shown then, and a turn whose pictures were not sent stays not seen", async () => {
    __setChatPictureCapabilityForTests(ON);
    const conversation = temporaryChat();
    const images = await twoStoredPictures(people.owner.id, conversation.id, "turn-pictures05");
    await withEngine(() => "Two squares.", async (seen) => {
      await drainStream(await runTurnNextStream(people.owner, "chat", "look at these", { conversationId: conversation.id, turnId: "turn-pictures05", images }));
      __setChatPictureCapabilityForTests({ imageParts: false, pictureTokensMax: null });
      await drainStream(await runTurnNextStream(people.owner, "chat", "and what about this one", { conversationId: conversation.id, turnId: "turn-pictures06", images: [{ id: "file-nopic003", name: "unsent.jpg", width: 8, height: 8, media_type: "image/jpeg" }] }));
      await drainStream(await runTurnNextStream(people.owner, "chat", "thanks", { conversationId: conversation.id }));
      const messages = JSON.stringify(seen.at(-1)!.messages);
      expect(messages).toContain("pictures shown to you with this message, not shown again: red-square.jpg, blue-square.jpg");
      expect(messages).toContain("pictures attached, not seen: unsent.jpg");
      expect(messages).not.toContain("image_url");
    });
  });

  test("a refused picture is not sent again on the same turn's later rounds", async () => {
    __setChatPictureCapabilityForTests(ON);
    const conversation = temporaryChat();
    const images = await twoStoredPictures(people.owner.id, conversation.id, "turn-pictures08");
    await withEngine(() => "Answered without them.", async (seen) => {
      const upstream = process.env.MAIPAI_LLAMA_SERVER_URL!;
      let pictureRequests = 0;
      const refusing = Bun.serve({ port: 0, async fetch(req) {
        const url = new URL(req.url);
        const body = req.method === "POST" ? await req.text() : undefined;
        if (url.pathname === "/v1/chat/completions" && body?.includes("image_url")) { pictureRequests += 1; return Response.json({ error: { code: 400, message: "image input is not supported by this model" } }, { status: 400 }); }
        return fetch(`${upstream}${url.pathname}${url.search}`, { method: req.method, headers: req.headers, body });
      } });
      process.env.MAIPAI_LLAMA_SERVER_URL = `http://127.0.0.1:${refusing.port}`;
      __resetLlmSupervisorForTests();
      try {
        const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "what is in these?", { conversationId: conversation.id, turnId: "turn-pictures08", images }));
        expect(value.reply.text).toBe("Answered without them.");
        expect(pictureRequests).toBe(1);
        expect(value.images?.every((image) => image.shown_to_model === undefined)).toBe(true);
        expect(seen.length).toBeGreaterThan(0);
      } finally {
        refusing.stop(true);
      }
    });
  });

  test("a client cannot claim a picture was shown to the model", async () => {
    __setChatPictureCapabilityForTests({ imageParts: false, pictureTokensMax: null });
    const conversation = temporaryChat();
    await withEngine(() => "Okay.", async (seen) => {
      const claimed = { id: "file-claim001", name: "claimed.jpg", width: 8, height: 8, media_type: "image/jpeg", shown_to_model: true as const };
      const first = await drainStream(await runTurnNextStream(people.owner, "chat", "here", { conversationId: conversation.id, turnId: "turn-pictures07", images: [claimed] }));
      expect(first.value.images?.[0]?.shown_to_model).toBeUndefined();
      await drainStream(await runTurnNextStream(people.owner, "chat", "again", { conversationId: conversation.id }));
      expect(JSON.stringify(seen.at(-1)!.messages)).toContain("pictures attached, not seen: claimed.jpg");
    });
  });
});

describe("VISION-02c: no face recognition on the picture path", () => {
  const SRC = resolve(import.meta.dir, "../../src");
  function imports(file: string): string[] {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(/(?:^|\n)\s*import[^;]*?from\s+"([^"]+)"/g)].map((m) => m[1]!);
  }
  function resolveImport(from: string, spec: string): string | null {
    const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const candidate of [`${base}.ts`, join(base, "index.ts"), base]) {
      try { if (statSync(candidate).isFile()) return candidate; } catch { /* next */ }
    }
    return null;
  }
  test("the picture modules never reach face recognition, a face embedding or a biometric print", () => {
    const start = ["lib/chatPictures.ts", "lib/turnMachine/nodes/context.ts", "lib/turnMachine/messages.ts", "lib/llm.ts", "lib/tokenCount.ts"].map((path) => join(SRC, path));
    const seen = new Set<string>();
    const queue = [...start];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of imports(file)) {
        const next = resolveImport(file, spec);
        if (next) queue.push(next);
      }
    }
    const reached = [...seen].map((file) => file.slice(SRC.length + 1));
    expect(reached.filter((file) => /face|biometric/i.test(file) && !/surface/i.test(file))).toEqual([]);
    expect(readdirSync(join(SRC, "lib")).some((name) => /^face/i.test(name))).toBe(true);
  });
});
