// IMGSIM-01: the near-duplicate bench (measurement only). Real Commons photos
// (a folder of JPEGs fetched at a person's pace by the caller, never
// committed), each with 12 synthetic overlay variants that must merge with
// it, plus listed same-shoot pairs and every pair of different clean photos
// that must not. Calls the shared module exactly as Home does. Prints merges
// per variant, false merges, whether the clean original was picked as each
// group's representative, and timings.
//
//   bun run scripts/bench/image-similarity.ts <photo dir> <spec.json> [--features 500]
//
// spec.json: { "clean": ["a.jpg", ...], "near": [["b.jpg", "c.jpg"], ...], "same": [["d.jpg", "e.jpg"], ...] }
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { cluster, fingerprint, type ClusterItem } from "@/lib/imageSimilarity";

const [dir, specPath] = process.argv.slice(2);
if (!dir || !specPath) { console.error("usage: image-similarity.ts <photo dir> <spec.json> [--features N]"); process.exit(2); }
const at = process.argv.indexOf("--features");
const orbFeatures = at > 0 ? Number(process.argv[at + 1]) : undefined;
const ra = process.argv.indexOf("--radius");
const verifyRadiusBits = ra > 0 ? Number(process.argv[ra + 1]) : undefined;
const spec = JSON.parse(readFileSync(specPath, "utf-8")) as { clean: string[]; near: [string, string][]; same?: [string, string][] };

const KINDS = ["watermark_corner", "watermark_tiled", "scribbles", "arrow_circle", "sticker", "meme_text", "speech_bubble", "logo_bug", "colour_border", "crop_rescale", "caption_bar", "top_banner", "blurred_copy"] as const;
type Kind = (typeof KINDS)[number];

async function variant(src: Buffer, kind: Kind): Promise<Buffer> {
  const img = sharp(src);
  const { width: W, height: H } = (await img.metadata()) as { width: number; height: number };
  const svg = (body: string, w = W, h = H) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
  const fs = Math.round(H * 0.09);
  switch (kind) {
    case "watermark_corner": return img.composite([{ input: svg(`<text x="${W * 0.55}" y="${H * 0.93}" font-size="${fs * 0.6}" font-family="Arial" fill="white" fill-opacity="0.6">© PhotoAgency</text>`) }]).jpeg().toBuffer();
    case "watermark_tiled": {
      let t = "";
      for (let y = 0; y < H + 200; y += H / 4) for (let x = -W; x < W; x += W / 2.5) t += `<text x="${x}" y="${y}" font-size="${fs * 0.7}" font-family="Arial" font-weight="bold" fill="white" fill-opacity="0.35" transform="rotate(-25 ${x} ${y})">SAMPLE STOCK</text>`;
      return img.composite([{ input: svg(t) }]).jpeg().toBuffer();
    }
    case "scribbles": {
      let d = "", s = 7;
      const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
      for (let k = 0; k < 4; k++) { d += `M ${r() * W} ${r() * H} `; for (let j = 0; j < 8; j++) d += `Q ${r() * W} ${r() * H} ${r() * W} ${r() * H} `; }
      return img.composite([{ input: svg(`<path d="${d}" stroke="#e01010" stroke-width="${Math.max(3, W / 120)}" fill="none"/>`) }]).jpeg().toBuffer();
    }
    case "arrow_circle": return img.composite([{ input: svg(`<circle cx="${W * 0.6}" cy="${H * 0.45}" r="${H * 0.18}" stroke="red" stroke-width="${W / 90}" fill="none"/><path d="M ${W * 0.1} ${H * 0.9} L ${W * 0.42} ${H * 0.55}" stroke="red" stroke-width="${W / 80}"/>`) }]).jpeg().toBuffer();
    case "sticker": { const r = W * 0.1; return img.composite([{ input: svg(`<circle cx="${W * 0.78}" cy="${H * 0.3}" r="${r}" fill="#ffd400" stroke="#333" stroke-width="3"/><circle cx="${W * 0.75}" cy="${H * 0.27}" r="${r * 0.12}" fill="#333"/><circle cx="${W * 0.81}" cy="${H * 0.27}" r="${r * 0.12}" fill="#333"/>`) }]).jpeg().toBuffer(); }
    case "meme_text": return img.composite([{ input: svg(`<text x="50%" y="${fs * 1.2}" text-anchor="middle" font-size="${fs * 1.1}" font-family="Impact, Arial Black, Arial" font-weight="bold" fill="white" stroke="black" stroke-width="3">WHEN YOU SEE IT</text><text x="50%" y="${H - fs * 0.4}" text-anchor="middle" font-size="${fs * 1.1}" font-family="Impact, Arial Black, Arial" font-weight="bold" fill="white" stroke="black" stroke-width="3">NOBODY EXPECTS THIS</text>`) }]).jpeg().toBuffer();
    case "speech_bubble": return img.composite([{ input: svg(`<ellipse cx="${W * 0.3}" cy="${H * 0.25}" rx="${W * 0.22}" ry="${H * 0.14}" fill="white" stroke="black" stroke-width="3"/><text x="${W * 0.3}" y="${H * 0.27}" text-anchor="middle" font-size="${fs * 0.7}" font-family="Arial">Look at this!</text>`) }]).jpeg().toBuffer();
    case "logo_bug": return img.composite([{ input: svg(`<rect x="${W * 0.86}" y="${H * 0.04}" width="${W * 0.1}" height="${H * 0.08}" rx="6" fill="#1060d0"/><text x="${W * 0.91}" y="${H * 0.1}" text-anchor="middle" font-size="${fs * 0.45}" font-family="Arial" font-weight="bold" fill="white">TV9</text>`) }]).jpeg().toBuffer();
    case "colour_border": return img.extend({ top: Math.round(H * 0.06), bottom: Math.round(H * 0.06), left: Math.round(W * 0.06), right: Math.round(W * 0.06), background: "#c0202a" }).jpeg().toBuffer();
    case "crop_rescale": return img.extract({ left: Math.round(W * 0.05), top: Math.round(H * 0.03), width: Math.round(W * 0.92), height: Math.round(H * 0.92) }).resize(Math.round(W * 0.7)).jpeg({ quality: 70 }).toBuffer();
    case "caption_bar": { const bar = Math.round(H * 0.16); return sharp(await img.extend({ bottom: bar, background: "#000" }).toBuffer()).composite([{ input: svg(`<text x="20" y="${H + bar * 0.65}" font-size="${bar * 0.45}" font-family="Arial" fill="white">Breaking: you will not believe this</text>`, W, H + bar) }]).jpeg().toBuffer(); }
    case "blurred_copy": return img.blur(2.5).jpeg({ quality: 80 }).toBuffer();
    case "top_banner": return img.composite([{ input: svg(`<rect x="0" y="0" width="${W}" height="${H * 0.15}" fill="#d01818" fill-opacity="0.85"/><text x="20" y="${H * 0.1}" font-size="${fs * 0.8}" font-family="Arial" font-weight="bold" fill="white">EXCLUSIVE PHOTOS</text>`) }]).jpeg().toBuffer();
  }
}

const load = async (f: string) => sharp(readFileSync(join(dir, f))).resize(640, 640, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer();
const item = async (id: string, bytes: Buffer): Promise<ClusterItem> => ({ id, bytes: new Uint8Array(bytes), fingerprint: await fingerprint(new Uint8Array(bytes)) });
const times: number[] = [];
async function groupOf(items: ClusterItem[]) {
  const t = performance.now();
  const r = await cluster(items, { timeBudgetMs: 60_000, maxVerifiedPairs: 10_000, ...(orbFeatures ? { orbFeatures } : {}), ...(verifyRadiusBits ? { verifyRadiusBits } : {}) });
  times.push(performance.now() - t);
  return r;
}

const merged: Record<string, number> = {}, cleanPicked: Record<string, number> = {};
const cleans = await Promise.all(spec.clean.map(load));
for (const [ci, src] of cleans.entries()) {
  const original = await item(`clean`, src);
  for (const kind of KINDS) {
    const r = await groupOf([original, await item(kind, await variant(src, kind))]);
    if (r.groups.length === 1) { merged[kind] = (merged[kind] ?? 0) + 1; if (r.groups[0]!.representative === "clean") cleanPicked[kind] = (cleanPicked[kind] ?? 0) + 1; }
  }
  if (ci === 0) console.log(`(first photo done)`);
}
let sameMerged = 0;
for (const [a, b] of spec.same ?? []) if ((await groupOf([await item("a", await load(a)), await item("b", await load(b))])).groups.length === 1) sameMerged++;
const falseNear: string[] = [];
for (const [a, b] of spec.near) if ((await groupOf([await item("a", await load(a)), await item("b", await load(b))])).groups.length === 1) falseNear.push(`${a} ${b}`);
const allClean = await Promise.all(cleans.map((c, i) => item(`c${i}`, c)));
const cleanRun = await groupOf(allClean);
const n = spec.clean.length;
console.log(`orb features: ${orbFeatures ?? "default"}; verify radius: ${verifyRadiusBits ?? "default"}`);
for (const k of KINDS) console.log(`${k.padEnd(17)} merged ${merged[k] ?? 0}/${n}, clean original kept ${cleanPicked[k] ?? 0}/${merged[k] ?? 0}`);
const total = KINDS.reduce((s, k) => s + (merged[k] ?? 0), 0);
console.log(`variants merged ${total}/${n * KINDS.length}; listed same-photo pairs merged ${sameMerged}/${spec.same?.length ?? 0}`);
console.log(`same-shoot pairs merged (false) ${falseNear.length}/${spec.near.length}${falseNear.length ? `: ${falseNear.join("; ")}` : ""}`);
console.log(`different clean photos: ${n} in, ${cleanRun.groups.length} groups out (false merges ${n - cleanRun.groups.length}); ${JSON.stringify(cleanRun.stats)}`);
const sorted = [...times].sort((a, b) => a - b);
console.log(`cluster ms per 2-picture call: median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(0)}, p95 ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(0)}; ${n}-picture call ${times.at(-1)!.toFixed(0)} ms`);
