import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { addBenchTeen, createBenchPeople } from "../scripts/bench/conversationRunner";
import { __resetAdultLockForTests, __unlockRestOfTest } from "@/lib/adultLock";
import { __resetLoraSyncForTests } from "@/lib/loras/sync";
import { saveLora } from "@/lib/loras/store";
import { getPictureJob } from "@/lib/pictures/jobs";
import { runGenerateImage } from "@/lib/pictures/tool";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { secretLora } from "./fixtures/lora";
import type { PersonRow } from "@/types";

let fake: FakeImageStack;
let owner: PersonRow;
let child: PersonRow;
let teen: PersonRow;
const stateFor = (actor: PersonRow) => ({ actor, surface: "chat", planBasis: { surfaceClass: "written" }, conversationId: "conv-style-lock", turnId: "turn-style-lock", temporary: true, ephemeral: false } as never);
const make = (actor: PersonRow, style: string, prompt = "a quiet landscape") => runGenerateImage({ state: stateFor(actor), args: { prompt, style }, callId: "style-lock-call", spoken: false });
const outcomeText = (result: Awaited<ReturnType<typeof make>>) => (result.result?.reply as { text: string }).text;

beforeEach(() => {
  resetDb(); __resetAdultLockForTests(); __resetLoraSyncForTests();
  const people = createBenchPeople(); owner = people.owner; child = people.child; teen = addBenchTeen(people);
  fake = installFakeImageStack();
  const adult = secretLora(owner.id, { media: "picture", name: "Zebraquill hidden look", file: { sha256: "d".repeat(64), bytes: 1000, rank: 16, modules: [], format: "safetensors" } });
  const allAges = secretLora(owner.id, { id: "lora-aaaaaaaaaaaaaaaa", media: "picture", file: { sha256: "e".repeat(64), bytes: 1000, rank: 16, modules: [], format: "safetensors" }, audience: "all-ages", audience_set_by: owner.id, audience_set_at: new Date().toISOString(), availability: { who: "adults", people: [] }, name: "Pixel Art", trigger_words: ["pixelart"] });
  saveLora(adult, owner.id); saveLora(allAges, owner.id);
  fake.loras = [
    { id: adult.id, name: adult.name, sha256: adult.file.sha256, bytes: 1000, base_model: "flux2-klein-4b", licence: "MIT", source_url: null, classification: "adult-only", trigger_words: adult.trigger_words, strength_default: 0.9, added_at: adult.added_at },
    { id: allAges.id, name: allAges.name, sha256: allAges.file.sha256, bytes: 1000, base_model: "flux2-klein-4b", licence: "MIT", source_url: null, classification: "all-ages", trigger_words: allAges.trigger_words, strength_default: 0.8, added_at: allAges.added_at },
  ];
});
afterEach(() => { fake.restore(); __resetAdultLockForTests(); __resetLoraSyncForTests(); });

describe("ADULT-LOCK-07 picture style lock", () => {
  test("no proof refuses an adult style without submitting or echoing request text", async () => {
    const result = await make(owner, "Zebraquill hidden look");
    expect(fake.submitted).toHaveLength(0);
    expect(result.result?.data).toEqual({ locked: true });
    expect(outcomeText(result)).toContain("locked");
    expect(outcomeText(result)).not.toContain("quiet landscape");
    expect(outcomeText(result)).not.toContain("Zebraquill");
  });

  test("a live proof starts the job and the finished file stays adult-only and locked", async () => {
    __unlockRestOfTest(owner.id);
    const result = await make(owner, "Zebraquill hidden look");
    const id = (result.result?.data as { pictureJobId: string }).pictureJobId;
    await until(() => getPictureJob(owner, id)?.state === "done");
    expect(fake.submitted).toHaveLength(1);
    expect(getPictureJob(owner, id)?.request.adultLock).toBe("on");
  });

  test("all-ages style starts without proof; a name that matches no adult style starts no adult picture", async () => {
    const open = await make(owner, "Pixel Art");
    expect(open.result?.data).toHaveProperty("pictureJobId");
    // Nothing adult can start from a name that matches no style: it is dropped as before and the picture is plain.
    const unknown = await make(owner, "unknown-style-id");
    expect(unknown.result?.data).toHaveProperty("pictureJobId");
    // The matcher may pick the only all-ages style; what matters is that no adult style or adult audience rides along.
    expect(JSON.stringify(fake.submitted.at(-1)!.loras ?? [])).not.toContain("lora-bbbb");
  });

  test("a child or teen keeps the existing refusal and submits nothing", async () => {
    for (const minor of [child, teen]) {
      const result = await make(minor, "Zebraquill hidden look", "a nude child in a garden");
      expect(fake.submitted).toHaveLength(0);
      expect(result.result?.data).toHaveProperty("refused");
    }
  });
});
