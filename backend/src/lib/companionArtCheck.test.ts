import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import media from "@maipai/spec/vocab/companion-media.json";
import { loadManifestOnly } from "@/lib/plugins";
import { createHouseholdCompanion, getHouseholdCompanion, householdCompanionFolder, setHouseholdCompanionAnimation, setHouseholdCompanionAudience } from "@/lib/householdCompanions";
import { addTake, finishTake, readStates, takePath, __resetCompanionStatesForTests } from "@/lib/companionStates";
import { addVersion, approveSheet, setRest, updateSheet } from "@/lib/companionLook";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { __setAgeCheckRunnerForTests, __resetAgeCheckForTests, type AgeVerdict, type ImageCheck } from "@/lib/pictures/ageCheck";
import { __setChildSafetyRunnerForTests, type ChildSafetyCheck } from "@/lib/pictures/laneGate";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { checkFinishedAssets, stricterLane } from "@/lib/pictures/finishedCheck";
import { checkCompanionArt, sweepLiveCompanionArt } from "@/lib/companionArtCheck";

const dataRoot = process.env.MAIPAI_DATA_DIR!;
const root = join(dataRoot, "companions");
const source = loadManifestOnly("rivet");
if (!source.ok || !source.value.companion) throw new Error("rivet fixture is unavailable");
const sourceCompanion = source.value.companion;

const verdict = (over: Partial<AgeVerdict> = {}): ImageCheck => ({ ok: true, verdict: { people_count: 1, apparent_min_age_estimate: 30, label: "adult", is_nude_or_sexual: false, confidence: 1, ...over } });
const unavailable: ImageCheck = { ok: false, why: "unavailable" };
const cartoon: ChildSafetyCheck = { ok: true, verdict: { is_cartoon: true, looks_like_photo: false, brand_or_licensed_character: false, violent_or_scary: false, sexual_or_romantic: false, weapons_drugs_or_alcohol: false, confidence: 1 } };
const photo: ChildSafetyCheck = { ok: true, verdict: { ...cartoon.ok && cartoon.verdict, is_cartoon: false, looks_like_photo: true } as never };
const bytes = (n: number) => new Uint8Array([n, n + 1, n + 2]);

beforeEach(() => { rmSync(root, { recursive: true, force: true }); __resetCompanionStatesForTests(); });
afterEach(() => { __resetAgeCheckForTests(); __setChildSafetyRunnerForTests(null); __setKeyframesForTests(null); __setStackClientForTests(null); rmSync(root, { recursive: true, force: true }); __resetCompanionStatesForTests(); });

function companion(audience: "adult" | "teen" | "all" = "adult") {
  const result = createHouseholdCompanion({ ...sourceCompanion, display_name: "Art fixture" }, { display_name: "Author", person_id: "art-test" });
  if (!result.ok) throw new Error(result.error);
  if (audience !== "adult") setHouseholdCompanionAudience(result.value.id, audience, { display_name: "Reviewer" });
  return result.value.id;
}

describe("the standard finished-image check", () => {
  test("the stricter lane wins", () => {
    expect(stricterLane("adult", "child")).toBe("child");
    expect(stricterLane("teen", "adult")).toBe("teen");
  });

  test("an adult-only item withholds a minor in a sexual picture, and a check that cannot run, but allows an ordinary picture", async () => {
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict({ label: "possibly_minor", apparent_min_age_estimate: 15, is_nude_or_sexual: true })));
    expect((await checkFinishedAssets({ assets: [{ label: "A", bytes: bytes(1) }], lane: "adult", adultOnly: true, kind: "picture" })).ok).toBe(false);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => unavailable));
    const down = await checkFinishedAssets({ assets: [{ label: "A", bytes: bytes(2) }], lane: "adult", adultOnly: true, kind: "picture" });
    expect(down).toMatchObject({ ok: false, unavailable: true });
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict()));
    expect((await checkFinishedAssets({ assets: [{ label: "A", bytes: bytes(3) }], lane: "adult", adultOnly: true, kind: "picture" })).ok).toBe(true);
  });

  test("a missing file fails closed and names the asset", async () => {
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict()));
    const result = await checkFinishedAssets({ assets: [{ label: "The idle still" }], lane: "adult", adultOnly: true, kind: "picture" });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain("The idle still");
  });

  test("the child lane also needs the cartoon answer, and a verdict is asked once per file", async () => {
    let age = 0, child = 0;
    __setAgeCheckRunnerForTests(async (images) => { age++; return images.map(() => verdict({ people_count: 0, apparent_min_age_estimate: null, label: "none" })); });
    __setChildSafetyRunnerForTests(async (images) => { child++; return images.map(() => photo); });
    const cache = {};
    const refused = await checkFinishedAssets({ assets: [{ label: "A", bytes: bytes(5) }], lane: "child", adultOnly: false, kind: "picture", cache });
    expect(refused.ok).toBe(false);
    __setChildSafetyRunnerForTests(async (images) => { child++; return images.map(() => cartoon); });
    const again = await checkFinishedAssets({ assets: [{ label: "B", bytes: bytes(6) }], lane: "child", adultOnly: false, kind: "picture", cache });
    expect(again.ok).toBe(true);
    const before = { age, child };
    await checkFinishedAssets({ assets: [{ label: "B", bytes: bytes(6) }], lane: "child", adultOnly: false, kind: "picture", cache });
    expect({ age, child }).toEqual(before);
  });
});

describe("companion art", () => {
  test("an all-ages companion's art is held to the child lane even for an adult who asked", async () => {
    const id = companion("all");
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict()));
    __setChildSafetyRunnerForTests(async (images) => images.map(() => photo));
    const result = await checkCompanionArt(id, null, [{ label: "A", bytes: bytes(7) }]);
    expect(result.ok).toBe(false);
    expect(readStates(id).checks).toBeDefined();
  });

  test("a finished clip that fails the check is withheld: its files are removed and the take says why", async () => {
    const id = companion();
    const rest = addVersion(id, new Uint8Array([1]), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id);
    updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "red fox", species: "fox", colours: ["#CC3322"] }, key: "#FF00FF", state: "needs_review", approved_by: null, approved_at: null } as never); approveSheet(id, "Author");
    const take = addTake(id, "idle", { source: "upload", label: "idle" }); writeFileSync(takePath(id, "idle", take.id, "source.mp4")!, "source");
    __setKeyframesForTests(async () => [new Uint8Array([7])]);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict({ label: "child", apparent_min_age_estimate: 8, is_nude_or_sexual: true })));
    __setStackClientForTests({ mediaRoots: async () => ({ read: [root], write: [root] }), setMediaRoots: async () => ({ read: [root], write: [root] }), submitJob: async (job: any) => { const out = join(job.input.output_dir, job.input.output_name); mkdirSync(out, { recursive: true }); writeFileSync(join(out, "clip.h264.mp4"), "h264"); writeFileSync(join(out, "still.png"), "png"); return { id: "j", state: "done", result: { ok: true, reasons: [], seconds: 3, files: [{ name: "clip.h264.mp4", bytes: 4 }], av1: false } }; }, job: async () => { throw Error("unexpected poll"); } } as never);
    await expect(finishTake(id, "idle", take.id, { alpha: false })).rejects.toThrow();
    expect(existsSync(takePath(id, "idle", take.id, "still.png")!)).toBe(false);
    expect(existsSync(takePath(id, "idle", take.id, "clip.h264.mp4")!)).toBe(false);
    const row = readStates(id).states.idle!.takes[0]!;
    expect(row.report).toBeNull();
    expect(row.failure?.length ?? 0).toBeGreaterThan(10);
  });
});

describe("the one-time check of live art", () => {
  function withLiveArt(id: string) {
    const folder = householdCompanionFolder(id)!, live = join(folder, "animation"); mkdirSync(live, { recursive: true });
    writeFileSync(join(live, "rest.png"), "rest"); writeFileSync(join(live, "idle.png"), "still"); writeFileSync(join(live, "idle.h264.mp4"), "clip");
    const result = setHouseholdCompanionAnimation(id, { kind: "video", spec_version: media.version, key: "#FF00FF", sheet: { rest: "rest.png", card: "card.json" }, states: { idle: { h264: "idle.h264.mp4", still: "idle.png", loop: true } }, provenance: { approved_by: "Author", approved_at: new Date().toISOString() } } as never);
    if (!result.ok) throw new Error(result.error);
    __setKeyframesForTests(async () => [new Uint8Array([9])]);
  }

  test("art that fails the child lane narrows the companion to the audience it does pass, once", async () => {
    const id = companion("all"); withLiveArt(id);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict()));
    __setChildSafetyRunnerForTests(async (images) => images.map(() => photo));
    const outcomes = await sweepLiveCompanionArt();
    expect(outcomes).toEqual([{ companionId: id, from: "all", to: "teen", unavailable: false }]);
    expect(getHouseholdCompanion(id)?.companion?.audience).toBe("teen");
    expect(await sweepLiveCompanionArt()).toEqual([]);
  });

  test("a companion whose art cannot be checked is left alone and tried again next time", async () => {
    const id = companion("all"); withLiveArt(id);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => unavailable));
    const outcomes = await sweepLiveCompanionArt();
    expect(outcomes[0]).toMatchObject({ companionId: id, to: null, unavailable: true });
    expect(getHouseholdCompanion(id)?.companion?.audience).toBe("all");
    __setAgeCheckRunnerForTests(async (images) => images.map(() => verdict()));
    __setChildSafetyRunnerForTests(async (images) => images.map(() => cartoon));
    expect((await sweepLiveCompanionArt())[0]).toMatchObject({ to: "all" });
  });
});
