// IMGGEN-SAFE-01: the finished-picture and finished-video check (src/lib/pictures/ageCheck.ts). The ABSOLUTE LINE is
// nothing sexual involving a minor or a minor-looking person. These tests drive the DECISION with scripted verdicts and the
// jobs with a scripted vision answer: they use no explicit image, make none and never describe one. The labeler itself is
// proved on innocuous pictures by the calibration run in docs/design/image-engine-2026-10-17.md.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "./stackFixture";
import { listPending } from "@/lib/notifications";
import {
  AGE_CHECK_SYSTEM_PROMPT, __resetAgeCheckEventsForTests, __setAgeCheckRunnerForTests, __setAgeDeadlineForTests, __setAgeVisionForTests, checkImages, decideAgeCheck,
  downscaleForCheck, effectiveLabel, isAdultOnlyJob, minorRefusalLine, parseVerdict, promptHash, uncheckedRefusalLine, type AgeLabel, type AgeVerdict, type ImageCheck,
} from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { TEST_LORAS, installFakeImageStack, testPng, until, type FakeImageStack } from "./pictureFixture";
import { TEST_VIDEO_LORAS, installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { db } from "@/db";
import { attachments } from "@/db/schema";

const verdict = (label: AgeLabel, sexual: boolean, over: Partial<AgeVerdict> = {}): AgeVerdict => ({
  people_count: label === "none" ? 0 : 1, apparent_min_age_estimate: label === "none" ? null : label === "adult" ? 35 : label === "child" ? 8 : 16, label, is_nude_or_sexual: sexual, confidence: 0.9, ...over,
});
const ok = (label: AgeLabel, sexual: boolean, over: Partial<AgeVerdict> = {}): ImageCheck => ({ ok: true, verdict: verdict(label, sexual, over) });
const failed: ImageCheck = { ok: false, why: "timeout" };

// This file installs its own runners; the shared preload default ("nobody in it") comes back after every test.
afterEach(() => {
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ok("none", false)));
  __setKeyframesForTests(async () => null);
});

describe("the decision, with scripted verdicts", () => {
  test("a child and a sexual picture is withheld, with the fixed line", () => {
    const decision = decideAgeCheck([ok("child", true)], false, "picture");
    expect(decision).toEqual({ action: "withhold", reason: "minor_sexual", line: "I can't show that picture. It may show a child in a sexual situation, and that is never allowed." });
  });
  test("a possible minor and a sexual picture is withheld", () => {
    expect(decideAgeCheck([ok("possibly_minor", true)], false, "picture").action).toBe("withhold");
  });
  test("an adult and a sexual picture is allowed (adults get adult content)", () => {
    expect(decideAgeCheck([ok("adult", true)], true, "picture")).toEqual({ action: "allow" });
    expect(decideAgeCheck([ok("adult", true)], false, "picture")).toEqual({ action: "allow" });
  });
  test("a possible minor that is not sexual is allowed in an ordinary job (a cartoon child with a balloon)", () => {
    expect(decideAgeCheck([ok("possibly_minor", false)], false, "picture")).toEqual({ action: "allow" });
    expect(decideAgeCheck([ok("child", false)], false, "picture")).toEqual({ action: "allow" });
  });
  test("a possible minor in an ADULT-ONLY job is withheld even when the check did not call it sexual", () => {
    expect(decideAgeCheck([ok("possibly_minor", false)], true, "picture")).toMatchObject({ action: "withhold", reason: "minor_sexual" });
    expect(decideAgeCheck([ok("child", false)], true, "picture")).toMatchObject({ action: "withhold", reason: "minor_sexual" });
  });
  test("nobody in the picture is allowed", () => {
    expect(decideAgeCheck([ok("none", false)], true, "picture")).toEqual({ action: "allow" });
  });
  test("a check that could not run on an adult-only job fails closed, with the fixed line", () => {
    expect(decideAgeCheck([failed], true, "picture")).toEqual({ action: "withhold", reason: "unchecked", line: "I couldn't check that picture, so I can't show it. Try again in a minute." });
    expect(decideAgeCheck([], true, "picture").action).toBe("withhold");
  });
  test("a check that could not run on an ordinary job fails open", () => {
    expect(decideAgeCheck([failed], false, "picture")).toEqual({ action: "allow" });
  });
  test("a clip: one bad keyframe withholds it, and a minor finding outranks a failed frame", () => {
    expect(decideAgeCheck([ok("adult", false), ok("adult", false), ok("child", true)], false, "video")).toMatchObject({ action: "withhold", reason: "minor_sexual", line: minorRefusalLine("video") });
    expect(decideAgeCheck([failed, ok("adult", true), ok("child", true)], true, "video")).toMatchObject({ reason: "minor_sexual" });
    expect(decideAgeCheck([ok("adult", false), failed, ok("adult", false)], true, "video")).toMatchObject({ reason: "unchecked", line: uncheckedRefusalLine("video") });
    expect(decideAgeCheck([ok("adult", false), failed, ok("adult", false)], false, "video")).toEqual({ action: "allow" });
  });
  test("an adult label beside an apparent age under 18 is read as the younger answer", () => {
    expect(effectiveLabel(verdict("adult", true, { apparent_min_age_estimate: 15 }))).toBe("possibly_minor");
    expect(effectiveLabel(verdict("adult", true, { apparent_min_age_estimate: 9 }))).toBe("child");
    expect(effectiveLabel(verdict("adult", true, { apparent_min_age_estimate: 18 }))).toBe("adult");
    expect(decideAgeCheck([ok("adult", true, { apparent_min_age_estimate: 14 })], false, "picture").action).toBe("withhold");
  });
});

describe("reading the model's answer", () => {
  const good: AgeVerdict = { people_count: 1, apparent_min_age_estimate: 35, label: "adult", is_nude_or_sexual: false, confidence: 0.8 };
  test("plain JSON, a fenced block and JSON with chatter around it all parse", () => {
    expect(parseVerdict(JSON.stringify(good))).toEqual(good);
    expect(parseVerdict("```json\n" + JSON.stringify(good) + "\n```")).toEqual(good);
    expect(parseVerdict("Here you go: " + JSON.stringify(good) + " Done.")).toEqual(good);
  });
  test("nobody in the picture parses with a null age", () => {
    expect(parseVerdict(JSON.stringify({ people_count: 0, apparent_min_age_estimate: null, label: "none", is_nude_or_sexual: false, confidence: 1 }))?.label).toBe("none");
  });
  test("a missing field, a wrong type, an unknown label and a self-contradiction are all not a verdict", () => {
    expect(parseVerdict("not json")).toBeNull();
    expect(parseVerdict("")).toBeNull();
    expect(parseVerdict(JSON.stringify({ ...good, label: "teen" }))).toBeNull();
    expect(parseVerdict(JSON.stringify({ ...good, is_nude_or_sexual: "no" }))).toBeNull();
    expect(parseVerdict(JSON.stringify({ people_count: 1, label: "adult", is_nude_or_sexual: false }))).toBeNull();
    expect(parseVerdict(JSON.stringify({ ...good, label: "none" }))).toBeNull();
    expect(parseVerdict(JSON.stringify({ ...good, people_count: 0 }))).toBeNull();
  });
  test("the system prompt asks for a classification only and names every label", () => {
    for (const word of ["adult", "possibly_minor", "child", "none", "is_nude_or_sexual", "apparent_min_age_estimate", "people_count", "confidence"]) expect(AGE_CHECK_SYSTEM_PROMPT).toContain(word);
  });
});

describe("what makes a job adult-only", () => {
  const classes: Record<string, "all-ages" | "adult-only"> = { good: "all-ages", spicy: "adult-only" };
  const classOf = async (id: string) => classes[id];
  test("a sexual or nudity word in the prompt", async () => {
    expect(await isAdultOnlyJob("a nude statue study", [], classOf)).toBe(true);
    expect(await isAdultOnlyJob("a fox in the snow", [], classOf)).toBe(false);
    expect(await isAdultOnlyJob("a woman in a bikini on the beach", [], classOf)).toBe(false);
  });
  test("any adult-only style, and a style the library no longer knows", async () => {
    expect(await isAdultOnlyJob("a fox", ["good"], classOf)).toBe(false);
    expect(await isAdultOnlyJob("a fox", ["good", "spicy"], classOf)).toBe(true);
    expect(await isAdultOnlyJob("a fox", ["gone"], classOf)).toBe(true);
    expect(await isAdultOnlyJob("a fox", ["good"], async () => { throw new Error("library down"); })).toBe(true);
  });
});

describe("the check on this computer", () => {
  beforeEach(() => { __setAgeCheckRunnerForTests(null); });
  afterEach(() => { __setAgeVisionForTests(null); __setAgeDeadlineForTests(null); });

  test("the copy sent to the model is at most 768 px and carries no EXIF", async () => {
    const big = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 10, g: 20, b: 30 } } }).withExif({ IFD0: { Copyright: "private note" } }).jpeg().toBuffer();
    expect((await sharp(big).metadata()).exif).toBeDefined();
    const small = await downscaleForCheck(new Uint8Array(big));
    const meta = await sharp(small).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(768);
    expect(meta.exif).toBeUndefined();
    expect(Buffer.from(small).includes(Buffer.from("private note"))).toBe(false);
  });

  test("a scripted answer becomes a verdict, an unreadable one and a thrown one become failures, a stalled one times out", async () => {
    const png = await testPng();
    __setAgeVisionForTests(async () => JSON.stringify({ people_count: 1, apparent_min_age_estimate: 40, label: "adult", is_nude_or_sexual: false, confidence: 0.9 }));
    expect(await checkImages([png], "picture")).toEqual([{ ok: true, verdict: verdict("adult", false, { apparent_min_age_estimate: 40 }) }]);
    __setAgeVisionForTests(async () => "I cannot help with that");
    expect(await checkImages([png], "picture")).toEqual([{ ok: false, why: "unparsed" }]);
    __setAgeVisionForTests(async () => { throw new Error("busy"); });
    expect(await checkImages([png], "picture")).toEqual([{ ok: false, why: "unavailable" }]);
    __setAgeDeadlineForTests(30);
    __setAgeVisionForTests(() => new Promise<string>(() => undefined));
    expect(await checkImages([png], "picture")).toEqual([{ ok: false, why: "timeout" }]);
    expect(await checkImages([Uint8Array.of(1, 2, 3)], "picture")).toEqual([{ ok: false, why: "unparsed" }]);
  });

  test("images are checked one at a time, in order, and the model is sent a data URL image", async () => {
    const png = await testPng();
    const seen: string[] = [];
    let running = 0;
    let overlap = false;
    __setAgeVisionForTests(async ({ dataUrl }) => {
      running += 1; if (running > 1) overlap = true;
      seen.push(dataUrl.slice(0, 23));
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      return JSON.stringify({ people_count: 0, apparent_min_age_estimate: null, label: "none", is_nude_or_sexual: false, confidence: 1 });
    });
    const [a, b] = await Promise.all([checkImages([png, png], "picture"), checkImages([png], "picture")]);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
    expect(overlap).toBe(false);
    expect(seen).toEqual(Array(3).fill("data:image/jpeg;base64,"));
  });

  test("the prompt hash is stable and never the prompt", () => {
    expect(promptHash("A Fox")).toBe(promptHash("a fox "));
    expect(promptHash("a fox")).toHaveLength(16);
    expect(promptHash("a fox")).not.toContain("fox");
  });
});

describe("a picture job", () => {
  let people: BenchPeople;
  let fake: FakeImageStack;
  let warn: { mock: { calls: unknown[][] }; mockRestore(): void };
  beforeEach(() => {
    resetDb();
    useDefaultScriptedStack();
    __resetThrottleForTests();
    __resetRateLimiterForTests();
    __resetAgeCheckEventsForTests();
    people = createBenchPeople();
    fake = installFakeImageStack();
    warn = spyOn(console, "warn").mockImplementation(() => undefined) as unknown as typeof warn;
  });
  afterEach(() => { fake.restore(); warn.mockRestore(); __setAgeCheckRunnerForTests(async (images) => images.map(() => ok("none", false))); });

  async function run(prompt: string, loras: Array<{ id: string; scale: number }> = []) {
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(people.owner, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startPictureJob({ actor: people.owner, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt, body: { prompt, size: "1024x1024", n: 1, audience: "adult", ...(loras.length ? { loras } : {}) } });
    await until(() => ["done", "failed"].includes(getPictureJob(people.owner, job.id)?.state ?? ""));
    return getPictureJob(people.owner, job.id)!;
  }

  test("an ordinary picture of an adult passes and is stored", async () => {
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ok("adult", false)));
    const job = await run("a middle-aged man smiling, studio portrait");
    expect(job.state).toBe("done");
    expect(job.files).toHaveLength(1);
  });

  test("a possible child in a sexual picture is withheld: no file, the Stack copy deleted, the fixed line, a log line and an admin notification without the prompt or image", async () => {
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ok("child", true)));
    const job = await run("a portrait of a person on a sofa");
    expect(job.state).toBe("failed");
    expect(job.error).toBe("I can't show that picture. It may show a child in a sexual situation, and that is never allowed.");
    expect(job.files).toEqual([]);
    expect(db.select().from(attachments).all()).toHaveLength(0);
    await until(() => fake.jobs.every((j) => j.deleted));
    const logged = warn.mock.calls.map((c) => String(c[0])).find((line) => line.includes("[age-check] withheld"))!;
    expect(logged).toContain(promptHash("a portrait of a person on a sofa"));
    expect(logged).not.toContain("sofa");
    const pending = listPending(people.owner).filter((n) => n.typeId === "safety.picture_withheld");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.text).not.toContain("sofa");
    // A second withheld picture by the same person within ten minutes logs again but does not notify again.
    await run("another portrait of a person");
    expect(listPending(people.owner).filter((n) => n.typeId === "safety.picture_withheld")).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("[age-check] withheld"))).toHaveLength(2);
  });

  test("a cartoon child with a balloon is labeled a minor and still passes, because it is not sexual and the job is not adult-only", async () => {
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ok("child", false)));
    expect((await run("a cartoon girl about 8 years old holding a balloon")).state).toBe("done");
  });

  test("an adult-only style makes the job adult-only: a possible minor is withheld even when not called sexual, and a failed check fails closed", async () => {
    const adultStyle = TEST_LORAS.find((l) => l.classification === "adult-only")!;
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ok("possibly_minor", false)));
    expect((await run("a portrait", [{ id: adultStyle.id, scale: 0.9 }])).error).toBe("I can't show that picture. It may show a child in a sexual situation, and that is never allowed.");
    __setAgeCheckRunnerForTests(async (images) => images.map((): ImageCheck => ({ ok: false, why: "unavailable" })));
    const closed = await run("a portrait", [{ id: adultStyle.id, scale: 0.9 }]);
    expect(closed.state).toBe("failed");
    expect(closed.error).toBe("I couldn't check that picture, so I can't show it. Try again in a minute.");
    expect(listPending(people.owner).filter((n) => n.typeId === "safety.picture_withheld")).toHaveLength(1);
  });

  test("a sexual word in the prompt makes the job adult-only (a failed check fails closed); an ordinary prompt fails open", async () => {
    __setAgeCheckRunnerForTests(async (images) => images.map((): ImageCheck => ({ ok: false, why: "timeout" })));
    expect((await run("a nude figure study in charcoal")).state).toBe("failed");
    expect((await run("a red fox in the snow")).state).toBe("done");
  });

  test("an all-ages style does not make a job adult-only", async () => {
    const plain = TEST_LORAS.find((l) => l.classification === "all-ages")!;
    __setAgeCheckRunnerForTests(async (images) => images.map((): ImageCheck => ({ ok: false, why: "memory" })));
    expect((await run("a pixel art fox", [{ id: plain.id, scale: 0.8 }])).state).toBe("done");
  });
});

describe("a video job", () => {
  let people: BenchPeople;
  let fake: FakeVideoStack;
  let warn: { mock: { calls: unknown[][] }; mockRestore(): void };
  beforeEach(() => {
    resetDb();
    useDefaultScriptedStack();
    __resetThrottleForTests();
    __resetRateLimiterForTests();
    __resetAgeCheckEventsForTests();
    people = createBenchPeople();
    fake = installFakeVideoStack();
    warn = spyOn(console, "warn").mockImplementation(() => undefined) as unknown as typeof warn;
  });
  afterEach(() => { fake.restore(); warn.mockRestore(); __setKeyframesForTests(async () => null); __setAgeCheckRunnerForTests(async (images) => images.map(() => ok("none", false))); });

  async function run(prompt: string, loras: Array<{ id: string; strength?: number; scale?: number }> = []) {
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(people.owner, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startVideoJob({ actor: people.owner, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt, body: { prompt, audience: "adult", ...(loras.length ? { loras: loras as never } : {}) } as never });
    await until(() => ["done", "failed"].includes(getVideoJobFor(people.owner, job.id)?.state ?? ""));
    return getVideoJobFor(people.owner, job.id)!;
  }

  test("three keyframes (first, middle, last) are checked, and a bad last frame withholds the clip", async () => {
    const frames = [Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)];
    __setKeyframesForTests(async () => frames);
    let received: readonly Uint8Array[] = [];
    __setAgeCheckRunnerForTests(async (images, kind) => { received = images; expect(kind).toBe("video"); return [ok("adult", false), ok("adult", false), ok("child", true)]; });
    const job = await run("a paper boat in the rain");
    expect(received).toEqual(frames);
    expect(job.state).toBe("failed");
    expect(job.error).toBe("I can't show that video. It may show a child in a sexual situation, and that is never allowed.");
    expect(job.files).toEqual([]);
    expect(db.select().from(attachments).all()).toHaveLength(0);
    expect(listPending(people.owner).filter((n) => n.typeId === "safety.picture_withheld")).toHaveLength(1);
  });

  test("when this Mac cannot decode a clip, the poster alone is checked and a good clip is shown", async () => {
    __setKeyframesForTests(async () => null);
    let count = 0;
    __setAgeCheckRunnerForTests(async (images) => { count = images.length; return images.map(() => ok("adult", false)); });
    expect((await run("a paper boat in the rain")).state).toBe("done");
    expect(count).toBe(1);
  });

  test("an adult-only LoRA makes the clip adult-only: a failed check fails closed", async () => {
    const adultStyle = TEST_VIDEO_LORAS.find((l) => l.classification === "adult-only")!;
    __setAgeCheckRunnerForTests(async (images) => images.map((): ImageCheck => ({ ok: false, why: "timeout" })));
    const job = await run("a dancer", [{ id: adultStyle.id, strength: 0.9 }]);
    expect(job.state).toBe("failed");
    expect(job.error).toBe("I couldn't check that video, so I can't show it. Try again in a minute.");
    // An ordinary clip with a failed check is shown.
    expect((await run("a paper boat")).state).toBe("done");
  });
});
