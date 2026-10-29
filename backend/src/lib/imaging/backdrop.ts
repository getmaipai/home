import sharp from "sharp";

/** The backdrop a transparent picture is flattened onto before the picture model edits it: neutral, so no colour cast leaks into the result. */
const NEUTRAL = { r: 217, g: 217, b: 217 };
export async function compositeOnNeutral(png: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).flatten({ background: NEUTRAL }).png().toBuffer());
}

/** True when most of the picture's outer ring is the key colour, so keying that colour out is safe. A model that ignored the key and drew its own background would be tinted by it. */
export async function borderLooksKeyed(png: Uint8Array, key: readonly [number, number, number], ring = 2): Promise<boolean> {
  const decoded = await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info; let near = 0, total = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue;
    const offset = (y * width + x) * 4; total++;
    if (Math.hypot(decoded.data[offset]! - key[0], decoded.data[offset + 1]! - key[1], decoded.data[offset + 2]! - key[2]) < 110) near++;
  }
  return total > 0 && near / total >= 0.6;
}

/**
 * Takes the background off a picture the model drew: keyed out when the model kept the key colour, otherwise lifted out by
 * the background remover so the model's own backdrop never tints the subject. A remover that fails leaves the picture as it was.
 */
export async function cutOutBackground(png: Uint8Array, tools: { remove: (bytes: Uint8Array) => Promise<Uint8Array>; key?: { rgb: readonly [number, number, number]; strip: (bytes: Uint8Array) => Promise<Uint8Array> } }): Promise<Uint8Array> {
  if (tools.key && await borderLooksKeyed(png, tools.key.rgb)) return tools.key.strip(png);
  try { return await tools.remove(png); } catch { return png; }
}
