export interface FaceBox { bbox: [number, number, number, number] }
export type Match = { kind: "matched"; source: FaceBox; output: FaceBox } | { kind: "removed"; source: FaceBox };
function gray(value: Uint8Array | Uint8ClampedArray, width: number, height: number): Float64Array {
  if (value.length !== width * height) throw new Error("gray buffer dimensions do not match");
  return Float64Array.from(value);
}
const kernel = (() => { const a = []; for (let i = -5; i <= 5; i++) a.push(Math.exp(-(i * i) / (2 * 1.5 * 1.5))); const sum = a.reduce((x, y) => x + y, 0); return a.map(x => x / sum); })();
function reflect(i: number, n: number): number { if (n <= 1) return 0; while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - i - 2; return i; }
function blur(a: Float64Array, width: number, height: number): Float64Array {
  const temp = new Float64Array(a.length), out = new Float64Array(a.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let v = 0; for (let k = -5; k <= 5; k++) v += a[y * width + reflect(x + k, width)]! * kernel[k + 5]!; temp[y * width + x] = v; }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let v = 0; for (let k = -5; k <= 5; k++) v += temp[reflect(y + k, height) * width + x]! * kernel[k + 5]!; out[y * width + x] = v; }
  return out;
}
export function ssimGray(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray, width: number, height: number): number {
  const aa = gray(a, width, height), bb = gray(b, width, height), ma = blur(aa, width, height), mb = blur(bb, width, height);
  const a2 = blur(Float64Array.from(aa, x => x * x), width, height), b2 = blur(Float64Array.from(bb, x => x * x), width, height), ab = blur(Float64Array.from(aa, (x, i) => x * bb[i]!), width, height);
  let sum = 0; const c1 = 6.5025, c2 = 58.5225;
  for (let i = 0; i < aa.length; i++) { const u = ma[i]!, v = mb[i]!, s1 = a2[i]! - u * u, s2 = b2[i]! - v * v, s12 = ab[i]! - u * v; sum += ((2 * u * v + c1) * (2 * s12 + c2)) / ((u * u + v * v + c1) * (s1 + s2 + c2)); }
  return sum / aa.length;
}
export function faceUntouched(src: Uint8Array, out: Uint8Array, face: FaceBox, width: number, height: number): number {
  const [x, y, w, h] = face.bbox.map(Math.trunc) as [number, number, number, number];
  const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(width, x + w), bottom = Math.min(height, y + h);
  if (right <= left || bottom <= top || src.length !== width * height || out.length !== src.length) return 0;
  const a = new Uint8Array((right - left) * (bottom - top)), b = new Uint8Array(a.length);
  for (let row = top; row < bottom; row++) { a.set(src.subarray(row * width + left, row * width + right), (row - top) * (right - left)); b.set(out.subarray(row * width + left, row * width + right), (row - top) * (right - left)); }
  return ssimGray(a, b, right - left, bottom - top);
}
export function matchFaces(srcFaces: FaceBox[], outFaces: FaceBox[]): Match[] {
  return srcFaces.map(source => {
    const [x, y, w, h] = source.bbox; const cx = x + w / 2, cy = y + h / 2;
    const nearest = outFaces.map(output => { const [ox, oy, ow, oh] = output.bbox; return { output, d: Math.hypot(ox + ow / 2 - cx, oy + oh / 2 - cy) }; }).filter(v => v.d <= w / 2).sort((a, b) => a.d - b.d)[0];
    return nearest ? { kind: "matched", source, output: nearest.output } : { kind: "removed", source };
  });
}
export function coverage(src: Uint8Array, out: Uint8Array, mask: Uint8Array, channels = 4): number {
  if (src.length !== out.length || src.length !== mask.length * channels) throw new Error("pixel buffers do not match");
  let n = 0, changed = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p]! > 127) { let d = 0; for (let c = 0; c < channels; c++) d += Math.abs(src[p * channels + c]! - out[p * channels + c]!); n++; if (d / channels >= 20) changed++; }
  return n ? changed / n : 0;
}
export function ringDiff(src: Uint8Array, out: Uint8Array, mask: Uint8Array, width: number, height: number, px: number, channels = 4): number {
  if (src.length !== out.length || src.length !== width * height * channels || mask.length !== width * height) throw new Error("pixel buffers do not match");
  let sum = 0, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x; if (mask[p]! > 127) continue;
    let inside = false; for (let dy = -px; dy <= px && !inside; dy++) for (let dx = -px; dx <= px; dx++) { if (dx * dx + dy * dy > px * px) continue; const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < width && yy >= 0 && yy < height && mask[yy * width + xx]! > 127) { inside = true; break; } }
    if (!inside) continue;
    for (let c = 0; c < channels; c++) sum += Math.abs(src[p * channels + c]! - out[p * channels + c]!); count++;
  }
  return count ? sum / count : 0;
}
export function smallFace(face: FaceBox): { under60: boolean; refuseSmile: boolean } { const width = face.bbox[2]; return { under60: width < 60, refuseSmile: width < 80 }; }
