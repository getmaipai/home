import sharp from "sharp";
import { Buffer } from "node:buffer";
import { ensureVisionAssets } from "@/lib/visionAssets";
import { detectFaces, embedFace, faceCosine, type Face, type FaceResult } from "./faces";
import { coverage, faceUntouched, matchFaces, smallFace } from "./guard";
import { backgroundMask, encodeMask, headMask, outfitMask, personSilhouette, smileMask, union } from "./masks";
import { submitEdit, waitPicture, cancelOrDelete, type StackPic } from "../stack";

/** LIKENESS-01 constants, from the 2026-11-07 bench on synthetic and real photos (see docs/dev.md "Likeness-safe picture edits"). */
export const LIKENESS = {
  facePx: 60, smilePx: 80, untouchedSsim: 0.99, smileCosine: 0.8, wholeCosine: 0.85,
  outfitFeather: 4, backgroundFeather: 3, smileFeather: 6,
  coverage: 0.55, changedLevel: 20, personTries: 2, smileSeeds: 3, guardRetries: 1,
} as const;

export const LINES = {
  kept: "The faces are exactly as they were.",
  guard: "I couldn't change that without redrawing a face, so I left the picture as it was.",
  small: "That face is too small in the picture to change safely.",
  smile: "I couldn't make that change without changing who they look like.",
  assets: "I couldn't check the faces on this one, so they may look slightly different.",
  whole: "Their faces may look slightly different from the original.",
  /** MAKE-CLEARER-2026-11-13: the Best level of Make clearer is generative and redraws faces; these two lines keep its result out (the Better level does not redraw). */
  restoredFace: "The Best level changed how a face looks, so I kept your picture as it was. Try the Better level.",
  restoredUnchecked: "I couldn't check the faces on this one, so I kept your picture as it was. Try the Better level.",
  clothes: (n: number) => `${n === 1 ? "One person's clothes" : `${n} people's clothes`} did not change. You can try again or name them.`,
} as const;

export type LikenessScope = "clothes" | "background" | "face" | "whole";
export type EditResult = { pic: StackPic; bytes: Uint8Array };
export type LikenessResult = { pic: StackPic; bytes: Uint8Array; note?: string };

/** Everything outside the pipeline's own logic, so tests can replace it. */
export interface LikenessDeps {
  ensureAssets(): Promise<void>;
  detect(png: Uint8Array): Promise<FaceResult<Face[]>>;
  embed(png: Uint8Array, face: Face): Promise<FaceResult<Float32Array>>;
  silhouette(png: Uint8Array, face: Face, others: Face[]): Promise<Uint8Array>;
  head(png: Uint8Array, face: Face): Promise<Uint8Array>;
  /** One whole-picture edit. */
  edit(png: Uint8Array, prompt: string, seed: number, signal: AbortSignal): Promise<EditResult>;
  /** One edit inside a mask (255 = may change); the Stack feathers and composites. */
  editMasked(png: Uint8Array, mask: Uint8Array, width: number, height: number, prompt: string, feather: number, seed: number, signal: AbortSignal): Promise<EditResult>;
  seed(): number;
}

async function waitFor(job: string, signal: AbortSignal): Promise<EditResult> {
  try { return await waitPicture(job, signal); } catch (error) { void cancelOrDelete(job); throw error; }
}

const BUSY = /busy|something larger|stopped answering|no_memory|not ready|unreachable/i;
/** The Stack is shared with chat and video: when it is busy or restarting, wait and try again, never show that raw. */
export async function whenFree<T>(run: () => Promise<T>, waitMs = 15_000, tries = 8): Promise<T> {
  for (let i = 0; ; i += 1) {
    try { return await run(); } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const code = (error as { code?: string }).code ?? "";
      if (i >= tries || error instanceof DOMException || !(BUSY.test(message) || BUSY.test(code))) throw error;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

const rawDeps: LikenessDeps = {
  ensureAssets: async () => { await ensureVisionAssets(); },
  detect: detectFaces, embed: embedFace, silhouette: personSilhouette, head: headMask,
  seed: () => Math.floor(Math.random() * 2 ** 31),
  async edit(png, prompt, seed, signal) {
    const form = new FormData();
    form.set("operation", "edit"); form.set("image", new Blob([png], { type: "image/png" }), "picture.png");
    form.set("instruction", prompt); form.set("seed", String(seed)); form.set("timeout_ms", "1");
    return waitFor((await submitEdit(form)).job, signal);
  },
  async editMasked(png, mask, width, height, prompt, feather, seed, signal) {
    const form = new FormData();
    form.set("operation", "edit_masked"); form.set("image", new Blob([png], { type: "image/png" }), "picture.png");
    form.set("mask", new Blob([await encodeMask(mask, width, height)], { type: "image/png" }), "mask.png");
    form.set("instruction", prompt); form.set("feather", String(feather)); form.set("seed", String(seed)); form.set("timeout_ms", "1");
    return waitFor((await submitEdit(form)).job, signal);
  },
};

function check(signal: AbortSignal): void { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); }
async function rgba(png: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp(png).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer());
}
async function gray(png: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp(png).resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer());
}
function pngBytes(b: Buffer): Uint8Array { return new Uint8Array(b); }
/** The result at the source size, as PNG (the Stack may return another size). */
async function atSourceSize(result: EditResult, width: number, height: number): Promise<EditResult> {
  const meta = await sharp(result.bytes).metadata();
  if (meta.width === width && meta.height === height) return result;
  const bytes = pngBytes(await sharp(result.bytes).resize(width, height, { fit: "fill" }).png().toBuffer());
  return { pic: { ...result.pic, b64_json: Buffer.from(bytes).toString("base64") }, bytes };
}

/** True when every protected face is found again and its pixels are untouched. */
async function facesUntouched(deps: LikenessDeps, source: Uint8Array, result: Uint8Array, faces: Face[], width: number, height: number, keep?: Uint8Array): Promise<boolean> {
  const found = await deps.detect(result);
  if (!found.ok) return false;
  const [a, b] = await Promise.all([gray(source, width, height), gray(result, width, height)]);
  // Only the head is judged: a face box also holds corners of a neighbour's shoulder or hair that the edit may legitimately change.
  if (keep) for (let i = 0; i < keep.length; i += 1) if (keep[i]! < 128) { a[i] = 0; b[i] = 0; }
  return matchFaces(faces, found.value).every((m) => m.kind === "matched" && faceUntouched(a, b, m.source, width, height) >= LIKENESS.untouchedSsim);
}

async function similarity(deps: LikenessDeps, source: Uint8Array, result: Uint8Array, face: Face, outFaces: Face[]): Promise<number> {
  const match = matchFaces([face], outFaces)[0];
  if (!match || match.kind !== "matched") return 0;
  const out = outFaces.find((f) => f.bbox === match.output.bbox) ?? outFaces[0];
  if (!out) return 0;
  const [a, b] = await Promise.all([deps.embed(source, face), deps.embed(result, out)]);
  return a.ok && b.ok ? faceCosine(a.value, b.value) : 0;
}

export const realDeps: LikenessDeps = {
  ...rawDeps,
  silhouette: (...a) => whenFree(() => rawDeps.silhouette(...a)),
  head: (...a) => whenFree(() => rawDeps.head(...a)),
  edit: (...a) => whenFree(() => rawDeps.edit(...a)),
  editMasked: (...a) => whenFree(() => rawDeps.editMasked(...a)),
};

/** Throws a plain sentence; returns the finished picture and its one-line note. Never hands over a picture that failed a guard. */
export async function runLikenessEdit(
  input: { source: Uint8Array; prompt: string; scope: LikenessScope; signal: AbortSignal; progress: (phase: string, percent: number) => void },
  deps: LikenessDeps = realDeps,
): Promise<LikenessResult | null> {
  const { source, prompt, scope, signal, progress } = input;
  try { await deps.ensureAssets(); } catch { return null; }
  const detected = await deps.detect(source);
  if (!detected.ok) return null;
  const faces = detected.value.filter((f) => !smallFace(f).under60);
  if (!faces.length) return null; // nothing to protect: today's path, no extra words
  const { width, height } = await sharp(source).metadata().then((m) => ({ width: m.width ?? 0, height: m.height ?? 0 }));
  if (!width || !height) return null;

  if (scope === "whole") {
    progress("changing the picture", 40); check(signal);
    const made = await atSourceSize(await deps.edit(source, prompt, deps.seed(), signal), width, height);
    progress("checking the faces", 85);
    const found = await deps.detect(made.bytes);
    let worst = 1;
    if (found.ok) for (const f of faces) worst = Math.min(worst, await similarity(deps, source, made.bytes, f, found.value));
    else worst = 0;
    return { ...made, note: worst < LIKENESS.wholeCosine ? LINES.whole : undefined };
  }

  if (scope === "face") {
    if (faces.some((f) => smallFace(f).refuseSmile)) throw new Error(LINES.small);
    progress("finding the faces", 15);
    const mask = await smileMask(faces, width, height);
    let best: { made: EditResult; score: number } | null = null;
    for (let i = 0; i < LIKENESS.smileSeeds; i += 1) {
      check(signal); progress("changing the face", 30 + i * 18);
      const made = await atSourceSize(await deps.editMasked(source, mask, width, height, `${prompt}. Keep the same face, identity, hairstyle, clothes, pose and background exactly the same.`, LIKENESS.smileFeather, deps.seed(), signal), width, height);
      const found = await deps.detect(made.bytes);
      if (!found.ok) continue;
      let score = 1;
      for (const f of faces) score = Math.min(score, await similarity(deps, source, made.bytes, f, found.value));
      if (!best || score > best.score) best = { made, score };
      if (score >= LIKENESS.smileCosine) break;
    }
    if (!best || best.score < LIKENESS.smileCosine) throw new Error(LINES.smile);
    return { ...best.made, note: LINES.kept };
  }

  progress("finding the people", 10); check(signal);
  const heads = await Promise.all(faces.map((f) => deps.head(source, f)));
  progress("outlining them", 25); check(signal);
  const sils = await Promise.all(faces.map((f, i) => deps.silhouette(source, f, faces.filter((_, j) => j !== i))));
  const head = union(...heads), silhouette = union(...sils);
  const clothes = scope === "clothes";
  const mask = clothes ? await outfitMask(silhouette, head, width, height) : await backgroundMask(silhouette, head, width, height);
  const suffix = clothes ? "Only the clothing changes; keep every face, hairstyle, expression and pose exactly the same." : "Keep every person exactly the same: face, hair, clothes and pose.";
  const featherPx = clothes ? LIKENESS.outfitFeather : LIKENESS.backgroundFeather;

  let made: EditResult | null = null;
  for (let attempt = 0; attempt <= LIKENESS.guardRetries; attempt += 1) {
    check(signal); progress(clothes ? "changing the clothes" : "changing the background", 45 + attempt * 10);
    const candidate = await atSourceSize(await deps.editMasked(source, mask, width, height, `${prompt}. ${suffix}`, featherPx, deps.seed(), signal), width, height);
    progress("checking the faces", 80);
    if (await facesUntouched(deps, source, candidate.bytes, faces, width, height, head)) { made = candidate; break; }
  }
  if (!made) throw new Error(LINES.guard);

  let missed = 0;
  if (clothes) {
    const src = await rgba(source, width, height);
    for (let i = 0; i < faces.length; i += 1) {
      const region = await outfitMask(sils[i]!, head, width, height);
      let best = coverage(src, await rgba(made.bytes, width, height), region);
      for (let t = 0; t < LIKENESS.personTries && best < LIKENESS.coverage; t += 1) {
        check(signal); progress("changing the clothes", 85);
        const retry = await atSourceSize(await deps.editMasked(made.bytes, region, width, height, `${prompt}. Change the clothing of this person. ${suffix}`, featherPx, deps.seed(), signal), width, height);
        if (!(await facesUntouched(deps, source, retry.bytes, faces, width, height, head))) continue;
        const c = coverage(src, await rgba(retry.bytes, width, height), region);
        if (c > best) { best = c; made = retry; }
      }
      if (best < LIKENESS.coverage) missed += 1;
    }
  }
  return { ...made, note: missed ? LINES.clothes(missed) : LINES.kept };
}

/**
 * MAKE-CLEARER-2026-11-13: the face guard for the Best level of Make clearer (SeedVR2 restores generatively and can shift a face).
 * The same check and the same measured bar as a face edit (LIKENESS.smileCosine, the 2026-11-07 bench): every face of 60 px or more in the source
 * must be found again in the result with a face match of at least that. No such face (or the face models absent from a picture with no face) means
 * there is nothing to protect and nothing is said. A face that cannot be compared (the models fail on the picture) is not waved through.
 * Returns the sentence to show when the result must be kept out, or null when it may be kept.
 */
/** The suite swaps in scripted face models; null puts the real ones back. */
let depsOverride: LikenessDeps | null = null;
export function __setLikenessDepsForTests(deps: LikenessDeps | null): void { depsOverride = deps; }
export async function restoredFacesRefusal(source: Uint8Array, restored: Uint8Array, deps: LikenessDeps = depsOverride ?? realDeps): Promise<string | null> {
  try { await deps.ensureAssets(); } catch { return null; } // no face models on this home: the same ordinary path as every other edit
  const detected = await deps.detect(source);
  if (!detected.ok) return null;
  const faces = detected.value.filter((f) => !smallFace(f).under60);
  if (!faces.length) return null;
  const { width, height } = await sharp(source).metadata().then((m) => ({ width: m.width ?? 0, height: m.height ?? 0 }));
  if (!width || !height) return LINES.restoredUnchecked;
  const same = (await atSourceSize({ pic: { b64_json: "" } as StackPic, bytes: restored }, width, height)).bytes;
  const found = await deps.detect(same);
  if (!found.ok) return LINES.restoredUnchecked;
  for (const face of faces) {
    const match = matchFaces([face], found.value)[0];
    if (!match || match.kind !== "matched") return LINES.restoredFace;
    const out = found.value.find((f) => f.bbox === match.output.bbox) ?? found.value[0];
    if (!out) return LINES.restoredFace;
    const [a, b] = await Promise.all([deps.embed(source, face), deps.embed(same, out)]);
    if (!a.ok || !b.ok) return LINES.restoredUnchecked;
    if (faceCosine(a.value, b.value) < LIKENESS.smileCosine) return LINES.restoredFace;
  }
  return null;
}

/** Whether the picture holds a face worth protecting (60 px or more) and the face models load. Any trouble means no: today's path runs. */
export async function hasProtectableFace(png: Uint8Array, deps: LikenessDeps = realDeps): Promise<boolean> {
  try {
    await deps.ensureAssets();
    const found = await deps.detect(png);
    return found.ok && found.value.some((f) => !smallFace(f).under60);
  } catch { return false; }
}
export function asStackPic(pic: StackPic, bytes: Uint8Array): StackPic { return { ...pic, b64_json: Buffer.from(bytes).toString("base64"), content_type: "image/png" }; }
