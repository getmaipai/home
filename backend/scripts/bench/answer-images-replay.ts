// IMGQ-08: offline replay of the judged picture sample on captured real data
// (answer-images-capture.ts: every Wikimedia JSON answer and search row list,
// Commons categories included). Runs the real `selectAnswerImages` with the
// recorded answers as its outside world and one synthetic distinct picture per
// address, so what changes between two runs is only the relevance and
// selection rules. No network, no engine.
//
//   MAIPAI_DATA_DIR=<fresh dir under the OS temp root> \
//   bun run scripts/bench/answer-images-replay.ts <capture.json> <out.json> [--only id,id]
//   bun run scripts/bench/answer-images-replay.ts --score <before.json> <after.json> <labels.json> [--rows ids]
//
// `labels.json` maps a tile's page address to right | wrong_subject |
// private_person | junk (every tile opened and judged by eye). A tile with no
// label is listed so it can be judged; it is never counted as right.
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (name: string): string | null => { const at = process.argv.indexOf(name); return at < 0 ? null : (process.argv[at + 1] ?? null); };

type Shown = { page: string; visible: boolean };
type Run = Record<string, { shown: Shown[]; trace: Record<string, unknown> }>;
type Label = "right" | "wrong_subject" | "private_person" | "junk";

if (process.argv[2] === "--score") {
  const [beforePath, afterPath, labelPath] = process.argv.slice(3);
  const before = JSON.parse(readFileSync(beforePath!, "utf-8")) as Run;
  const after = JSON.parse(readFileSync(afterPath!, "utf-8")) as Run;
  const labels = JSON.parse(readFileSync(labelPath!, "utf-8")) as Record<string, Label>;
  const only = flag("--rows") ? new Set(flag("--rows")!.split(",")) : null;
  const ids = Object.keys(before).filter((id) => (!only || only.has(id)));
  const unlabelled: string[] = [];
  const stat = (run: Run) => {
    let wrongQ = 0, privQ = 0, right = 0, rightVisible = 0, tiles = 0;
    const wrong: string[] = [], priv: string[] = [];
    for (const id of ids) {
      const visible = run[id]?.shown.filter((t) => t.visible) ?? [];
      tiles += visible.length;
      let w = false, p = false;
      for (const t of visible) {
        const l = labels[t.page];
        if (!l) { unlabelled.push(`${id} ${t.page}`); continue; }
        if (l === "right") { right++; rightVisible++; }
        if (l === "wrong_subject") w = true;
        if (l === "private_person") p = true;
      }
      if (w) { wrongQ++; wrong.push(id); }
      if (p) { privQ++; priv.push(id); }
    }
    return { wrongQ, privQ, right, tiles, wrong, priv };
  };
  const b = stat(before), a = stat(after);
  console.log(`questions ${ids.length}`);
  console.log(`before: wrong-subject questions ${b.wrongQ} [${b.wrong.join(", ")}]; private ${b.privQ} [${b.priv.join(", ")}]; right visible tiles ${b.right} of ${b.tiles}`);
  console.log(`after : wrong-subject questions ${a.wrongQ} [${a.wrong.join(", ")}]; private ${a.privQ} [${a.priv.join(", ")}]; right visible tiles ${a.right} of ${a.tiles}`);
  console.log(`right visible tiles dropped: ${b.right - a.right} of ${b.right} (${(((b.right - a.right) / Math.max(1, b.right)) * 100).toFixed(1)}%)`);
  // Per-question paired bootstrap, 95% interval on the change in the share of questions with a wrong tile.
  const per = ids.map((id) => {
    const bad = (run: Run) => ((run[id]?.shown.filter((t) => t.visible) ?? []).some((t) => labels[t.page] === "wrong_subject" || (labels[t.page] === "private_person")) ? 1 : 0);
    return bad(after) - bad(before);
  });
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const means: number[] = [];
  for (let i = 0; i < 4000; i++) { let s = 0; for (let k = 0; k < per.length; k++) s += per[Math.floor(rnd() * per.length)]!; means.push(s / per.length); }
  means.sort((x, y) => x - y);
  console.log(`paired change in share of questions with a wrong or private tile: ${(per.reduce((x, y) => x + y, 0) / per.length).toFixed(3)} [95% ${means[100]!.toFixed(3)}, ${means[3899]!.toFixed(3)}]`);
  if (unlabelled.length) console.log(`UNLABELLED visible tiles (${unlabelled.length}):\n${[...new Set(unlabelled)].join("\n")}`);
  process.exit(0);
}

const [capturePath, outPath] = args;
if (!capturePath || !outPath) { console.error("usage: answer-images-replay.ts <capture.json> <out.json>"); process.exit(2); }
const { selectAnswerImages, __setAnswerImageDepsForTests } = await import("@/lib/answerImages/select");
const { __resetAnswerImageFetchForTests } = await import("@/lib/answerImages/fetch");
const { __resetRateLimiterForTests } = await import("@/lib/rateLimiter");
const { syntheticPhoto } = await import("../../tests/answerImagesFixture");

type Capture = { subjects: Record<string, { subject: string; kind: string; person: boolean; json: Record<string, unknown>; search: Record<string, unknown[]> }> };
const capture = JSON.parse(readFileSync(capturePath, "utf-8")) as Capture;
// --topup: fetch the depicts search (Commons structured data) that an older capture lacks, and save it into the capture.
const topup = process.argv.includes("--topup");
const { wikimediaFetchJson } = await import("@/lib/answerImages/wikimedia");
let topped = 0;
const only = flag("--only") ? new Set(flag("--only")!.split(",")) : null;
const out: Run = {};
const photos = new Map<string, Uint8Array>();
let seeds = 2;
const actor = { id: "bench-owner" } as never;
for (const [id, c] of Object.entries(capture.subjects)) {
  if (only && !only.has(id)) continue;
  __resetAnswerImageFetchForTests();
  __resetRateLimiterForTests();
  const fetcher = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!photos.has(url)) photos.set(url, await syntheticPhoto(seeds++));
    return new Response(photos.get(url)!, { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  __setAnswerImageDepsForTests({
    library: async () => null,
    fetchJson: async (url) => {
      if (!(url in c.json) && topup && url.includes("haswbstatement")) {
        // A person's pace: one Commons request at a time, a pause after each; a failure is recorded as no answer.
        await new Promise((r) => setTimeout(r, 5_000));
        c.json[url] = await wikimediaFetchJson(url);
        topped++;
      }
      if (!(url in c.json)) throw new Error(`not captured: ${url}`);
      return c.json[url];
    },
    imageSearch: async (query) => (c.search[query] ?? []) as never,
    fetchOptions: { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) },
  });
  const result = await selectAnswerImages({ subject: c.subject, kind: c.kind, actor, band: "adult", roster: [] });
  const items = result.set?.items ?? [];
  out[id] = { shown: items.map((item, i) => ({ page: item.source.url, visible: i < (result.set?.visible ?? 0) })), trace: result.trace as never };
  console.log(`[${id}] ${items.length} (visible ${result.set?.visible ?? 0}) ${JSON.stringify(result.trace.dropped_by_relevance ?? {})}`);
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
if (topup) { writeFileSync(capturePath, JSON.stringify(capture)); console.log(`topped up ${topped} depicts answers`); }
void sharp;
process.exit(0);
