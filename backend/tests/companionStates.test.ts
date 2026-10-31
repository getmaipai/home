import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifestOnly } from "@/lib/plugins";
import { createHouseholdCompanion } from "@/lib/householdCompanions";
import { addTake, bestTake, deleteStates, deleteTake, readStates, saveStates, setMotion, takePath, __resetCompanionStatesForTests, finishTake, swapInAnimation, keyframePath, keyframeMetaPath, readKeyframeMeta, writeKeyframe, meanOpaqueColourDistance } from "@/lib/companionStates";
import sharp from "sharp";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { addVersion, approveSheet, setRest, updateSheet } from "@/lib/companionLook";
import media from "@maipai/spec/vocab/companion-media.json";
import { takePrompt } from "@/lib/companionTakes";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";

const dataRoot = process.env.MAIPAI_DATA_DIR!;
const root = join(dataRoot, "companions");
const source = loadManifestOnly("rivet");
if (!source.ok || !source.value.companion) throw new Error("rivet fixture is unavailable");
const sourceCompanion = source.value.companion;

beforeEach(() => { rmSync(root, { recursive: true, force: true }); __resetCompanionStatesForTests(); });
afterEach(() => {
  __setKeyframesForTests(null); rmSync(root, { recursive: true, force: true }); __resetCompanionStatesForTests(); __setStackClientForTests(null); });

function companion() { const result = createHouseholdCompanion({ ...sourceCompanion, display_name: "State fixture" }, { display_name: "Author", person_id: "state-test" }); if (!result.ok) throw new Error(result.error); return result.value.id; }

describe("companion states store", () => {
  test("stores a keyframe and metadata atomically in its state folder", () => {
    const id = companion(), bytes = new Uint8Array([1, 2, 3]), now = new Date().toISOString();
    writeKeyframe(id, "thinking", bytes, { source: "upload", style: "cartoon", prompt_hash: "a".repeat(64), model: null, created_at: now, edited_at: now });
    expect(readFileSync(keyframePath(id, "thinking"))).toEqual(Buffer.from(bytes));
    expect(readKeyframeMeta(id, "thinking")).toMatchObject({ source: "upload", style: "cartoon", prompt_hash: "a".repeat(64), created_at: now, edited_at: now });
    expect(keyframeMetaPath(id, "thinking")).toContain("keyframe.json");
  });

  test("measures opaque frame colour and detects a frame zero mismatch", async () => {
    const frame = async (colour: { r: number; g: number; b: number; alpha: number }) => new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 4, background: colour } }).png().toBuffer());
    const same = await frame({ r: 200, g: 40, b: 20, alpha: 1 }), shifted = await frame({ r: 20, g: 210, b: 240, alpha: 1 });
    expect(await meanOpaqueColourDistance(same, same)).toBeLessThan(1);
    expect(await meanOpaqueColourDistance(same, shifted)).toBeGreaterThan(24);
  });

  test("builds the take prompt and uses the vocabulary's generation size", () => {
    expect(takePrompt({ text: "A red fox." }, "waves once", "magenta")).toBe("Static shot, the camera never moves. A red fox.. The character stays exactly this size and in exactly this place in the frame, whole body always visible from head to feet, the same picture in every frame. The character keeps the same face, the same colours and the same flat drawn style in every frame, with a calm closed-mouth smile. Plain solid magenta background with nothing on it; the character floats on it with nothing under it. Action: waves once. One single smooth motion from start to end, one prop only.");
    expect(media.generate.width).toBeGreaterThan(0); expect(media.generate.height).toBeGreaterThan(0); expect(media.generate.seconds).toBeGreaterThan(0);
  });
  test("only vocabulary states are accepted, and the state is persisted", () => {
    const id = companion();
    const take = addTake(id, "idle", { source: "upload", label: "first" });
    expect(take.id).toBe("take-1");
    expect(readStates(id).states.idle?.takes).toHaveLength(1);
    expect(() => addTake(id, "../../look", { source: "upload", label: "bad" })).toThrow("Choose one of the listed companion states.");
    expect(() => setMotion(id, "dancing", "spin")).toThrow("Choose one of the listed companion states.");
    expect(addTake(id, "needs_you", { source: "upload", label: "legacy" }).id).toBe("take-1");
  });

  test("migrates an approved celebrate take to done once and leaves celebrate intact", () => {
    const id = companion(), take = addTake(id, "celebrate", { source: "upload", label: "celebrate" }), all = readStates(id);
    const report = { ok: true, reasons: [], seconds: 3, bytes: { h264: 10, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 } };
    all.states.celebrate!.takes[0]!.report = report; all.states.celebrate!.approved = take.id; all.states.celebrate!.approved_by = "Author"; all.states.celebrate!.approved_at = new Date().toISOString(); saveStates(id, all);
    const first = readStates(id), done = first.states.done!;
    expect(done.approved).toBe("take-1"); expect(done.takes[0]).toMatchObject({ report, source: "upload" });
    expect(first.states.celebrate?.approved).toBe(take.id); expect(first.states.celebrate?.takes).toHaveLength(1);
    expect(readStates(id).states.done?.takes).toHaveLength(1);
  });

  test("limits a state to twelve takes and removes a deleted take folder", () => {
    const id = companion();
    for (let i = 0; i < 12; i++) addTake(id, "idle", { source: "upload", label: `take ${i}` });
    expect(() => addTake(id, "idle", { source: "upload", label: "too many" })).toThrow("Delete some of this state's other takes first.");
    const path = takePath(id, "idle", "take-12", "source.mp4")!;
    expect(deleteTake(id, "idle", "take-12")).toBe(true);
    expect(readStates(id).states.idle?.takes).toHaveLength(11);
    expect(path.includes("take-12")).toBe(true);
    expect(addTake(id, "idle", { source: "upload", label: "next" }).id).toBe("take-13");
  });

  test("takes paths are allow-listed and approved takes cannot be deleted", () => {
    const id = companion(), take = addTake(id, "idle", { source: "upload", label: "clip" });
    expect(takePath(id, "idle", take.id, "still.png")).toContain("finished");
    expect(takePath(id, "idle", take.id, "../../manifest.json")).toBeNull();
    const all = readStates(id); all.states.idle!.approved = take.id;
    writeFileSync(join(root, id, "states", "states.json"), JSON.stringify(all));
    expect(() => deleteTake(id, "idle", take.id)).toThrow("That clip is approved. Remove the approval first.");
  });

  test("best take prefers passing reports, then colour distance, then area", () => {
    const id = companion();
    const takes = [1, 2, 3, 4].map((i) => addTake(id, "idle", { source: "upload", label: `${i}` }));
    const report = (ok: boolean, colour_distance: number | null, area_ratio: number) => ({ ok, reasons: [], seconds: 3, bytes: { h264: 100, av1: null }, colour_distance, area_ratio, loop_gap: 0, opaque_share: { min: 0.5, max: 0.8 } });
    takes[0]!.report = report(false, 0.1, 1);
    takes[1]!.report = report(true, 3, 1.1);
    takes[2]!.report = report(true, 2, 1.2);
    takes[3]!.report = report(true, 2, 0.9);
    expect(bestTake(takes)?.id).toBe(takes[3]!.id);
    expect(bestTake([takes[0]!])).toBeNull();
    takes[2]!.report = report(true, null, 0.7);
    expect(bestTake([takes[1]!, takes[2]!])?.id).toBe(takes[1]!.id); // a missing distance counts as 999
  });

  test("motion can return to the vocabulary default and companion states can be removed", () => {
    const id = companion(); setMotion(id, "idle", "swings its tail");
    expect(readStates(id).states.idle?.motion).toBe("swings its tail");
    setMotion(id, "idle", null); expect(readStates(id).states.idle?.motion).toBeNull();
    addTake(id, "idle", { source: "upload", label: "clip" }); deleteStates(id);
    expect(readStates(id).states).toEqual({});
  });

  test("recovers an interrupted animation swap and removes completed swap leftovers", async () => {
    const { recoverAppearanceSwap } = await import("@/lib/companionStates"), id = companion(), dir = join(root, id);
    mkdirSync(join(dir, "animation.prev"), { recursive: true }); writeFileSync(join(dir, "animation.prev", "old"), "old");
    recoverAppearanceSwap(dir); expect(existsSync(join(dir, "animation", "old"))).toBe(true);
    mkdirSync(join(dir, "animation.next"), { recursive: true }); recoverAppearanceSwap(dir);
    expect(existsSync(join(dir, "animation"))).toBe(true); expect(existsSync(join(dir, "animation.next"))).toBe(false);
  });

  test("declares the companion media root once, preserves other roots, and retries a failed put", async () => {
    const { ensureCompanionMediaRoot } = await import("@/lib/companionStates");
    const expected = join(dataRoot, "companions"); let reads = 0, writes = 0; let fail = true;
    __setStackClientForTests({ mediaRoots: async () => { reads++; return { read: ["/other/read"], write: ["/other/write"] }; }, setMediaRoots: async (roots: { read: string[]; write: string[] }) => { writes++; expect(roots.read).toContain("/other/read"); expect(roots.write).toContain("/other/write"); expect(roots.read).toContain(expected); expect(roots.write).toContain(expected); if (fail) throw Error("offline"); return roots; } } as never);
    expect((await ensureCompanionMediaRoot()).ok).toBe(false); fail = false;
    expect(await ensureCompanionMediaRoot()).toEqual({ ok: true }); expect(await ensureCompanionMediaRoot()).toEqual({ ok: true });
    expect(reads).toBe(2); expect(writes).toBe(2);
  });

  test("finishes a clip through Stack with the state vocabulary and stores its report", async () => {
    __setKeyframesForTests(async () => [new Uint8Array([7])]);
    const { finishTake } = await import("@/lib/companionStates"), id = companion();
    const rest = addVersion(id, new Uint8Array([1]), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id);
    updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "red fox", species: "fox", colours: ["#CC3322"] }, key: "#FF00FF", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    const take = addTake(id, "idle", { source: "upload", label: "idle" }); writeFileSync(takePath(id, "idle", take.id, "source.mp4")!, "source");
    let submitted: any; let roots = 0;
    __setStackClientForTests({ mediaRoots: async () => ({ read: [join(dataRoot, "companions")], write: [join(dataRoot, "companions")] }), setMediaRoots: async () => { roots++; return { read: [], write: [] }; }, submitJob: async (job: any) => { submitted = job; const out = join(job.input.output_dir, job.input.output_name); mkdirSync(out, { recursive: true }); writeFileSync(join(out, "clip.h264.mp4"), "h264"); writeFileSync(join(out, "still.png"), "png"); return { id: "job-1", state: "done", result: { ok: true, reasons: [], seconds: 3, files: [{ name: "clip.h264.mp4", bytes: 123 }], av1: false, colour_distance: 2, area_ratio: 1, loop_gap: 0, opaque_share: { min: .5, max: .8 }, colour_match: { applied: true, strength: .35 }, settle_skipped_frames: 16 } }; }, job: async () => { throw Error("unexpected poll"); } } as never);
    await finishTake(id, "idle", take.id, { alpha: false });
    expect(submitted.kind).toBe("media.companion_clip"); expect(submitted.input).toMatchObject({ output_dir: join(dataRoot, "companions", id, "states", "idle", take.id), output_name: "finished", key: "#FF00FF", kind: "loop", min_seconds: media.states[0]!.min_seconds, max_seconds: media.states[0]!.max_seconds, colours: ["#CC3322"], palette_reference: Buffer.from([1]).toString("base64"), max_bytes: media.ship.max_bytes_per_clip });
    expect(readStates(id).states.idle?.takes[0]?.report).toMatchObject({ ok: true, seconds: 3, bytes: { h264: 123 }, colour_match: { applied: true, strength: .35 }, settle_skipped_frames: 16 }); expect(roots).toBe(0);
    expect(readStates(id).states.idle).toMatchObject({ approved: take.id, approved_by: "automatic" });
  });

  test("omits a missing rest picture palette reference", async () => {
    __setKeyframesForTests(async () => [new Uint8Array([7])]);
    const id = companion(), rest = addVersion(id, new Uint8Array([1]), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id);
    updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    const take = addTake(id, "idle", { source: "upload", label: "idle" }); writeFileSync(takePath(id, "idle", take.id, "source.mp4")!, "source"); rmSync(join(root, id, "look", `${rest.id}.png`));
    let submitted: any;
    __setStackClientForTests({ mediaRoots: async () => ({ read: [root], write: [root] }), setMediaRoots: async () => ({ read: [root], write: [root] }), submitJob: async (job: any) => { submitted = job; const out = join(job.input.output_dir, job.input.output_name); mkdirSync(out, { recursive: true }); writeFileSync(join(out, "clip.h264.mp4"), "h264"); writeFileSync(join(out, "still.png"), "png"); return { id: "job-no-palette", state: "done", result: { ok: true, reasons: [], seconds: 3, files: [{ name: "clip.h264.mp4", bytes: 123 }], av1: false } }; } } as never);
    await finishTake(id, "idle", take.id, { alpha: false });
    expect(submitted.input).not.toHaveProperty("palette_reference");
  });

  test("finish requires an approved sheet and keeps the Stack failure message on the take", async () => {
    const id = companion(), take = addTake(id, "thinking", { source: "upload", label: "thinking" });
    writeFileSync(takePath(id, "thinking", take.id, "source.mp4")!, "source");
    const { readLook } = await import("@/lib/companionLook");
    expect(readLook(id).sheet).toBeNull();
    await expect(finishTake(id, "thinking", take.id, { alpha: false })).rejects.toMatchObject({ status: 409, message: "Approve the character sheet first, so every clip starts from the same character." });
    const rest = addVersion(id, new Uint8Array([1]), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(id, rest.id);
    updateSheet(id, { views: { left: null, right: null, mouth: null }, card: { text: "fox", species: "fox", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null }); approveSheet(id, "Author");
    __setStackClientForTests({ mediaRoots: async () => ({ read: [root], write: [root] }), setMediaRoots: async () => ({ read: [root], write: [root] }), submitJob: async (request: any) => { expect(request.input.key).toBe("none"); return { id: "failed-job", state: "failed", code: "too_short", message: "The clip is too short. Use a longer video." }; } } as never);
    await expect(finishTake(id, "thinking", take.id, { alpha: true })).rejects.toThrow("too_short: The clip is too short. Use a longer video.");
    expect(readStates(id).states.thinking?.takes[0]?.failure).toContain("The clip is too short. Use a longer video.");
    expect(readStates(id).states.thinking?.takes[0]?.report).toBeNull();
  });
});

describe("swapInAnimation", () => {
  const folder = () => join(dataRoot, "swap-test");
  beforeEach(() => { rmSync(folder(), { recursive: true, force: true }); mkdirSync(join(folder(), "animation.next"), { recursive: true }); writeFileSync(join(folder(), "animation.next", "marker"), "new"); });
  afterEach(() => rmSync(folder(), { recursive: true, force: true }));
  test("puts the new folder live and drops the old one once the commit succeeds", () => {
    mkdirSync(join(folder(), "animation"), { recursive: true }); writeFileSync(join(folder(), "animation", "marker"), "old");
    swapInAnimation(folder(), () => {});
    expect(readFileSync(join(folder(), "animation", "marker"), "utf8")).toBe("new"); expect(existsSync(join(folder(), "animation.prev"))).toBe(false); expect(existsSync(join(folder(), "animation.next"))).toBe(false);
  });
  test("a failed commit puts the old folder back and leaves nothing behind", () => {
    mkdirSync(join(folder(), "animation"), { recursive: true }); writeFileSync(join(folder(), "animation", "marker"), "old");
    expect(() => swapInAnimation(folder(), () => { throw new Error("manifest write failed"); })).toThrow("manifest write failed");
    expect(readFileSync(join(folder(), "animation", "marker"), "utf8")).toBe("old"); expect(existsSync(join(folder(), "animation.prev"))).toBe(false);
  });
  test("startup recovery keeps the folder the manifest describes", async () => {
    const { recoverAppearanceSwap } = await import("@/lib/companionStates");
    mkdirSync(join(folder(), "animation"), { recursive: true }); writeFileSync(join(folder(), "animation", "new.png"), "n");
    mkdirSync(join(folder(), "animation.prev"), { recursive: true }); writeFileSync(join(folder(), "animation.prev", "old.png"), "o");
    recoverAppearanceSwap(folder(), ["old.png"]);
    expect(existsSync(join(folder(), "animation", "old.png"))).toBe(true); expect(existsSync(join(folder(), "animation.prev"))).toBe(false);
    mkdirSync(join(folder(), "animation.prev"), { recursive: true }); writeFileSync(join(folder(), "animation.prev", "older.png"), "x");
    recoverAppearanceSwap(folder(), ["old.png"]);
    expect(existsSync(join(folder(), "animation", "old.png"))).toBe(true); expect(existsSync(join(folder(), "animation.prev"))).toBe(false);
  });
  test("a failed first publish leaves no live folder", () => {
    expect(() => swapInAnimation(folder(), () => { throw new Error("manifest write failed"); })).toThrow();
    expect(existsSync(join(folder(), "animation"))).toBe(false);
  });
});
