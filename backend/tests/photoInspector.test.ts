import { afterEach, beforeEach, expect, test } from "bun:test";
import sharp from "sharp";
import { __setChatPictureCapabilityForTests } from "@/lib/chatPictures";
import { __setPhotoCompletionForTests, __setPhotoInspectorForTests, inspectPhoto, singleAdultPhoto, photoShowsNoPerson, PHOTO_LINES } from "@/lib/likeness/inspector";
import type { LlmCompleteOptions, LlmOpResult } from "@/lib/llm";

let bytes: Buffer;
let calls: LlmCompleteOptions[];
function reply(text: string, finish_reason = "stop"): LlmOpResult {
  return { ok: true, value: { text, finish_reason, model: "fixture" } };
}
function answers(...results: LlmOpResult[]) {
  __setPhotoCompletionForTests(async (_role, _messages, options) => {
    calls.push(options ?? {});
    return results[Math.min(calls.length - 1, results.length - 1)]!;
  });
}
beforeEach(async () => {
  bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  calls = [];
  __setPhotoInspectorForTests(undefined);
  __setChatPictureCapabilityForTests({ imageParts: true, pictureTokensMax: 256 });
});
afterEach(() => {
  __setPhotoCompletionForTests(undefined);
  __setPhotoInspectorForTests(undefined);
  __setChatPictureCapabilityForTests(null);
});
test("empty length reply retries once with more reasoning room then fails closed", async () => {
  answers(reply("", "length"));
  expect(await inspectPhoto(bytes)).toBeNull();
  expect(calls).toHaveLength(2);
  expect(calls[0]!.max_tokens!).toBeGreaterThanOrEqual(1500);
  expect(calls[1]!.max_tokens!).toBeGreaterThan(calls[0]!.max_tokens!);
  expect(calls[0]!.temperature).toBe(0);
});
test("length with content and empty stop both retry and can recover", async () => {
  for (const first of [reply('{"people":0,"faces":0}', "length"), reply("")]) {
    calls = [];
    answers(first, reply('{"people":0,"faces":0}'));
    expect(await photoShowsNoPerson(bytes)).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  }
});
test("missing age is unsure and allows only a photo with no person", async () => {
  answers(reply('{"people":0,"faces":0}'));
  expect(await inspectPhoto(bytes)).toEqual({ people: 0, faces: 0, under18: "unsure" });
  expect(await photoShowsNoPerson(bytes)).toEqual({ ok: true });
  answers(reply('{"people":1,"faces":1}'));
  expect(await singleAdultPhoto(bytes)).toEqual({ ok: false, reason: "minor", line: PHOTO_LINES.minor });
});
test("full JSON inside fences and prose passes", async () => {
  answers(reply('Here is the answer:\n```json\n{"people":1,"faces":1,"anyone_looks_under_18":"no"}\n```'));
  expect(await singleAdultPhoto(bytes)).toEqual({ ok: true });
});
test("invalid age stays unsure and invalid counts or plain text fail closed", async () => {
  answers(reply('{"people":1,"faces":1,"anyone_looks_under_18":false}'));
  expect((await inspectPhoto(bytes))?.under18).toBe("unsure");
  for (const text of ['1 adult', '{"people":-1,"faces":0}', '{"people":0.5,"faces":0}', '{"people":"0","faces":0}', '{broken} {"people":0,"faces":0}']) {
    answers(reply(text));
    expect(await inspectPhoto(bytes)).toBeNull();
    expect(await photoShowsNoPerson(bytes)).toEqual({ ok: false, reason: "unavailable", line: PHOTO_LINES.unreadable });
  }
});
test("engine error and thrown completion fail closed", async () => {
  answers({ ok: false, status: 503, code: "unavailable", error: "fixture failure" });
  expect(await inspectPhoto(bytes)).toBeNull();
  __setPhotoCompletionForTests(async () => { throw new Error("fixture failure"); });
  expect(await inspectPhoto(bytes)).toBeNull();
});
test("only missing picture capability uses engine setup copy", async () => {
  __setChatPictureCapabilityForTests({ imageParts: false, pictureTokensMax: null });
  expect(await singleAdultPhoto(bytes)).toEqual({ ok: false, reason: "unavailable", line: PHOTO_LINES.unavailable });
  expect(calls).toHaveLength(0);
});
test("caller seam preserves the age gate and allows an empty scene", async () => {
  __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "unsure" }));
  expect(await singleAdultPhoto(bytes)).toEqual({ ok: false, reason: "minor", line: PHOTO_LINES.minor });
  __setPhotoInspectorForTests(async () => ({ people: 0, faces: 0, under18: "unsure" }));
  expect(await photoShowsNoPerson(bytes)).toEqual({ ok: true });
});
test("exhausted retries use retry copy instead of engine setup copy", async () => {
  answers(reply("", "length"));
  expect(await singleAdultPhoto(bytes)).toEqual({ ok: false, reason: "unavailable", line: PHOTO_LINES.unreadable });
  expect(calls).toHaveLength(2);
});
