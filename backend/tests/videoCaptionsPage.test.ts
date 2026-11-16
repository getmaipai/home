// CAPTIONS-PAGE-01: the Captions page of the Video app. The served page is valid for every band, each action goes through to the edit job it makes (the same
// `edit_video` captions, title_card and credits the chat uses), and a child, a teen, a locked clip and someone else's clip are refused with a plain line.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resetDb } from "./reset-db";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { PageNodeSchema } from "@/kit/schema/types";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { LOCKED_START_LINE } from "@/lib/videos/lock";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __setTranscriptStackClientForTests } from "@/lib/transcripts/stack";
import { parseCaptionText, NO_SPEECH_LINE } from "@/lib/videos/captionsPage";
import { household, makeClip, markAdultOnly, PLAIN_PROMPT } from "./fixtures/adultLock";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";

let video: FakeVideoStack;
let stack: FakeEditStack;
let heard: Array<{ id: string; start: number; end: number; text: string }> = [];
beforeEach(() => {
  resetDb(); __resetAdultLockForTests(); __resetVideoAdapterCacheForTests();
  video = installFakeVideoStack(); video.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  stack = installFakeEditStack();
  heard = [{ id: "seg1", start: 0.5, end: 2.5, text: "Hello there everyone" }, { id: "seg2", start: 3, end: 5, text: "Welcome to the show" }];
  __setTranscriptStackClientForTests({ transcribeJob: async () => ({ language: "en", engine: "fake-stack", model_id: "fake", segments: heard }) });
});
afterEach(() => { __setKeyframesForTests(null); stack.restore(); video.restore(); __setVideoStatusForTests(undefined); __setTranscriptStackClientForTests(null); });

const DATA = "/api/plugins/video/data/recipes";
const ACT = (name: string) => `/api/plugins/video/actions/${name}`;

async function setup() {
  const fixture = await household();
  const me = fixture.row("Marlow");
  const clip = await makeClip(fixture.adult.client, me, PLAIN_PROMPT);
  return { ...fixture, me, ...clip };
}
const rowsOf = async (res: Response) => (await res.json()) as Array<Record<string, any>>;

describe("the served page", () => {
  test("is a valid page for an adult and is not served to a teen or a child", async () => {
    const { adult, teen, child } = await household();
    const res = await adult.client.get("/api/plugins/video/pages/captions");
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(PageNodeSchema.safeParse(page).success).toBe(true);
    for (const other of [teen, child]) expect([403, 404]).toContain((await other.client.get("/api/plugins/video/pages/captions")).status);
  });

  test("its composer keeps the mode pill and icon-only chips, and every call it makes is an action the host serves", () => {
    const page = JSON.parse(readFileSync(new URL("../packages/video/pages/captions.json", import.meta.url), "utf8")) as { body: Array<Record<string, any>> };
    const bar = page.body.find((node) => node.type === "prompt_bar")!;
    expect(bar.mode_selector.options.length).toBeLessThanOrEqual(4);
    for (const chip of bar.chips) expect(chip.icon_only).toBe(true);
    expect(Object.keys(bar.mode_actions).sort()).toEqual(bar.mode_selector.options.map((option: { value: string }) => option.value).sort());
    expect(JSON.stringify(page)).not.toContain("className");
  });
});

describe("making and fixing the lines", () => {
  test("Make captions listens to the clip once and the lines come back as rows with times", async () => {
    const { adult, fileId } = await setup();
    expect(await rowsOf(await adult.client.post(DATA, { scope: "caption-lines", id: fileId }))).toEqual([]);
    const make = await rowsOf(await adult.client.post(DATA, { scope: "caption-make", id: fileId }));
    expect(make).toHaveLength(1);
    expect(make[0]!.clip).toBe(fileId);
    const res = await adult.client.post(ACT("captions-make"), { clip: fileId });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { lines: number }).lines).toBe(2);
    const lines = await rowsOf(await adult.client.post(DATA, { scope: "caption-lines", id: fileId }));
    expect(lines.map((row) => row.text)).toEqual(["Hello there everyone", "Welcome to the show"]);
    expect(lines[0]!.times).toBe("0:00.5 to 0:02.5");
    expect(await rowsOf(await adult.client.post(DATA, { scope: "caption-make", id: fileId }))).toEqual([]);
    // Again: nothing new is transcribed.
    heard = [];
    expect((await adult.client.post(ACT("captions-make"), { clip: fileId })).status).toBe(200);
  });

  test("a clip with no speech gets a plain line, not a silent success", async () => {
    const { adult, fileId } = await setup();
    heard = [];
    const res = await adult.client.post(ACT("captions-make"), { clip: fileId });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(NO_SPEECH_LINE);
  });

  test("the edit row hands the lines over as text, and a saved fix shows in the lines", async () => {
    const { adult, fileId } = await setup();
    await adult.client.post(ACT("captions-make"), { clip: fileId });
    const edit = await rowsOf(await adult.client.post(DATA, { scope: "caption-edit", id: fileId }));
    const text = edit[0]!.text as string;
    expect(text.split("\n")).toHaveLength(2);
    const fixed = text.replace("Hello there everyone", "Hello there, everyone");
    expect((await adult.client.post(ACT("captions-save"), { clip: fileId, prompt: fixed })).status).toBe(200);
    const lines = await rowsOf(await adult.client.post(DATA, { scope: "caption-lines", id: fileId }));
    expect(lines[0]!.text).toBe("Hello there, everyone");
    const bad = await adult.client.post(ACT("captions-save"), { clip: fileId, prompt: "no times here" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("Line 1");
  });

  test("the typed lines are checked with a plain line each", () => {
    expect(parseCaptionText("0:03-0:06 Hello")).toEqual({ ok: true, lines: [{ from_s: 3, to_s: 6, text: "Hello" }] });
    for (const bad of ["", "Hello", "0:06-0:03 Back", `0:01-0:02 ${"x".repeat(161)}`]) {
      const parsed = parseCaptionText(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(10);
    }
    const many = Array.from({ length: 41 }, (_, i) => `0:${String(i).padStart(2, "0")}-0:${String(i + 1).padStart(2, "0")} a`).join("\n");
    expect(parseCaptionText(many).ok).toBe(false);
  });
});

describe("the edits that make a new clip", () => {
  test("Add to video burns the saved lines at the chosen place, as the Stack's captions step", async () => {
    const { adult, me, fileId } = await setup();
    await adult.client.post(ACT("captions-make"), { clip: fileId });
    const bad = await adult.client.post(ACT("captions-burn"), { clip: fileId, position: "sideways" });
    expect(bad.status).toBe(400);
    const res = await adult.client.post(ACT("captions-burn"), { clip: fileId, position: "top" });
    expect(res.status).toBe(200);
    const made = (await res.json()) as { id: string };
    await until(() => getVideoJobFor(me, made.id)?.state === "done");
    const op = stack.jobs.at(-1)!.input.ops[0] as { op: string; position: string; lines: Array<{ from_s: number; to_s: number; text: string }> };
    expect(op.op).toBe("captions");
    expect(op.position).toBe("top");
    expect(op.lines.map((line) => line.text)).toEqual(["Hello there everyone", "Welcome to the show"]);
  });

  test("Add to video with fixed words in the box saves them first, and without captions it says what to do", async () => {
    const { adult, me, fileId } = await setup();
    const none = await adult.client.post(ACT("captions-burn"), { clip: fileId, position: "bottom" });
    expect(none.status).toBe(404);
    expect(((await none.json()) as { error: string }).error).toContain("Make captions first");
    await adult.client.post(ACT("captions-make"), { clip: fileId });
    const res = await adult.client.post(ACT("captions-burn"), { clip: fileId, position: "bottom", prompt: "0:01-0:02 Only this" });
    expect(res.status).toBe(200);
    const made = (await res.json()) as { id: string };
    await until(() => getVideoJobFor(me, made.id)?.state === "done");
    expect((stack.jobs.at(-1)!.input.ops[0] as { lines: unknown[] }).lines).toEqual([{ from_s: 1, to_s: 2, text: "Only this" }]);
  });

  test("a title and credits start the title_card and credits steps", async () => {
    const { adult, me, fileId } = await setup();
    expect((await adult.client.post(ACT("captions-title"), { clip: fileId, prompt: "" })).status).toBe(400);
    const title = await adult.client.post(ACT("captions-title"), { clip: fileId, prompt: "Our day out\nSummer 2026" });
    expect(title.status).toBe(200);
    const titled = (await title.json()) as { id: string };
    await until(() => getVideoJobFor(me, titled.id)?.state === "done");
    const titleOps = stack.jobs.at(-1)!.input.ops as Array<Record<string, unknown>>;
    expect(titleOps.some((op) => op.op === "title_card" && op.text === "Our day out")).toBe(true);
    expect((await adult.client.post(ACT("captions-credits"), { clip: fileId, prompt: "" })).status).toBe(400);
    const credits = await adult.client.post(ACT("captions-credits"), { clip: fileId, prompt: "Director: Sage\nMarlow" });
    expect(credits.status).toBe(200);
    const credited = (await credits.json()) as { id: string };
    await until(() => getVideoJobFor(me, credited.id)?.state === "done");
    const creditOp = (stack.jobs.at(-1)!.input.ops as Array<Record<string, any>>).find((op) => op.op === "credits")!;
    expect(creditOp.lines ?? creditOp.credits).toEqual([{ role: "Director", name: "Sage" }, { name: "Marlow" }]);
  });
});

describe("who may, and what is refused", () => {
  test("a child and a teen are refused every action and get no rows, and nothing reaches the Stack", async () => {
    const { teen, child, fileId } = await setup();
    const before = stack.jobs.length;
    for (const who of [teen, child]) {
      for (const name of ["captions-make", "captions-save", "captions-burn", "captions-title", "captions-credits"]) {
        expect([403, 404, 422]).toContain((await who.client.post(ACT(name), { clip: fileId, prompt: "0:01-0:02 x" })).status);
      }
      expect((await who.client.post(DATA, { scope: "caption-lines", id: fileId })).status).toBe(404);
    }
    expect(stack.jobs.length).toBe(before);
  });

  test("someone else's clip is not found, for rows and for every action", async () => {
    const { other, fileId } = await setup();
    expect(await rowsOf(await other.client.post(DATA, { scope: "caption-lines", id: fileId }))).toEqual([]);
    for (const name of ["captions-make", "captions-burn", "captions-title", "captions-credits"]) {
      expect((await other.client.post(ACT(name), { clip: fileId, prompt: "Hello" })).status).toBe(404);
    }
  });

  test("a locked clip shows no lines and refuses every action until the Adult lock is open", async () => {
    const { adult, fileId, jobId } = await setup();
    await adult.client.post(ACT("captions-make"), { clip: fileId });
    markAdultOnly(jobId);
    expect(await rowsOf(await adult.client.post(DATA, { scope: "caption-lines", id: fileId }))).toEqual([]);
    for (const name of ["captions-make", "captions-burn", "captions-title"]) {
      const res = await adult.client.post(ACT(name), { clip: fileId, prompt: "Hello" });
      expect(res.status).toBe(423);
      expect(((await res.json()) as { error: string }).error).toBe(LOCKED_START_LINE);
    }
  });
});
