// IMGQ-08: capture the judged sample's candidates WITH their Commons category
// metadata, so the relevance rules can be replayed offline on real data
// (answer-images-replay.ts). Runs the real picture pipeline (`selectAnswerImages`)
// for each subject in datasets/answer-images-sample.json with two taps: every
// Wikimedia JSON response and every image-search result list is recorded under
// its address / query, and every tile shown is saved for judging. No chat model
// and no engine is involved (unlike answer-images-sample.ts, which this does not
// replace: that one scores a judged sheet).
//
// A person's pace (docs/THIRD-PARTY-SERVICES.md): subjects one at a time with a
// pause between them; a 429, or a 403 from a Wikimedia host, stops the run.
//
//   MAIPAI_DATA_DIR=<fresh dir under the OS temp root> MAIPAI_IMG08_SEARXNG_URL=<the household's SearXNG> \
//   MAIPAI_IMG08_OUT=<output dir> bun run scripts/bench/answer-images-capture.ts [--only id,id]
//
// Output: <out>/capture.json (the fixture), <out>/pics/<id>-<n>.webp and a
// <out>/judging.json in answer-images-sample.ts's shape.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sampleDataset from "./datasets/answer-images-sample.json";
import heldOutDataset from "./datasets/answer-images-heldout.json";
const dataset = process.argv.includes("--heldout") ? heldOutDataset : sampleDataset;

const OUT = process.env.MAIPAI_IMG08_OUT;
const searxng = process.env.MAIPAI_IMG08_SEARXNG_URL;
const dataDir = process.env.MAIPAI_DATA_DIR;
if (!OUT || !searxng || !dataDir || !dataDir.startsWith(tmpdir()) && !dataDir.startsWith("/private/tmp") && !dataDir.startsWith("/tmp")) {
  console.error("answer-images-capture refused: set MAIPAI_DATA_DIR (a fresh directory under the system temp root), MAIPAI_IMG08_OUT and MAIPAI_IMG08_SEARXNG_URL.");
  process.exit(2);
}
const arg = (name: string): string | null => { const at = process.argv.indexOf(name); return at < 0 ? null : (process.argv[at + 1] ?? null); };
const ONLY = arg("--only") ? new Set(arg("--only")!.split(",")) : null;
const PACE_MS = Number(process.env.MAIPAI_IMG08_PACE_MS ?? 15_000);
const PICS = join(OUT, "pics");
mkdirSync(PICS, { recursive: true });

let blockSignal: string | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const response = await realFetch(input, init);
  const driven = /(^|\.)(wikidata|wikipedia|wikimedia)\.org$/.test(url.hostname);
  if ((response.status === 429 || (response.status === 403 && driven)) && !blockSignal) blockSignal = `${response.status} from ${url.hostname}`;
  return response;
}) as typeof fetch;

const { selectAnswerImages, __setAnswerImageDepsForTests } = await import("@/lib/answerImages/select");
const { getAnswerImage } = await import("@/lib/answerImages/cache");
const { wikimediaFetchJson } = await import("@/lib/answerImages/wikimedia");
const { imageRowsFromResponse } = await import("@/lib/packageHost");

const captureFile = join(OUT, "capture.json");
type Capture = { captured_at: string; subjects: Record<string, { subject: string; kind: string; person: boolean; json: Record<string, unknown>; search: Record<string, unknown[]>; shown: { page: string; caption: string; visible: boolean; file: string }[]; trace: unknown }> };
const capture: Capture = existsSync(captureFile) && ONLY ? JSON.parse(readFileSync(captureFile, "utf-8")) : { captured_at: new Date().toISOString(), subjects: {} };

const actor = { id: "bench-owner" } as never;
const rows = (dataset.subjects as { id: string; subject: string; kind: string; person?: boolean }[]).filter((r) => !ONLY || ONLY.has(r.id));
for (const [n, row] of rows.entries()) {
  if (blockSignal) break;
  if (n > 0) await new Promise((r) => setTimeout(r, PACE_MS));
  const json: Record<string, unknown> = {};
  const search: Record<string, unknown[]> = {};
  __setAnswerImageDepsForTests({
    library: async () => null,
    fetchJson: async (url) => { const body = await wikimediaFetchJson(url); json[url] = body; return body; },
    imageSearch: async (query) => {
      const url = `${searxng.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json&categories=images&safesearch=1`;
      const response = await fetch(url, { headers: { "user-agent": "MaiPai-Home/1.0 (+https://github.com/getmaipai/home)" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return [];
      const rowsOut = imageRowsFromResponse(await response.json());
      search[query] = rowsOut;
      return rowsOut;
    },
  });
  const result = await selectAnswerImages({ subject: row.subject, kind: row.kind, actor, band: "adult", roster: [], deadlineAt: Date.now() + 8_000 });
  const items = result.set?.items ?? [];
  const shown: Capture["subjects"][string]["shown"] = [];
  for (const [i, item] of items.entries()) {
    const bytes = await getAnswerImage(item.id, "adult", "tile");
    const file = join(PICS, `${row.id}-${i + 1}.webp`);
    if (bytes) writeFileSync(file, bytes);
    shown.push({ page: item.source.url, caption: item.caption, visible: i < (result.set?.visible ?? 0), file });
  }
  capture.subjects[row.id] = { subject: row.subject, kind: row.kind, person: row.person === true, json, search, shown, trace: result.trace };
  writeFileSync(captureFile, JSON.stringify(capture));
  console.log(`[${row.id}] ${row.subject}: ${items.length} pictures (visible ${result.set?.visible ?? 0}) json=${Object.keys(json).length} search=${Object.keys(search).length}${result.trace.skipped ? ` skipped=${result.trace.skipped}` : ""} dropped=${JSON.stringify(result.trace.dropped_by_relevance ?? {})}`);
}
if (blockSignal) console.log(`[answer-images-capture] STOPPED on a block signal: ${blockSignal}`);
process.exit(0);
