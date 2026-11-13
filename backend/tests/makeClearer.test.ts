// MAKE-CLEARER-01: one "Make clearer" operation for pictures and one for videos, each with Quick, Better and Best, in the one operations table.
// Quick must measurably do its job (less noise, steeper edges), keep the size, and carry the source's lock state only while the size is unchanged; Best is shown,
// off, with one plain line until the Stack has the AI restore; the video Quick is the Stack's own denoise and sharpen steps.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, settingsValues } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { BEST_NEEDS_DOWNLOAD, __resetImageEditForTests, __setImageToolsForTests, processClearerQuick } from "@/lib/imageEdit";
import { listMediaOps, runMediaOp } from "@/lib/mediaOps/registry";
import { studioOperationRows } from "@/lib/mediaOps/studio";
import { readFileSync } from "node:fs";
import { appPackageProblems } from "@/lib/apps";
import { editVideoArgs } from "@/lib/videos/editTool";
import { QUICK_CLEARER, quickClearerOps } from "@/lib/videos/editPlan";
import { videoClearerLevels } from "@/lib/videos/clearerLevels";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import type { StackImageToolsStatus } from "@/lib/stack/client";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const READY: StackImageToolsStatus = { state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: { upscale_in: 6 }, operations: ["remove_background", "erase", "upscale", "resize"], reason: null };
const W = 400, H = 300;

/** A picture with two soft shapes (edges blurred a little, as a slightly out-of-focus photo has) and, optionally, grain of a known strength. */
async function softPicture(noiseSd: number): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#888"/><rect x="60" y="60" width="140" height="120" fill="#e8e8e8"/><circle cx="290" cy="150" r="70" fill="#222"/></svg>`;
  const { data } = await sharp(Buffer.from(svg)).blur(1.4).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let seed = 7; const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const grain = Buffer.from(data);
  if (noiseSd > 0) for (let i = 0; i < grain.length; i++) grain[i] = Math.max(0, Math.min(255, Math.round(grain[i]! + (next() + next() + next() + next() - 2) * 1.73 * noiseSd)));
  return new Uint8Array(await sharp(grain, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
}
async function grey(png: Uint8Array) { const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; }
/** Noise: the standard deviation of a flat patch of the background. Edge: the steepest step across the circle's left edge (higher is sharper). Laplacian: the variance of the 4-neighbour Laplacian. */
async function measure(png: Uint8Array) {
  const { data, w, h } = await grey(png);
  let sum = 0, sq = 0, count = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const l = data[i - 1]! + data[i + 1]! + data[i - w]! + data[i + w]! - 4 * data[i]!; sum += l; sq += l * l; count++; }
  let mean = 0, patch = 0; for (let y = 5; y < 45; y++) for (let x = 5; x < 45; x++) { mean += data[y * w + x]!; patch++; } mean /= patch;
  let variance = 0; for (let y = 5; y < 45; y++) for (let x = 5; x < 45; x++) variance += (data[y * w + x]! - mean) ** 2;
  let edge = 0; for (let x = 205; x < 225; x++) edge = Math.max(edge, Math.abs(data[150 * w + x + 1]! - data[150 * w + x]!));
  return { laplacian: sq / count - (sum / count) ** 2, noise: Math.sqrt(variance / patch), edge };
}

let sage: TestClient; let sageActor: PersonRow;
function allowPhotos(personId: string) {
  db.insert(settingsValues).values({ scope: `person:${personId}`, key: "chat.photo_uploads", value: "true", hlc: "1:0:test", source: "self", setBy: personId, updatedAt: new Date().toISOString() }).run();
}
async function libraryPicture(bytes: Uint8Array, provenance = "composer:upload") {
  const stored = storeFile(sageActor, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance, retention: "kept", deduplicate: false });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value;
}
const note = (id: string) => JSON.parse(db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance.replace(/^image-edit:/, "")) as Record<string, unknown>;

beforeEach(async () => {
  resetDb(); __resetImageEditForTests();
  __setImageToolsForTests(READY, true);
  __setRoleHealthForTests({ image: { availability: "ready", reason: null } });
  sage = new TestClient();
  const made = await sage.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  sageActor = db.select().from(people).where(eq(people.id, ((await made.json()) as { person: { id: string } }).person.id)).get()!;
  allowPhotos(sageActor.id);
});
afterEach(() => { __setImageToolsForTests(undefined); __setRoleHealthForTests({}); __resetImageEditForTests(); });

describe("Make clearer in the operations table", () => {
  test("pictures and videos each list one Make clearer with Quick, Better and Best, a line and a time for each", async () => {
    const picture = (await listMediaOps(sageActor, { input: "picture" })).find((op) => op.id === "picture.make_clearer")!;
    expect(picture.label).toBe("Make clearer");
    expect(picture.levels!.map((level) => level.label)).toEqual(["Quick", "Better", "Best"]);
    for (const level of picture.levels!) { expect(level.summary.length).toBeGreaterThan(10); expect(level.eta.length).toBeGreaterThan(3); expect(`${level.summary} ${level.eta}`).not.toMatch(/esrgan|seedvr|gfpgan|model|memory|ram/i); }
    const video = (await listMediaOps(sageActor, { input: "video" })).find((op) => op.id === "video.make_clearer")!;
    expect(video.levels!.map((level) => level.label)).toEqual(["Quick", "Better", "Best"]);
  });

  test("Best is shown but off with one plain line until the Stack lists the restore; Quick and Better follow the tools", async () => {
    const off = (await listMediaOps(sageActor, { input: "picture" })).find((op) => op.id === "picture.make_clearer")!;
    expect(off.enabled).toBe(true);
    expect(off.levels!.map((level) => [level.id, level.enabled])).toEqual([["quick", true], ["better", true], ["best", false]]);
    expect(off.levels![2]!.reason).toBe(BEST_NEEDS_DOWNLOAD);
    expect(BEST_NEEDS_DOWNLOAD).toBe("Best quality needs an extra download. An admin can add it in Settings, AI & models.");
    __setImageToolsForTests({ ...READY, operations: [...READY.operations, "restore"] }, true);
    expect((await listMediaOps(sageActor, { input: "picture" })).find((op) => op.id === "picture.make_clearer")!.levels!.map((level) => level.enabled)).toEqual([true, true, true]);
    // The picture Studio's rows carry the levels, so the page draws Best off with its line rather than leaving it out.
    __setImageToolsForTests(READY, true);
    const row = (await studioOperationRows(sageActor, {})).find((entry) => entry.id === "picture.make_clearer") as { levels: Array<{ id: string; enabled: boolean; reason?: string }> };
    expect(row.levels.find((level) => level.id === "best")).toMatchObject({ enabled: false, reason: BEST_NEEDS_DOWNLOAD });
  });

  test("the Stack being away turns Better and Best off but never Quick, which runs in Home", async () => {
    __setImageToolsForTests(null, true);
    const op = (await listMediaOps(sageActor, { input: "picture" })).find((entry) => entry.id === "picture.make_clearer")!;
    expect(op.levels!.map((level) => [level.id, level.enabled])).toEqual([["quick", true], ["better", false], ["best", false]]);
    expect(op.levels![1]!.reason).toMatch(/\s/);
  });

  test("running Best while it is off is refused with the same line, and nothing is saved", async () => {
    const source = await libraryPicture(await softPicture(0));
    const before = db.select().from(attachments).all().length;
    await expect(runMediaOp(sageActor, "picture.make_clearer", { source: { kind: "picture", via: "file", id: source.id }, args: { level: "best" } })).rejects.toMatchObject({ status: 503, message: BEST_NEEDS_DOWNLOAD });
    expect(db.select().from(attachments).all().length).toBe(before);
  });

  test("a level the schema does not know is refused", async () => {
    const source = await libraryPicture(await softPicture(0));
    await expect(runMediaOp(sageActor, "picture.make_clearer", { source: { kind: "picture", via: "file", id: source.id }, args: { level: "ultra" } })).rejects.toMatchObject({ status: 422 });
  });
});

describe("Quick on a picture", () => {
  test("a noisy, slightly soft picture gets less noise and steeper edges at the same size", async () => {
    const noisy = await softPicture(12);
    const before = await measure(noisy);
    const out = await processClearerQuick(noisy, 1);
    expect([out.width, out.height]).toEqual([W, H]);
    const after = await measure(out.png);
    expect(after.noise).toBeLessThan(before.noise * 0.6);
    expect(after.edge).toBeGreaterThan(before.edge * 1.25);
  });

  test("a clean, soft picture gets a higher Laplacian variance (it is sharper)", async () => {
    const soft = await softPicture(0);
    const out = await processClearerQuick(soft, 1);
    expect((await measure(out.png)).laplacian).toBeGreaterThan((await measure(soft)).laplacian * 1.5);
  });

  test("1.5 and 2 times bigger use Lanczos and stay clear; other sizes are refused", async () => {
    const noisy = await softPicture(12);
    const two = await processClearerQuick(noisy, 2);
    expect([two.width, two.height]).toEqual([W * 2, H * 2]);
    const half = await processClearerQuick(noisy, 1.5);
    expect([half.width, half.height]).toEqual([600, 450]);
    await expect(processClearerQuick(noisy, 4)).rejects.toMatchObject({ status: 422 });
  });

  test("a phone photo is turned upright and keeps its upright size", async () => {
    const sideways = new Uint8Array(await sharp(Buffer.from(await softPicture(0))).withMetadata({ orientation: 6 }).jpeg().toBuffer());
    const out = await processClearerQuick(sideways, 1);
    expect([out.width, out.height]).toEqual([H, W]);
  });

  test("over the media-ops route: Quick makes a new version; at the same size an upload's lock state carries, enlarged it does not", async () => {
    const source = await libraryPicture(await softPicture(12));
    const apply = async (args: Record<string, unknown>) => {
      const res = await sage.post("/api/media-ops/picture.make_clearer", { file_id: source.id, args });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { state: string; preview: { token: string; width: number; height: number; operation: string } };
      expect(body.state).toBe("done");
      expect(body.preview.operation).toBe("clearer");
      const applied = await sage.post(`/api/media-ops/previews/${body.preview.token}/apply`, {});
      expect(applied.status).toBe(200);
      return { preview: body.preview, id: ((await applied.json()) as { version: { id: string; label: string } }).version };
    };
    const same = await apply({ level: "quick" });
    expect([same.preview.width, same.preview.height]).toEqual([W, H]);
    expect(note(same.id.id)).toMatchObject({ op: "clearer", lock: "off", source: source.id });
    expect(same.id.label).toBe("Made clearer");
    const bigger = await apply({ level: "quick", size: "2" });
    expect([bigger.preview.width, bigger.preview.height]).toEqual([W * 2, H * 2]);
    expect(note(bigger.id.id).lock).not.toBe("off");
  });

  test("Better is an ordinary upscale at the Stack and never carries the lock state", async () => {
    const source = await libraryPicture(await softPicture(0));
    const op = await import("@/lib/mediaOps/registry");
    // Better asks the Stack's `upscale` for twice the size (a Stack that cannot be reached here answers with its plain line, not a crash).
    const asked: Array<[string, string | null]> = [];
    const { __setStackClientForTests } = await import("@/lib/stackEngine");
    __setStackClientForTests({ imageEdit: async (form: FormData) => { asked.push([String(form.get("operation")), form.get("scale") as string | null]); return { kind: "done", job: "j1", item: { b64_json: Buffer.from(await sharp(Buffer.from(await softPicture(0))).resize(W * 2, H * 2).png().toBuffer()).toString("base64"), width: W * 2, height: H * 2 } }; } } as never);
    const result = await op.runMediaOp(sageActor, "picture.make_clearer", { source: { kind: "picture", via: "file", id: source.id }, args: { level: "better" } });
    expect((result as { file: { state: string } }).file.state).toBe("done");
    expect(asked).toEqual([["upscale", "2"]]);
    __setStackClientForTests(null);
  });
});

describe("Make clearer for videos", () => {
  test("Quick is the Stack's denoise then sharpen steps at the same size, one edit", () => {
    expect(quickClearerOps()).toEqual([{ op: "denoise", amount: QUICK_CLEARER.denoise }, { op: "sharpen", amount: QUICK_CLEARER.sharpen }]);
    expect(QUICK_CLEARER.denoise).toBeGreaterThan(0); expect(QUICK_CLEARER.denoise).toBeLessThanOrEqual(1);
    expect(QUICK_CLEARER.sharpen).toBeGreaterThan(0); expect(QUICK_CLEARER.sharpen).toBeLessThanOrEqual(1.5);
    expect(quickClearerOps().some((step) => step.op === "upscale")).toBe(false);
  });

  test("Best is off with the same plain line while the Stack has no video restore", async () => {
    const levels = await videoClearerLevels(sageActor);
    expect(levels.best.enabled).toBe(false);
    if (levels.quick.enabled) expect(levels.best.reason).toBe(BEST_NEEDS_DOWNLOAD);
  });

  test("the chat tool's upscale takes a clarity; no other change does", () => {
    expect(editVideoArgs.safeParse({ clip: "latest", change: "upscale", clarity: "quick" }).success).toBe(true);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "upscale" }).success).toBe(true);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "upscale", clarity: "ultra" }).success).toBe(false);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "reframe", aspect: "1:1", clarity: "quick" }).success).toBe(false);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "upscale", clarity: "best", amount: 0.5 }).success).toBe(false);
  });
});

describe("the pages that carry Make clearer still pass the UI schema", () => {
  // The video Studio's Make more holds at most 3 entries and the Create feed menu at most 8: a page over a cap is refused as a whole and the Video app disappears.
  for (const id of ["video", "image"]) {
    test(`${id} has no package problems`, () => {
      const dir = `packages/${id}`;
      expect(appPackageProblems(JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")), dir)).toEqual([]);
    });
  }
  test("the video Studio lists Quick and Better in Make more, over the same route the registry operation starts", () => {
    const text = readFileSync("packages/video/pages/studio.json", "utf8");
    expect(text).toContain("/api/plugins/video/actions/clearer");
    expect(text).toContain("Make clearer: Quick");
    expect(text).toContain("Make clearer: Better");
  });
});
