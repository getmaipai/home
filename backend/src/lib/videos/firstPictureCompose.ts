// CREATOR-07: a natural placement of each person's own cut-out on the plate, with sharp and plain arithmetic only (no model, no edit).
// Faces stay the photo's own pixels: only the outline, the overall colour (a gentle Lab shift), a contact shadow and the position change.
import sharp, { type OverlayOptions, type Sharp } from "sharp";
import type { Pose, SeatBox } from "@/lib/pictures/pose";

/** A start value (benched on the Studio): how far each person's colour and contrast move toward the plate's. */
export const LAB_STRENGTH = 0.4;
/** Where a standing person's feet stand, as a fraction of the frame height. */
export const FLOOR_LINE = 0.55;
/** The tallest a person may be, as a fraction of the frame height. */
export const MAX_PERSON_HEIGHT = 0.7;
/** A seated or cropped person is cut by the lower frame edge by at least this fraction of their height. */
export const CROP_FRACTION = 0.3;
const ERODE_PX = 2;
const SHADOW_OPACITY = 0.25;

type Person = { image: Buffer; pose: Pose; seat?: SeatBox | null };
type Lab = [number, number, number];

const toLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLinear = (v: number) => Math.max(0, Math.min(255, Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))));
function rgbToLab(r: number, g: number, b: number): Lab {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToRgb([L, a, b]: Lab): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (v: number) => (v ** 3 > 0.008856 ? v ** 3 : (v - 16 / 116) / 7.787);
  const x = 0.95047 * inv(fx), y = inv(fy), z = 1.08883 * inv(fz);
  return [fromLinear(x * 3.2406 - y * 1.5372 - z * 0.4986), fromLinear(-x * 0.9689 + y * 1.8758 + z * 0.0415), fromLinear(x * 0.0557 - y * 0.204 + z * 1.057)];
}

/** Mean and standard deviation of L, a and b over the pixels that count (every pixel of a plate, the opaque ones of a person). */
export function labStats(raw: Uint8Array, channels: number): { mean: Lab; sd: Lab } {
  const sum: Lab = [0, 0, 0], sq: Lab = [0, 0, 0];
  let n = 0;
  for (let i = 0; i + channels <= raw.length; i += channels) {
    if (channels === 4 && raw[i + 3]! < 128) continue;
    const lab = rgbToLab(raw[i]!, raw[i + 1]!, raw[i + 2]!);
    for (let c = 0; c < 3; c++) { sum[c]! += lab[c]!; sq[c]! += lab[c]! ** 2; }
    n++;
  }
  const count = Math.max(1, n);
  const mean = sum.map((v) => v / count) as Lab;
  return { mean, sd: sq.map((v, c) => Math.sqrt(Math.max(1e-6, v / count - mean[c]! ** 2))) as Lab };
}

interface Clean { png: Buffer; width: number; height: number }

/** Erode the outline, give the edge pixels the colour just inside (no dark sliver), then move colour and contrast toward the plate's by `strength`. */
async function cleanAndMatch(image: Buffer, plate: { mean: Lab; sd: Lab }, strength: number): Promise<Clean> {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const count = width * height;
  const radius = Math.max(1, Math.round(ERODE_PX * Math.max(1, Math.max(width, height) / 768)));
  const alpha = Buffer.alloc(count);
  for (let p = 0; p < count; p++) alpha[p] = data[p * 4 + 3]!;
  const plain = { raw: { width, height, channels: 1 as const } };
  // sharp hands a one-plane image back as three planes unless told otherwise: always ask for one.
  const plane = async (input: Sharp): Promise<Buffer> => input.toColourspace("b-w").raw().toBuffer();
  // The solid inside: opaque pixels at least `radius` from the edge.
  const solid = await plane(sharp(Buffer.from(alpha.map((v) => (v === 255 ? 255 : 0))), plain).erode(radius));
  // A colour field grown outward from the solid inside: blur the colour weighted by the solid mask, then divide by the blurred mask.
  const weighted = Buffer.alloc(count * 3);
  for (let p = 0; p < count; p++) { const w = solid[p]! / 255; for (let c = 0; c < 3; c++) weighted[p * 3 + c] = Math.round(data[p * 4 + c]! * w); }
  const sigma = radius * 3;
  const blurredColour = await sharp(weighted, { raw: { width, height, channels: 3 } }).blur(sigma).raw().toBuffer();
  const blurredMask = await plane(sharp(solid, plain).blur(sigma));
  const out = Buffer.alloc(count * 4);
  const personStats = labStats(Buffer.from(data.map((v, i) => (i % 4 === 3 ? (solid[(i - 3) / 4]! ? 255 : 0) : v))), 4);
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    const inside = solid[p]! === 255;
    const weight = Math.max(1, blurredMask[p]!) / 255;
    let r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (!inside) { r = Math.min(255, blurredColour[p * 3]! / weight); g = Math.min(255, blurredColour[p * 3 + 1]! / weight); b = Math.min(255, blurredColour[p * 3 + 2]! / weight); }
    const lab = rgbToLab(r, g, b);
    for (let c = 0; c < 3; c++) {
      const gain = 1 + (plate.sd[c]! / personStats.sd[c]! - 1) * strength;
      lab[c] = personStats.mean[c]! + (lab[c]! - personStats.mean[c]!) * gain + (plate.mean[c]! - personStats.mean[c]!) * strength;
    }
    const rgb = labToRgb(lab);
    out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2];
    out[i + 3] = Math.min(alpha[p]!, inside ? 255 : Math.min(255, solid[p]! + Math.max(0, alpha[p]! - 128)));
  }
  // A soft 0.7 px edge on the new, eroded alpha.
  const softAlpha = await plane(sharp(Buffer.from(Array.from({ length: count }, (_, p) => out[p * 4 + 3]!)), plain).blur(0.7));
  for (let p = 0; p < count; p++) out[p * 4 + 3] = Math.min(out[p * 4 + 3]!, softAlpha[p]! + (solid[p]! === 255 ? 255 : 0));
  const png = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { png, width, height };
}

/** Each person's own cut-out placed on the plate by pose; returns a PNG at the plate's size. */
export async function composeNatural(plate: Buffer, people: Person[], opts: { labStrength?: number } = {}): Promise<Buffer> {
  const base = sharp(plate).ensureAlpha();
  const meta = await base.metadata();
  const W = meta.width!, H = meta.height!;
  const { data: plateData, info: plateInfo } = await sharp(plate).removeAlpha().resize(256).raw().toBuffer({ resolveWithObject: true });
  const plateStats = labStats(plateData, plateInfo.channels);
  const strength = opts.labStrength ?? LAB_STRENGTH;
  const slotW = W / Math.max(people.length, 1);
  const layers: OverlayOptions[] = [];
  for (const [index, person] of people.entries()) {
    const clean = await cleanAndMatch(person.image, plateStats, strength);
    let width: number, height: number, left: number, top: number;
    if (person.pose === "seated" && person.seat) {
      const bw = W * person.seat.w, bh = H * person.seat.h;
      const scale = Math.min(bw / clean.width, bh / clean.height);
      width = Math.round(clean.width * scale); height = Math.round(clean.height * scale);
      left = Math.round(W * person.seat.x + (bw - width) / 2); top = Math.round(H * person.seat.y + (bh - height) / 2);
    } else if (person.pose === "standing") {
      const scale = Math.min((slotW * 0.9) / clean.width, (H * Math.min(MAX_PERSON_HEIGHT, FLOOR_LINE * 0.9)) / clean.height);
      width = Math.round(clean.width * scale); height = Math.round(clean.height * scale);
      left = Math.round(slotW * index + (slotW - width) / 2); top = Math.round(H * FLOOR_LINE - height);
    } else {
      // Seated with no seat found, or cut off: the lower part is below the frame, never a whole figure on open ground.
      const scale = Math.min((slotW * 0.9) / clean.width, (H * 0.9) / (clean.height * (1 - CROP_FRACTION)));
      width = Math.round(clean.width * scale); height = Math.round(clean.height * scale);
      left = Math.round(slotW * index + (slotW - width) / 2); top = H - Math.round(height * (1 - CROP_FRACTION));
    }
    width = Math.max(1, width); height = Math.max(1, height);
    const person_png = await sharp(clean.png).resize(width, height).png().toBuffer();
    // The contact shadow: a blurred dark ellipse under the feet, or along the seat edge for a seated person.
    const shadowH = Math.max(6, Math.round(height * 0.06));
    const shadowSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${shadowH * 2}"><ellipse cx="${width / 2}" cy="${shadowH}" rx="${width * 0.42}" ry="${shadowH * 0.7}" fill="black" fill-opacity="${SHADOW_OPACITY}"/></svg>`);
    const shadow = await sharp(shadowSvg).blur(Math.max(1, shadowH / 2)).png().toBuffer();
    const feet = Math.min(H - 1, top + height);
    layers.push({ input: shadow, left: Math.max(0, left), top: Math.max(0, Math.min(H - shadowH * 2, feet - shadowH)) });
    // sharp cannot place a layer outside the frame: clip the person to what shows.
    const visibleH = Math.min(height, H - Math.max(0, top)), cropTop = top < 0 ? -top : 0;
    const visibleW = Math.min(width, W - Math.max(0, left)), cropLeft = left < 0 ? -left : 0;
    const shown = cropTop || cropLeft || visibleH < height || visibleW < width
      ? await sharp(person_png).extract({ left: cropLeft, top: cropTop, width: Math.max(1, visibleW - cropLeft), height: Math.max(1, visibleH - cropTop) }).png().toBuffer()
      : person_png;
    layers.push({ input: shown, left: Math.max(0, left), top: Math.max(0, top) });
  }
  return base.composite(layers).png().toBuffer();
}
