import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { LINES, runLikenessEdit, type EditResult, type LikenessDeps } from "@/lib/pictures/likeness/edit";
import type { Face } from "@/lib/pictures/likeness/faces";

const W = 200, H = 200;
const png = (raw: Uint8Array | Buffer) => sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer().then((b) => new Uint8Array(b));
const gradient = () => { const b = Buffer.alloc(W * H * 3); for (let i = 0; i < W * H; i++) { b[i * 3] = (i % W) & 255; b[i * 3 + 1] = (i / W) & 255; b[i * 3 + 2] = 90; } return b; };
const face = (w: number): Face => ({ bbox: [60, 40, w, w], rightEye: [80, 60], leftEye: [120, 60], nose: [100, 80], rightMouth: [85, 100], leftMouth: [115, 100], score: 0.9 });
const rect = (x0: number, y0: number, x1: number, y1: number) => { const m = new Uint8Array(W * H); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 255; return m; };
const pic = { b64_json: "", content_type: "image/png" } as unknown as EditResult["pic"];

async function rig(opts: { faces?: Face[]; touchFace?: boolean; changeBody?: boolean; cosine?: number }) {
  const base = gradient();
  const source = await png(base);
  const changed = Buffer.from(base);
  if (opts.changeBody) for (let i = 0; i < W * H; i++) if (!(i % W >= 55 && i % W < 145 && Math.floor(i / W) < 125)) { changed[i * 3] = 255 - changed[i * 3]!; changed[i * 3 + 1] = 0; }
  if (opts.touchFace) for (let y = 40; y < 120; y++) for (let x = 60; x < 140; x++) { const k = (y * W + x) * 3; changed[k] = (x * 37 + y * 91) & 255; changed[k + 1] = (x * 11 + y * 53) & 255; }
  const result = await png(changed);
  const calls: { kind: string; feather?: number; prompt: string; mask?: Uint8Array }[] = [];
  const cos = opts.cosine ?? 0.95;
  const deps: LikenessDeps = {
    ensureAssets: async () => {},
    detect: async () => ({ ok: true, value: opts.faces ?? [face(80)] }),
    embed: async (img) => ({ ok: true, value: img === source ? new Float32Array([1, 0]) : new Float32Array([cos, Math.sqrt(1 - cos * cos)]) }),
    silhouette: async () => rect(40, 30, 160, 200),
    head: async () => rect(60, 40, 140, 120),
    seed: () => 7,
    edit: async (_i, prompt) => { calls.push({ kind: "edit", prompt }); return { pic, bytes: result }; },
    editMasked: async (_i, mask, _w, _h, prompt, feather) => { calls.push({ kind: "masked", feather, prompt, mask }); return { pic, bytes: result }; },
  };
  return { deps, source, calls };
}
const run = (r: Awaited<ReturnType<typeof rig>>, scope: "clothes" | "background" | "face" | "whole", signal = new AbortController().signal) =>
  runLikenessEdit({ source: r.source, prompt: "astronaut suits", scope, signal, progress: () => {} }, r.deps);

describe("likeness edit pipeline", () => {
  test("no usable face falls back to today's path with nothing said", async () => {
    expect(await run(await rig({ faces: [] }), "clothes")).toBeNull();
    expect(await run(await rig({ faces: [face(50)] }), "background")).toBeNull();
  });
  test("background sends the background mask, feather 3 and the keep-the-person suffix", async () => {
    const r = await rig({}); const out = await run(r, "background");
    expect(out?.note).toBe(LINES.kept);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.feather).toBe(3);
    expect(r.calls[0]!.prompt).toContain("Keep every person exactly the same");
    expect(r.calls[0]!.mask![100 * W + 100]).toBe(0);   // inside the person
    expect(r.calls[0]!.mask![5 * W + 5]).toBe(255);      // behind them
  });
  test("a face that changed fails the guard, retries once, then hands back nothing", async () => {
    const r = await rig({ touchFace: true });
    await expect(run(r, "background")).rejects.toThrow(LINES.guard);
    expect(r.calls).toHaveLength(2);
  });
  test("clothes: person under the coverage bar gets capped per-person retries and a plain note", async () => {
    const r = await rig({});   // the fake never changes the clothes
    const out = await run(r, "clothes");
    expect(r.calls).toHaveLength(3);                     // one pass, two retries for the one person
    expect(r.calls[0]!.feather).toBe(4);
    expect(r.calls[0]!.mask![100 * W + 100]).toBe(0);    // head is protected
    expect(r.calls[0]!.mask![150 * W + 100]).toBe(255);  // body is editable
    expect(out?.note).toBe(LINES.clothes(1));
  });
  test("clothes that changed enough say the faces are as they were", async () => {
    const r = await rig({ changeBody: true });
    r.deps.silhouette = async () => rect(0, 30, 200, 200);
    expect((await run(r, "clothes"))?.note).toBe(LINES.kept);
    expect(r.calls).toHaveLength(1);
  });
  test("a smile on a small face is refused", async () => {
    await expect(run(await rig({ faces: [face(70)] }), "face")).rejects.toThrow(LINES.small);
  });
  test("a smile that changes who they look like uses three seeds then fails", async () => {
    const r = await rig({ cosine: 0.5 });
    await expect(run(r, "face")).rejects.toThrow(LINES.smile);
    expect(r.calls).toHaveLength(3);
  });
  test("a smile with the same person is kept", async () => {
    const r = await rig({ cosine: 0.9 });
    expect((await run(r, "face"))?.note).toBe(LINES.kept);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.feather).toBe(6);
  });
  test("whole adds the note below 0.85 and never blocks", async () => {
    const low = await run(await rig({ cosine: 0.7 }), "whole");
    expect(low?.note).toBe(LINES.whole);
    expect((await run(await rig({ cosine: 0.9 }), "whole"))?.note).toBeUndefined();
  });
  test("pressing Stop between calls ends the edit", async () => {
    const c = new AbortController(); c.abort();
    await expect(run(await rig({}), "background", c.signal)).rejects.toThrow();
  });
  test("face models that cannot load fall back", async () => {
    const r = await rig({}); r.deps.ensureAssets = async () => { throw new Error("offline"); };
    expect(await run(r, "clothes")).toBeNull();
  });
});
