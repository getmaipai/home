// MODELPACK-HOME-02: pictures ask the Stack for generic jobs. Home names no model: a part is an opaque id the Stack gave (its jobs catalog), a
// picture that must show words runs only on a part the catalog says spells them (rule W1), and the spelling re-make goes to the next part (rule W4).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { fakeJobsCatalog, installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { __setReadWordsRunnerForTests, type ReadWordsResult } from "@/lib/pictures/readWords";
import { needsNoTextLine, partsAfter, pictureJobView, servesShape, wordsCanStart } from "@/lib/pictures/catalog";
import { submitEdit, submitGeneration } from "@/lib/pictures/stack";

describe("what the jobs catalog says, read for the picture jobs", () => {
  const catalog = (parts: Array<{ id: string; text: boolean; shapes?: Array<"square" | "landscape" | "portrait"> }>) => pictureJobView(fakeJobsCatalog("adult", parts), "picture");

  test("the part shown, its capabilities, its shapes and the alternatives in the Stack's order", () => {
    const view = catalog([{ id: "a", text: true, shapes: ["square", "portrait"] }, { id: "b", text: false }])!;
    expect(view.available).toBe(true);
    expect(view.part).toEqual({ id: "a", label: "a" });
    expect(view.text).toBe(true);
    expect(view.alternatives).toEqual([{ part: "b", label: "b" }]);
    expect(servesShape(view, "portrait", "standard")).toBe(true);
    expect(servesShape(view, "landscape", "standard")).toBe(false);
    expect(servesShape(view, "portrait", "boost")).toBe(false);
  });

  test("no part on: not available, and a job the catalog does not list is null", () => {
    const view = catalog([])!;
    expect(view.available).toBe(false);
    expect(view.part).toBeNull();
    expect(pictureJobView({ audience: "adult", jobs: [] }, "picture")).toBeNull();
  });

  test("words start only on a part that spells them; an unreadable catalog refuses nothing on a guess", () => {
    expect(wordsCanStart(catalog([{ id: "a", text: true }]))).toBe(true);
    expect(wordsCanStart(catalog([{ id: "a", text: false }]))).toBe(false);
    expect(wordsCanStart(catalog([]))).toBe(false);
    expect(wordsCanStart(null)).toBe(true);
  });

  test("the no-text sentence is for a part the catalog does not mark as spelling (rule W2), and never on a guess", () => {
    expect(needsNoTextLine(catalog([{ id: "a", text: false }]))).toBe(true);
    expect(needsNoTextLine(catalog([{ id: "a", text: true }]))).toBe(false);
    expect(needsNoTextLine(catalog([]))).toBe(false);
    expect(needsNoTextLine(null)).toBe(false);
  });

  test("the re-make tries the part after the one that ran, wraps, and keeps the one that ran last", () => {
    const view = catalog([{ id: "a", text: true }, { id: "b", text: true }, { id: "c", text: true }]);
    expect(partsAfter(view, "a")).toEqual(["b", "c"]);
    expect(partsAfter(view, "b")).toEqual(["c", "a"]);
    expect(partsAfter(view, "c")).toEqual(["a", "b"]);
    expect(partsAfter(view, null)).toEqual(["a", "b", "c"]);
    expect(partsAfter(view, "unknown-to-the-list")).toEqual(["a", "b", "c"]);
    expect(partsAfter(catalog([{ id: "a", text: true }]), "a")).toEqual(["a"]);
    expect(partsAfter(catalog([]), "a")).toEqual([]);
    expect(partsAfter(null, "a")).toEqual([]);
  });
});

let people: BenchPeople;
let fake: FakeImageStack;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeImageStack(); });
afterEach(() => { __setReadWordsRunnerForTests(null); fake.restore(); });

describe("the part a picture or an edit is asked for", () => {
  test("a generation that names no part goes to the part the catalog serves for its list", async () => {
    fake.catalog.adult = fakeJobsCatalog("adult", [{ id: "adult-part", text: true }]);
    fake.catalog.minor = fakeJobsCatalog("minor", [{ id: "minor-part", text: true }]);
    await submitGeneration({ prompt: "a fox", audience: "adult", timeout_ms: 1 });
    await submitGeneration({ prompt: "a fox", audience: "all-ages", timeout_ms: 1 });
    expect(fake.submitted.map((body) => body.model)).toEqual(["adult-part", "minor-part"]);
  });

  test("a generation that already names a part (the household's pick for its level) keeps it", async () => {
    fake.serveCatalog([{ id: "served", text: true }]);
    await submitGeneration({ prompt: "a fox", audience: "adult", model: "household-pick", timeout_ms: 1 });
    expect(fake.submitted[0]!.model).toBe("household-pick");
  });

  test("an unreadable catalog leaves the part to the Stack: no part is sent", async () => {
    await submitGeneration({ prompt: "a fox", audience: "adult", timeout_ms: 1 });
    expect(fake.submitted[0]!.model).toBeUndefined();
  });

  test("the generic request never carries the picture-only `ask` onto the size-and-prompt route", async () => {
    await submitGeneration({ prompt: "a poster", audience: "adult", ask: { description: "a poster", words: ["Hi"], shape: "square" }, timeout_ms: 1 });
    expect(fake.submitted[0]!.ask).toBeUndefined();
  });

  test("an edit names the part the catalog serves for picture_edit: the minor list unless the form says adult", async () => {
    fake.catalog.adult = fakeJobsCatalog("adult", [{ id: "adult-part", text: true }]);
    fake.catalog.minor = fakeJobsCatalog("minor", [{ id: "minor-part", text: true }]);
    const form = (audience?: string) => { const f = new FormData(); f.append("image", new File([new Uint8Array([1])], "p.png", { type: "image/png" })); f.append("operation", "edit"); f.append("instruction", "x"); if (audience) f.append("audience", audience); return f; };
    await submitEdit(form());
    await submitEdit(form("all-ages"));
    await submitEdit(form("adult"));
    expect(fake.edits.map((edit) => edit.model)).toEqual(["minor-part", "minor-part", "adult-part"]);
  });

  test("an edit that names a part keeps it, and an unreadable catalog sends none", async () => {
    const form = new FormData(); form.append("image", new File([new Uint8Array([1])], "p.png", { type: "image/png" })); form.append("operation", "edit"); form.append("instruction", "x"); form.append("model", "named");
    await submitEdit(form);
    const bare = new FormData(); bare.append("image", new File([new Uint8Array([1])], "p.png", { type: "image/png" })); bare.append("operation", "edit"); bare.append("instruction", "x");
    await submitEdit(bare);
    expect(fake.edits[0]!.model).toBe("named");
    expect(fake.edits[1]!.model).toBeUndefined();
  });
});

describe("the spelling re-make goes to the next part that can spell (rules W1 and W4)", () => {
  const WORDS = ["Grand Opening"];
  const ask = { description: "a poster", words: WORDS, shape: "square" as const };
  const body = (extra: Record<string, unknown> = {}) => ({ prompt: "a poster", audience: "adult" as const, ask, ...extra });
  let reads = 0;
  const readerThatSays = (lines: string[][]) => { reads = 0; __setReadWordsRunnerForTests(async (): Promise<ReadWordsResult> => ({ ok: true, lines: lines[Math.min(reads++, lines.length - 1)]! })); };
  async function run(bodyArg = body()) {
    const job = await startPictureJob({ actor: people.owner, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "a poster", body: bodyArg, words: WORDS });
    await until(() => getPictureJob(people.owner, job.id)?.state === "done");
    return getPictureJob(people.owner, job.id)!;
  }

  test("a misspelled first take is asked again of the other part, with the exact words, and the better take is kept", async () => {
    fake.serveCatalog([{ id: "part-a", text: true }, { id: "part-b", text: true }]);
    readerThatSays([["Grand Openig"], ["Grand Opening"]]);
    const job = await run();
    expect(fake.submitted).toHaveLength(1);
    expect(fake.submitted[0]!.model).toBe("part-a");
    expect(fake.makes).toHaveLength(1);
    expect(fake.makes[0]).toMatchObject({ job: "picture", audience: "adult", part: "part-b", description: "a poster", words: "Grand Opening", shape: "square", level: "standard" });
    expect(fake.makes[0]!.seed).not.toBe(fake.submitted[0]!.seed);
    expect(job.request.wordCheck).toEqual({ checked: "yes", missing: [], takes: 2 });
    expect(job.request.wordsNote).toBeUndefined();
  });

  test("the second re-make goes to the part after that one, wrapping back to the first", async () => {
    fake.serveCatalog([{ id: "part-a", text: true }, { id: "part-b", text: true }]);
    readerThatSays([["Grnad Opening"], ["Grand Openig"], ["Grad Opening"]]);
    const job = await run();
    expect(fake.makes.map((make) => make.part)).toEqual(["part-b", "part-a"]);
    expect(job.request.wordCheck).toEqual({ checked: "yes", missing: WORDS, takes: 3 });
    expect(job.request.wordsNote).toBe('These words may be misspelled: "Grand Opening". Try again, or edit the picture.');
    expect(job.state).toBe("done");
  });

  test("a part that cannot spell is refused by the Stack and skipped: the next one is tried", async () => {
    fake.serveCatalog([{ id: "part-a", text: true }, { id: "part-b", text: false }, { id: "part-c", text: true }]);
    fake.cannotSpell.add("part-b");
    readerThatSays([["Grand Openig"], ["Grand Opening"]]);
    await run();
    expect(fake.makes.map((make) => make.part)).toEqual(["part-b", "part-c"]);
  });

  test("when no other part takes it the same request is made again on the size-and-prompt route, as before", async () => {
    fake.serveCatalog([{ id: "part-a", text: true }, { id: "part-b", text: false }]);
    fake.cannotSpell.add("part-b");
    readerThatSays([["Grand Openig"], ["Grand Opening"]]);
    const job = await run();
    expect(fake.makes).toHaveLength(1);
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]!.seed).not.toBe(fake.submitted[0]!.seed);
    expect(job.request.wordCheck).toEqual({ checked: "yes", missing: [], takes: 2 });
  });

  test("a picture with a style is more than the generic job carries: its re-make stays on the size-and-prompt route", async () => {
    fake.serveCatalog([{ id: "part-a", text: true }, { id: "part-b", text: true }]);
    readerThatSays([["Grand Openig"], ["Grand Opening"]]);
    await run(body({ loras: [{ id: "lora-aaaaaaaaaaaaaaaa", scale: 0.8 }] }));
    expect(fake.makes).toHaveLength(0);
    expect(fake.submitted).toHaveLength(2);
  });

  test("a shape the part does not serve stays on the size-and-prompt route", async () => {
    fake.serveCatalog([{ id: "part-a", text: true, shapes: ["square"] }]);
    readerThatSays([["Grand Openig"], ["Grand Opening"]]);
    await run(body({ ask: { ...ask, shape: "landscape" } }));
    expect(fake.makes).toHaveLength(0);
    expect(fake.submitted).toHaveLength(2);
  });

  test("an unreadable catalog also leaves the re-make on the size-and-prompt route", async () => {
    readerThatSays([["Grand Openig"], ["Grand Opening"]]);
    await run();
    expect(fake.makes).toHaveLength(0);
    expect(fake.submitted).toHaveLength(2);
  });
});
