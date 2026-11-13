// MP-05: takes and seed of a song request. One request of up to three takes is up to three queue jobs run one after another,
// shown as ONE song card whose versions are the takes; the seed is passed through and shown on the card.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { installFakeMusicStack, musicState, LYRICS, waitForMusic } from "./musicFixture";
import { generateMusicArgs, runGenerateMusic, runEditMusic } from "@/lib/music/tool";
import { getMusicJobFor, jobsForPerson, musicVersions } from "@/lib/music/jobs";
import { musicForOutcomes } from "@/lib/composer";
import { musicCardView } from "@/routes/music";

let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); });
afterEach(() => { fake.restore(); });
const ARGS = { description: "a gentle folk song with an original voice", lyrics: LYRICS, title: "Pancakes", seconds: 60 };
const make = (args: Record<string, unknown>) => runGenerateMusic({ state: musicState(people.owner), args: { ...ARGS, ...args }, callId: "g", spoken: false });

describe("generate_music takes and seed", () => {
  test("the arguments are bounded: takes 1 to 3, a positive integer seed", () => {
    expect(generateMusicArgs.safeParse({ ...ARGS, takes: 3, seed: 42 }).success).toBe(true);
    expect(generateMusicArgs.safeParse({ ...ARGS, takes: 4 }).success).toBe(false);
    expect(generateMusicArgs.safeParse({ ...ARGS, takes: 0 }).success).toBe(false);
    expect(generateMusicArgs.safeParse({ ...ARGS, seed: 0 }).success).toBe(false);
    expect(generateMusicArgs.safeParse({ ...ARGS, seed: 1.5 }).success).toBe(false);
  });
  test("a seed is sent to the engine and kept on the job; no takes means no group", async () => {
    const out = await make({ seed: 4242 });
    const job = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    expect(job.request.seed).toBe(4242);
    expect(job.request.takes).toBeUndefined();
    expect(fake.submitted[0]).toMatchObject({ seed: 4242 });
    await waitForMusic(() => getMusicJobFor(people.owner, job.id)!.state === "done");
    expect(fake.submitted).toHaveLength(1);
    const card = await musicCardView(people.owner, getMusicJobFor(people.owner, job.id)!);
    expect(card.seed).toBe(4242);
    expect(card.takes).toBeNull();
  });
  test("three takes are three queue jobs in one group, each with its own seed, shown as one card", async () => {
    const out = await make({ takes: 3, seed: 100 });
    expect(out.result?.reply?.text).toContain("3 takes");
    const first = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    expect(first.request.takes).toMatchObject({ index: 0, total: 3 });
    const group = first.request.takes!.group;
    const inGroup = () => jobsForPerson(people.owner, 50).filter((job) => job.request.takes?.group === group);
    await waitForMusic(() => inGroup().length === 3 && inGroup().every((job) => job.state === "done"));
    expect(fake.submitted).toHaveLength(3);
    expect(fake.submitted.map((body) => body.seed)).toEqual([100, 101, 102]);
    const jobs = inGroup().sort((a, b) => a.request.takes!.index - b.request.takes!.index);
    expect(jobs.map((job) => job.request.takes!.index)).toEqual([0, 1, 2]);
    expect(new Set(jobs.map((job) => job.fileId)).size).toBe(3);
    // One card: the first take's card steps through every take.
    const card = await musicCardView(people.owner, getMusicJobFor(people.owner, first.id)!);
    expect(card.versions.map((version) => version.label)).toEqual(["Take 1", "Take 2", "Take 3"]);
    expect(card.takes).toMatchObject({ group, total: 3 });
    expect(musicVersions(people.owner, getMusicJobFor(people.owner, first.id)!)).toHaveLength(3);
    // Any take opens the same card family, and each take shows its own seed.
    const third = await musicCardView(people.owner, getMusicJobFor(people.owner, jobs[2]!.id)!);
    expect(third.versions).toHaveLength(3);
    expect(third.seed).toBe(102);
  });
  test("a take that is still being made shows on the card as the next version", async () => {
    fake.pollsToFinish = 6;
    const out = await make({ takes: 2 });
    const first = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    await waitForMusic(() => getMusicJobFor(people.owner, first.id)!.state === "done" && jobsForPerson(people.owner, 50).some((job) => job.request.takes?.index === 1));
    const card = await musicCardView(people.owner, getMusicJobFor(people.owner, first.id)!);
    expect(card.state).toBe("done");
    expect(card.making_version).not.toBeNull();
    await waitForMusic(() => jobsForPerson(people.owner, 50).filter((job) => job.state === "done").length === 2);
  });
  test("editing a take (a remake) makes a version, never another set of takes", async () => {
    const out = await make({ takes: 2 });
    const first = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    const group = first.request.takes!.group;
    await waitForMusic(() => jobsForPerson(people.owner, 50).filter((job) => job.request.takes?.group === group && job.state === "done").length === 2);
    const edit = await runEditMusic({ state: musicState(people.owner, false, first.conversationId!), args: { track: "latest", change: "variation" }, callId: "e", spoken: false });
    expect(edit.status).toBe("succeeded");
    const editId = (edit.result?.data as { musicJobId: string }).musicJobId;
    await waitForMusic(() => getMusicJobFor(people.owner, editId)?.state === "done");
    expect(getMusicJobFor(people.owner, editId)!.request.takes).toBeUndefined();
    expect(jobsForPerson(people.owner, 50).filter((job) => job.request.takes?.group === group)).toHaveLength(2);
    expect(fake.submitted).toHaveLength(3);
  });
  test("when a take fails the run ends and the earlier takes stay", async () => {
    const out = await make({ takes: 3 });
    const first = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    await waitForMusic(() => getMusicJobFor(people.owner, first.id)!.state === "done");
    fake.fail = { code: "failed", error: "model crashed" };
    await waitForMusic(() => jobsForPerson(people.owner, 50).some((job) => job.request.takes?.index === 1 && job.state === "failed"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(jobsForPerson(people.owner, 50).filter((job) => job.request.takes?.group === first.request.takes!.group)).toHaveLength(2);
    expect(getMusicJobFor(people.owner, first.id)!.state).toBe("done");
  });
});
