import sharp from "sharp";
import { submitEdit, waitPicture, cancelOrDelete } from "@/lib/pictures/stack";
import { encodeMask } from "@/lib/pictures/likeness/masks";

export type HarmonyPerson = { alpha: Buffer; contact: { left: number; top: number; width: number; height: number } };
export type HarmonyFace = { box: [number, number, number, number] };
export const HARMONY_PROMPT = "Blend the people into the scene: match the light, soften the outline and add a natural contact shadow. Do not change anyone's face, hair or clothes.";

const plane = (bytes: Buffer, width: number, height: number) => sharp(bytes, { raw: { width, height, channels: 1 } }).toColourspace("b-w").raw().toBuffer();
function morph(src: Buffer, width: number, height: number, radius: number, dilate: boolean): Buffer {
  const horizontal = Buffer.alloc(src.length), out = Buffer.alloc(src.length), span = radius * 2 + 1;
  const run = (input: Buffer, output: Buffer, lines: number, length: number, index: (line: number, pos: number) => number) => {
    for (let line = 0; line < lines; line++) {
      const q: number[] = []; let head = 0;
      for (let pos = 0; pos < length + radius; pos++) {
        const add = pos < length ? input[index(line, pos)]! : 0;
        while (q.length > head && (dilate ? input[index(line, q[q.length - 1]!)]! <= add : input[index(line, q[q.length - 1]!)]! >= add)) q.pop();
        q.push(pos);
        const start = pos - span + 1;
        while (q[head]! < start) head++;
        const outPos = pos - radius;
        if (outPos >= 0 && outPos < length) output[index(line, outPos)] = q[head]! < length ? input[index(line, q[head]!)]! : 0;
      }
    }
  };
  run(src, horizontal, height, width, (y, x) => y * width + x);
  run(horizontal, out, width, height, (x, y) => y * width + x);
  return out;
}
function grown([x, y, w, h]: [number, number, number, number], amount: number, width: number, height: number) {
  const gx = w * amount, gy = h * amount, left = Math.max(0, Math.floor(x - gx)), top = Math.max(0, Math.floor(y - gy));
  return { left, top, width: Math.min(width - left, Math.ceil(w + 2 * gx)), height: Math.min(height - top, Math.ceil(h + 2 * gy)) };
}

/** 255 means editable, matching the Stack edit_masked route. */
export async function ringMask(input: { width: number; height: number; people: HarmonyPerson[]; faceBoxes?: HarmonyFace[] }): Promise<Buffer> {
  const { width, height, people, faceBoxes = [] } = input;
  const n = width * height, ring = Buffer.alloc(n), bodies = Buffer.alloc(n), contacts = Buffer.alloc(n);
  for (const person of people) {
    const alpha = await plane(person.alpha, width, height);
    const dilated = morph(alpha, width, height, 24, true), eroded = morph(alpha, width, height, 2, false);
    for (let i = 0; i < n; i++) { ring[i] = Math.max(ring[i]!, Math.max(0, dilated[i]! - eroded[i]!)); bodies[i] = Math.max(bodies[i]!, alpha[i]!); }
    const c = person.contact;
    const x0 = Math.max(0, Math.floor(c.left)), y0 = Math.max(0, Math.floor(c.top)), x1 = Math.min(width, Math.ceil(c.left + c.width)), y1 = Math.min(height, Math.ceil(c.top + c.height));
    for (let y = y0; y < y1; y++) contacts.fill(255, y * width + x0, y * width + x1);
  }
  for (let i = 0; i < n; i++) ring[i] = Math.max(ring[i]!, contacts[i]!);
  for (const face of faceBoxes) {
    const b = grown(face.box, 0.3, width, height);
    for (let y = b.top; y < b.top + b.height; y++) ring.fill(0, y * width + b.left, y * width + b.left + b.width);
  }
  for (let i = 0; i < n; i++) if (bodies[i]! > 0) ring[i] = 0;
  return Buffer.from(await sharp(ring, { raw: { width, height, channels: 1 } }).png().toBuffer());
}

export async function harmonize(input: { png: Buffer; people: HarmonyPerson[]; faceBoxes: HarmonyFace[]; tools: { harmonize(args: { png: Buffer; mask: Buffer; prompt: string; signal: AbortSignal }): Promise<Uint8Array> }; signal: AbortSignal }): Promise<Buffer> {
  const { data, info } = await sharp(input.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const mask = await ringMask({ width, height, people: input.people, faceBoxes: input.faceBoxes });
  const edited = await input.tools.harmonize({ png: input.png, mask, prompt: HARMONY_PROMPT, signal: input.signal });
  const result = await sharp(Buffer.from(edited)).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const faceMask = Buffer.alloc(width * height);
  for (const face of input.faceBoxes) {
    const b = grown(face.box, 0.3, width, height);
    const local = await sharp({ create: { width: b.width, height: b.height, channels: 3, background: { r: 255, g: 255, b: 255 } } }).blur(12).extractChannel(0).raw().toBuffer();
    for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) faceMask[(b.top + y) * width + b.left + x] = Math.max(faceMask[(b.top + y) * width + b.left + x]!, local[y * b.width + x]!);
    const [fx, fy, fw, fh] = face.box, x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(width, Math.ceil(fx + fw)), y1 = Math.min(height, Math.ceil(fy + fh));
    for (let y = y0; y < y1; y++) faceMask.fill(255, y * width + x0, y * width + x1);
  }
  for (let p = 0; p < width * height; p++) { const a = faceMask[p]! / 255; for (let c = 0; c < 3; c++) result[p * 4 + c] = Math.round(data[p * 3 + c]! * a + result[p * 4 + c]! * (1 - a)); if (a >= 1) result[p * 4 + 3] = 255; }
  return sharp(result, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export async function realHarmonize(png: Buffer, mask: Buffer, prompt: string, signal: AbortSignal): Promise<Uint8Array> {
  const { width, height } = await sharp(png).metadata();
  if (!width || !height) throw new Error("Picture dimensions are unavailable.");
  const form = new FormData(); form.set("operation", "edit_masked"); form.set("image", new Blob([png], { type: "image/png" }), "picture.png");
  form.set("mask", new Blob([await encodeMask(new Uint8Array(await sharp(mask).greyscale().raw().toBuffer()), width, height)], { type: "image/png" }), "mask.png");
  form.set("instruction", prompt); form.set("feather", "0"); form.set("timeout_ms", "1");
  const submitted = await submitEdit(form);
  try { const result = await waitPicture(submitted.job, signal); void cancelOrDelete(submitted.job); return result.bytes; } catch (error) { void cancelOrDelete(submitted.job); throw error; }
}
