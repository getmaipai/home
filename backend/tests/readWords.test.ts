// TEXT-PIC-05 (Home): the exact comparison, and the spelling check in the picture job's finish step.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setReadWordsRunnerForTests, compareWords, readPictureWords, type ReadWordsResult } from "@/lib/pictures/readWords";
import { pictureActivityItem } from "@/lib/activity";
import { db } from "@/db";
import { creations } from "@/db/schema";

describe("compareWords", () => {
  test("exact, case, spacing and punctuation", () => {
    expect(compareWords(["Grand Opening"], ["Grand Opening"])).toEqual([]);
    expect(compareWords(["Grand Opening"], ["GRAND opening"])).toEqual([]);
    expect(compareWords(["Grand Opening"], ["Grand    Opening!"])).toEqual([]);
  });
  test("inside a longer line", () => {
    expect(compareWords(["Open"], ["Now Open Today"])).toEqual([]);
    expect(compareWords(["Open Today"], ["Now Open", "Today only"])).toEqual([]);
  });
  test("a one-letter typo is missing", () => {
    expect(compareWords(["Grand Opening"], ["Grand Openig"])).toEqual(["Grand Opening"]);
    expect(compareWords(["Sale", "Today"], ["Sale", "Todya"])).toEqual(["Today"]);
  });
  test("empty required passes, nothing found misses", () => {
    expect(compareWords([], ["anything"])).toEqual([]);
    expect(compareWords(["Hello"], [])).toEqual(["Hello"]);
  });
});

let people: BenchPeople;
let fake: FakeImageStack;
let reads: number;
const WORDS = ["Grand Opening"];
const body = { prompt: "a poster", audience: "adult" as const };

function readerThatSays(lines: Array<string[] | "down">): void {
  reads = 0;
  __setReadWordsRunnerForTests(async (): Promise<ReadWordsResult> => {
    const answer = lines[Math.min(reads, lines.length - 1)]!;
    reads += 1;
    return answer === "down" ? { ok: false, why: "no_vision" } : { ok: true, lines: answer };
  });
}

beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeImageStack(); });
afterEach(() => { __setReadWordsRunnerForTests(null); fake.restore(); });

async function run(words?: string[]) {
  const job = await startPictureJob({ actor: people.owner, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "a poster", body, ...(words ? { words } : {}) });
  await until(() => getPictureJob(people.owner, job.id)?.state === "done");
  return getPictureJob(people.owner, job.id)!;
}

describe("the spelling check in the picture job", () => {
  test("the job request stores the words", async () => {
    readerThatSays([WORDS]);
    expect((await run(WORDS)).request.words).toEqual(WORDS);
  });

  test("first take misspelled, second correct: one retry, the second is kept", async () => {
    readerThatSays([["Grand Openig"], ["Grand Opening"]]);
    const job = await run(WORDS);
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]!.seed).not.toBe(fake.submitted[0]!.seed);
    expect(job.request.wordCheck).toEqual({ checked: "yes", missing: [], takes: 2 });
    expect(job.request.wordsNote).toBeUndefined();
    expect(job.files).toHaveLength(1);
  });

  test("always wrong: three takes, the best kept, the plain note present", async () => {
    readerThatSays([["Grnad Opening"], ["Grand Openig"], ["Grad Opening"]]);
    const job = await run(WORDS);
    expect(fake.submitted).toHaveLength(3);
    expect(job.request.wordCheck).toEqual({ checked: "yes", missing: WORDS, takes: 3 });
    expect(job.request.wordsNote).toBe('These words may be misspelled: "Grand Opening". Try again, or edit the picture.');
    expect(job.state).toBe("done");
    const item = pictureActivityItem(people.owner, job);
    expect(item?.line).toBe(job.request.wordsNote ?? null);
  });

  test("the best take wins: fewest missing words", async () => {
    readerThatSays([["Sale", "Todya"], ["Sael", "Todya"], ["Sale", "Today"]]);
    const job = await run(["Sale", "Today"]);
    expect(job.request.wordCheck).toEqual({ checked: "yes", missing: [], takes: 3 });
  });

  test("the Activity line while it is made again reads the spelling line", async () => {
    let line = "" as string | null;
    let id = "";
    reads = 0;
    __setReadWordsRunnerForTests(async () => {
      reads += 1;
      if (reads === 2) { const now = getPictureJob(people.owner, id)!; line = pictureActivityItem(people.owner, now)?.line ?? null; }
      return { ok: true, lines: reads < 2 ? ["Wrong"] : WORDS };
    });
    id = (await startPictureJob({ actor: people.owner, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "a poster", body, words: WORDS })).id;
    await until(() => getPictureJob(people.owner, id)?.state === "done");
    expect(line).toBe("Making it again to fix the spelling");
  });

  test("the vision model is down: the picture is kept, checked no, no retry", async () => {
    readerThatSays(["down"]);
    const job = await run(WORDS);
    expect(fake.submitted).toHaveLength(1);
    expect(job.request.wordCheck).toEqual({ checked: "no", missing: [], takes: 1 });
    expect(job.request.wordsNote).toBeUndefined();
    expect(job.files).toHaveLength(1);
  });

  test("no words: the vision model is never asked", async () => {
    readerThatSays([["anything"]]);
    const job = await run();
    expect(reads).toBe(0);
    expect(job.request.wordCheck).toBeUndefined();
    expect(fake.submitted).toHaveLength(1);
  });

  test("the age gate still runs on the kept picture", async () => {
    readerThatSays([["Grand Openig"], ["Grand Opening"]]);
    let aged = 0;
    __setAgeCheckRunnerForTests(async (images) => { aged += images.length; return images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })); });
    await run(WORDS);
    expect(aged).toBe(1);
  });

  test("the creation record carries the exact words and the result", async () => {
    readerThatSays([["Grand Opening"]]);
    await run(WORDS);
    const rows = db.select().from(creations).all();
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows[0]);
    expect(text).toContain("picture_words");
    expect(text).toContain("Grand Opening");
    expect(text).toContain("checked");
  });

  test("a real read with no model answers unavailable, never throws", async () => {
    __setReadWordsRunnerForTests(null);
    const read = await readPictureWords(new Uint8Array([1, 2, 3]));
    expect(read.ok).toBe(false);
  });
});
