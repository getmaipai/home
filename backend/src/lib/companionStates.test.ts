import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import media from "@maipai/spec/vocab/companion-media.json";
import { createHouseholdCompanion } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { addTake, bestTake, companionStateJob, finishTake, readStates, saveStates, takePath, takeUsable, CLIP_MISSING_LINE, __resetCompanionStatesForTests, type CompanionTake } from "@/lib/companionStates";
import { addVersion, setRest, updateSheet } from "@/lib/companionLook";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";

const dataRoot = process.env.MAIPAI_DATA_DIR!;
const root = join(dataRoot, "companions");
const fixture = loadManifestOnly("rivet");
const fixtureCompanion = fixture.ok ? fixture.value.companion : null;
if (!fixtureCompanion) throw new Error("rivet fixture is unavailable");

const report = (over: Partial<NonNullable<CompanionTake["report"]>> = {}): NonNullable<CompanionTake["report"]> => ({ ok: false, reasons: ["The first and last poses do not join smoothly. Make a steadier loop."], seconds: 2, bytes: { h264: 109169, av1: 183999 }, colour_distance: 50.3, frame0_keyframe_distance: 187.5, area_ratio: 1.01, loop_gap: 9.5, opaque_share: { min: 0.54, max: 0.55 }, ...over });
const take = (id: string, over: Partial<CompanionTake> = {}): CompanionTake => ({ id, created_at: "2026-10-29T19:45:44.635Z", source: "generated", seed: 1, label: `Candidate ${id.slice(5)}`, report: report(), failure: null, ...over });

function companion(): string {
  const result = createHouseholdCompanion({ ...fixtureCompanion!, display_name: "States test" }, { display_name: "Author", person_id: "states-test" });
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

beforeEach(() => { rmSync(root, { recursive: true, force: true }); __resetCompanionStatesForTests(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); __setStackClientForTests(null); __setKeyframesForTests(null); __setAgeCheckRunnerForTests(null); __resetCompanionStatesForTests(); });

describe("finished clips are usable whatever their quality notes say (owner policy 2026-10-29)", () => {
  test("takes saved under the old rules flip to usable once and the best one is approved by itself", () => {
    const id = companion();
    const stored = readStates(id);
    stored.states.listening = { motion: null, approved: null, approved_by: null, approved_at: null, takes: [take("take-1"), take("take-2", { report: report({ reasons: [], colour_distance: 20 }) }), take("take-3", { report: report({ bytes: { h264: 0, av1: null } }) })] };
    stored.states.idle = { motion: null, approved: null, approved_by: null, approved_at: null, takes: [take("take-1", { report: null, failure: "The video engine took too long. Try again." })] };
    saveStates(id, stored);
    const first = readStates(id), listening = first.states.listening!;
    expect(listening.takes.map((row) => row.report?.ok)).toEqual([true, true, false]);
    expect(listening.takes[0]!.report!.reasons).toEqual(["The first and last poses do not join smoothly. Make a steadier loop."]);
    expect(listening.approved).toBe("take-2");
    expect(listening.approved_by).toBe("automatic");
    expect(first.states.idle!.approved).toBeNull();
    // The flip is written back and runs once: an unapproval by a person stays.
    expect(JSON.parse(readFileSync(join(root, id, "states", "states.json"), "utf8")).states.listening.approved).toBe("take-2");
    const again = readStates(id); again.states.listening!.approved = null; again.states.listening!.approved_by = null; saveStates(id, again);
    expect(readStates(id).states.listening!.approved).toBeNull();
  });

  test("the best take is a usable one with the fewest notes, then the closest colours", () => {
    const takes = [take("take-1"), take("take-2", { report: report({ reasons: [], colour_distance: 70 }) }), take("take-3", { report: report({ reasons: [], colour_distance: 30 }) }), take("take-4", { report: report({ ok: true, reasons: [], bytes: { h264: 0, av1: null } }) }), take("take-5", { report: null })];
    for (const row of takes) if (row.report) row.report.ok = true;
    expect(bestTake(takes)?.id).toBe("take-3");
    expect(takes.map(takeUsable)).toEqual([true, true, true, false, false]);
  });

  test("a finished clip whose engine report says ok: false is still approved and playable; a missing clip is the one failure", async () => {
    const id = companion();
    const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 4, background: "red" } }).png().toBuffer());
    const rest = addVersion(id, png, { source: "generated", label: "Rest", width: 8, height: 8, from: null }); setRest(id, rest.id);
    updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "red fox", species: "fox", colours: ["#CC3322"] }, key: media.key.default, state: "approved", approved_by: "Author", approved_at: new Date().toISOString() });
    __setKeyframesForTests(async () => [png, png, png]);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 0.9 } })));
    const home = join(dataRoot, "companions");
    let writeClip = true;
    __setStackClientForTests({
      mediaRoots: async () => ({ read: [home], write: [home] }), setMediaRoots: async () => ({ read: [home], write: [home] }),
      submitJob: async (job: { input: { output_dir: string; output_name: string } }) => {
        const dir = join(job.input.output_dir, job.input.output_name); mkdirSync(dir, { recursive: true });
        const files: Array<{ name: string; path: string; bytes: number }> = [];
        if (writeClip) { writeFileSync(join(dir, "clip.h264.mp4"), new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])); files.push({ name: "clip.h264.mp4", path: join(dir, "clip.h264.mp4"), bytes: 8 }); }
        writeFileSync(join(dir, "still.png"), png); files.push({ name: "still.png", path: join(dir, "still.png"), bytes: png.length });
        return { id: "finish-1", state: "done", result: { ok: false, reasons: ["The character colours are too far from the colours Home expected. Check the listed colours and make the clip again."], seconds: 2, frames: 48, fps: 24, files, av1: false, loop_gap: 20, colour_distance: 60, area_ratio: 1.02, opaque_share: { min: 0.5, max: 0.55 } } };
      },
      job: async () => { throw new Error("the job was already done"); },
    } as never);
    const made = addTake(id, "listening", { source: "generated", label: "Candidate 1" });
    writeFileSync(takePath(id, "listening", made.id, "source.mp4")!, new Uint8Array([1, 2, 3]));
    await finishTake(id, "listening", made.id, { alpha: false });
    const listening = readStates(id).states.listening!, finished = listening.takes[0]!;
    expect(finished.report).toMatchObject({ ok: true, bytes: { h264: 8, av1: null }, colour_distance: 60, loop_gap: 20 });
    expect(finished.report!.reasons).toEqual(["The character colours are too far from the colours Home expected. Check the listed colours and make the clip again."]);
    expect(finished.failure).toBeNull();
    expect(listening.approved).toBe(made.id);
    expect(listening.approved_by).toBe("automatic");
    expect(existsSync(takePath(id, "listening", made.id, "clip.h264.mp4")!)).toBe(true);
    expect(companionStateJob(id, made.id)?.state).toBe("done");

    writeClip = false;
    const missing = addTake(id, "listening", { source: "generated", label: "Candidate 2" });
    writeFileSync(takePath(id, "listening", missing.id, "source.mp4")!, new Uint8Array([1, 2, 3]));
    await expect(finishTake(id, "listening", missing.id, { alpha: false })).rejects.toThrow(CLIP_MISSING_LINE);
    const after = readStates(id).states.listening!;
    expect(after.takes[1]!.failure).toBe(CLIP_MISSING_LINE);
    expect(after.approved).toBe(made.id);
  });
});
