// RECENCY-02: trains the weather detector, the weather sibling of the search assist's head. The same shape: the raw
// sentence embedding Home already makes for memory (nomic-embed-text, 768 numbers), one linear layer, a recorded
// threshold. Whole families of asking are held out in turn, so every number printed is on a way of asking the head
// was not trained on. Writes src/lib/searchAssist/weather-head.json (a SearchAssistManifest, binary layout).
//
//   MAIPAI_EMBED_URL=http://127.0.0.1:8770 bun run scripts/train/weatherHead.ts [--write]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WEATHER_NEGATIVE, WEATHER_POSITIVE } from "./weatherCorpus";

const URL_BASE = (process.env.MAIPAI_EMBED_URL ?? "http://127.0.0.1:8770").replace(/\/$/, "");
const CACHE = join(import.meta.dir, "data", ".weather-embed-cache.json");
const OUT = join(import.meta.dir, "..", "..", "src", "lib", "searchAssist", "weather-head.json");
const TARGET_PRECISION = Number(process.env.WH_PRECISION ?? 0.93);

type Row = { text: string; family: string; y: 0 | 1 };
const rows: Row[] = [
  ...Object.entries(WEATHER_POSITIVE).flatMap(([family, list]) => list.map((text) => ({ text, family: `pos:${family}`, y: 1 as const }))),
  ...Object.entries(WEATHER_NEGATIVE).flatMap(([family, list]) => list.map((text) => ({ text, family: `neg:${family}`, y: 0 as const }))),
];

async function embedAll(texts: string[]): Promise<{ vectors: number[][]; model: string }> {
  const cache: Record<string, number[]> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  let model = "";
  const need = texts.filter((t) => !cache[t]);
  for (let i = 0; i < need.length; i += 32) {
    const batch = need.slice(i, i + 32);
    const res = await fetch(`${URL_BASE}/v1/embeddings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "embed", input: batch }) });
    if (!res.ok) throw new Error(`embed failed: ${res.status}`);
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[]; model?: string };
    model = body.model ?? model;
    for (const d of [...body.data].sort((a, b) => a.index - b.index)) cache[batch[d.index]!] = d.embedding;
  }
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache));
  return { vectors: texts.map((t) => cache[t]!), model };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Binary logistic regression, full-batch gradient descent, L2, class-balanced. Deterministic. */
function train(X: number[][], y: number[], dim: number, l2 = Number(process.env.WH_L2 ?? 0.001), epochs = Number(process.env.WH_EPOCHS ?? 1500), lr = 0.5): { w: number[]; b: number } {
  const w = new Array<number>(dim).fill(0);
  let b = 0;
  const pos = y.filter((v) => v === 1).length;
  const neg = y.length - pos;
  const wPos = y.length / (2 * pos);
  const wNeg = y.length / (2 * neg);
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gw = new Array<number>(dim).fill(0);
    let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const x = X[i]!;
      let z = b;
      for (let d = 0; d < dim; d++) z += w[d]! * x[d]!;
      const err = (sigmoid(z) - y[i]!) * (y[i] === 1 ? wPos : wNeg);
      for (let d = 0; d < dim; d++) gw[d]! += err * x[d]!;
      gb += err;
    }
    for (let d = 0; d < dim; d++) w[d]! -= lr * (gw[d]! / X.length + l2 * w[d]!);
    b -= lr * (gb / X.length);
  }
  return { w, b };
}
const prob = (m: { w: number[]; b: number }, x: number[]) => sigmoid(m.b + m.w.reduce((s, v, d) => s + v * x[d]!, 0));

/** The lowest threshold whose precision on these held-out scores is at least the target (above 1 = never fires). */
function chooseThreshold(scores: { p: number; y: number }[]): number {
  const sorted = [...scores].sort((a, b) => b.p - a.p);
  let tp = 0;
  let best = 1.01;
  sorted.forEach((s, i) => {
    tp += s.y;
    if (tp / (i + 1) >= TARGET_PRECISION) best = s.p;
  });
  return best;
}

async function main(): Promise<void> {
  const { vectors, model } = await embedAll(rows.map((r) => r.text));
  const dim = vectors[0]!.length;
  console.log(`${rows.length} sentences (${rows.filter((r) => r.y).length} weather), ${dim} dims, embed model "${model}"`);
  // Leave-one-family-group-out: pair a positive family with a negative family per fold so each fold has both classes.
  const posFamilies = [...new Set(rows.filter((r) => r.y).map((r) => r.family))];
  const negFamilies = [...new Set(rows.filter((r) => !r.y).map((r) => r.family))];
  const folds = Math.max(posFamilies.length, negFamilies.length);
  const held: { p: number; y: number; text: string; family: string }[] = [];
  for (let f = 0; f < folds; f++) {
    const out = new Set([posFamilies[f % posFamilies.length]!, negFamilies[f % negFamilies.length]!, negFamilies[(f + 5) % negFamilies.length]!]);
    const trainIdx = rows.map((r, i) => (out.has(r.family) ? -1 : i)).filter((i) => i >= 0);
    const m = train(trainIdx.map((i) => vectors[i]!), trainIdx.map((i) => rows[i]!.y), dim);
    rows.forEach((r, i) => { if (out.has(r.family)) held.push({ p: prob(m, vectors[i]!), y: r.y, text: r.text, family: r.family }); });
  }
  // A sentence appears in several folds' held-out sets only for the families repeated by the modulo; average per text.
  const byText = new Map<string, { p: number[]; y: number; family: string }>();
  for (const h of held) { const e = byText.get(h.text) ?? { p: [], y: h.y, family: h.family }; e.p.push(h.p); byText.set(h.text, e); }
  const scored = [...byText.entries()].map(([text, e]) => ({ text, family: e.family, y: e.y, p: e.p.reduce((a, b) => a + b, 0) / e.p.length }));
  const threshold = chooseThreshold(scored);
  const fired = scored.filter((s) => s.p >= threshold);
  const tp = fired.filter((s) => s.y === 1).length;
  const positives = scored.filter((s) => s.y === 1).length;
  console.log(`held-out: threshold ${threshold.toFixed(3)}  precision ${(100 * tp / Math.max(fired.length, 1)).toFixed(1)}%  recall ${(100 * tp / positives).toFixed(1)}%  false fires ${fired.length - tp} of ${scored.length - positives}`);
  const familyRecall = posFamilies.map((fam) => { const r = scored.filter((s) => s.family === fam); return `${fam.slice(4)} ${r.filter((s) => s.p >= threshold).length}/${r.length}`; });
  console.log("recall by way of asking:", familyRecall.join(", "));
  for (const s of scored.filter((x) => x.y === 0 && x.p >= threshold)) console.log("  false fire:", s.text, s.p.toFixed(2));
  for (const s of scored.filter((x) => x.y === 1 && x.p < threshold).slice(0, 12)) console.log("  missed:", s.text, s.p.toFixed(2));
  if (!process.argv.includes("--write")) return;
  const final = train(vectors, rows.map((r) => r.y), dim);
  const manifest = {
    embed: { model: "nomic-embed-text-v1.5.Q4_K_M", dims: dim, preprocess: "v1", prefix: "" },
    features: "alone",
    classes: ["other", "weather"],
    coef: [final.w.map((v) => Number(v.toFixed(6)))],
    intercept: [Number(final.b.toFixed(6))],
    thresholds: { weather: { class: "weather", value: Number(threshold.toFixed(4)) } },
    label_spec_version: "weather-1",
    dataset_sha256: createHash("sha256").update(JSON.stringify(rows.map((r) => [r.text, r.y]))).digest("hex"),
    bench_record: `RECENCY-02 weather head: ${rows.length} sentences in ${posFamilies.length + negFamilies.length} families, leave-families-out, threshold at ${TARGET_PRECISION} precision: precision ${(100 * tp / Math.max(fired.length, 1)).toFixed(1)}%, recall ${(100 * tp / positives).toFixed(1)}%`,
  };
  writeFileSync(OUT, `${JSON.stringify(manifest)}\n`);
  console.log(`wrote ${OUT}`);
}
await main();
