// IMGQ-05: the judged live sample for pictures in answers (design:
// data-scratch/research/image-quality-design.md section 13, item 6). Runs the
// real picture pipeline (`selectAnswerImages`) for each subject in
// datasets/answer-images-sample.json, at a person's pace, and writes every
// tile shown, one contact sheet per subject (visible row first) and a judging
// sheet (`judging.json`) with one entry per tile for a person to mark
// right, wrong_subject, private_person or junk. `--score` reads a judged
// sheet back and prints the bars. Measurement only: nothing here tunes the
// pipeline. No chat model is involved; the engine variables are only the
// shared bench setup's own refusal checks.
//
//   MAIPAI_DATA_DIR=<fresh dir under the OS temp root> \
//   MAIPAI_LLAMA_SERVER_URL=<the running Stack> MAIPAI_EMBED_URL=<the running Stack> \
//   MAIPAI_IMG05_SEARXNG_URL=<the household's SearXNG> MAIPAI_IMG05_OUT=<output dir> \
//   bun run scripts/bench/answer-images-sample.ts [--only id,id] [--band adult|teen]
//
//   bun run scripts/bench/answer-images-sample.ts --score <output dir>/judging.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import dataset from "./datasets/answer-images-sample.json";

type Label = "right" | "wrong_subject" | "private_person" | "junk" | null;
interface Tile { file: string; visible: boolean; caption: string; site: string; page: string; label: Label; note: string }
interface Entry { id: string; subject: string; kind: string; person: boolean; band: string; shown: number; visible: number; skipped: string | null; trace: unknown; sheet: string | null; tiles: Tile[] }

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : (process.argv[at + 1] ?? null);
};

const scorePath = arg("--score");
if (scorePath) {
  const entries = JSON.parse(readFileSync(scorePath, "utf-8")) as Entry[];
  const unjudged = entries.flatMap((e) => e.tiles.filter((t) => t.label === null).map((t) => t.file));
  const visible = entries.flatMap((e) => e.tiles.filter((t) => t.visible).map((t) => ({ ...t, entry: e })));
  const wrongQuestions = entries.filter((e) => e.tiles.some((t) => t.visible && t.label === "wrong_subject"));
  const strangers = visible.filter((t) => !t.entry.person && t.label === "private_person");
  const junk = entries.flatMap((e) => e.tiles).filter((t) => t.label === "junk");
  console.log(`subjects ${entries.length}; with pictures ${entries.filter((e) => e.shown > 0).length}; tiles ${entries.reduce((n, e) => n + e.tiles.length, 0)} (visible ${visible.length}); unjudged ${unjudged.length}`);
  console.log(`junk (broken, placeholder, duplicate) tiles: ${junk.length} (bar 0)`);
  console.log(`questions with a wrong-subject visible tile: ${wrongQuestions.length} (bar at most 1)${wrongQuestions.length ? `: ${wrongQuestions.map((e) => e.id).join(", ")}` : ""}`);
  console.log(`private people in a thing's visible row: ${strangers.length} (bar 0)${strangers.length ? `: ${strangers.map((t) => t.file).join(", ")}` : ""}`);
  process.exit(0);
}

const OUT = process.env.MAIPAI_IMG05_OUT;
const searxng = process.env.MAIPAI_IMG05_SEARXNG_URL;
if (!OUT || !searxng) {
  console.error("answer-images-sample refused: MAIPAI_IMG05_OUT and MAIPAI_IMG05_SEARXNG_URL must be set.");
  process.exit(2);
}
const PICS = join(OUT, "pics");
mkdirSync(PICS, { recursive: true });
const BAND = (arg("--band") ?? "adult") as "adult" | "teen";
const ONLY = arg("--only") ? new Set(arg("--only")!.split(",")) : null;
// A person's pace: a pause after every subject (THIRD-PARTY-SERVICES.md).
const PACE_MS = 15_000;

// Every outbound request is tapped; a 429, or a 403 from a Wikimedia host,
// stops the run (back off on the first signal).
let blockSignal: string | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const response = await realFetch(input, init);
  const driven = /(^|\.)(wikidata|wikipedia|wikimedia)\.org$/.test(url.hostname);
  if ((response.status === 429 || (response.status === 403 && driven)) && !blockSignal) blockSignal = `${response.status} from ${url.hostname}`;
  return response;
}) as typeof fetch;

const setup = await import("./setup");
const { setHouseholdSettingValue } = await import("@/lib/settings");
const { selectAnswerImages } = await import("@/lib/answerImages/select");
const { getAnswerImage } = await import("@/lib/answerImages/cache");
const { createBenchPeople } = await import("./conversationRunner");
const sharp = (await import("sharp")).default;

await setup.startBench();
const set = setHouseholdSettingValue("search.searxng_url", searxng);
if (!set.ok) throw new Error(`search setting: ${set.error}`);
const people = createBenchPeople();
const actor = BAND === "teen" ? people.child : people.owner;

const entries: Entry[] = [];
const rows = (dataset.subjects as { id: string; subject: string; kind: string; person?: boolean }[]).filter((r) => !ONLY || ONLY.has(r.id));
for (const [n, row] of rows.entries()) {
  if (blockSignal) break;
  if (n > 0) await new Promise((r) => setTimeout(r, PACE_MS));
  const started = performance.now();
  const result = await selectAnswerImages({ subject: row.subject, actor, band: BAND, roster: [], deadlineAt: Date.now() + 3_000 });
  const ms = Math.round(performance.now() - started);
  const items = result.set?.items ?? [];
  const tiles: Tile[] = [];
  const sheetTiles: Buffer[] = [];
  for (const [i, item] of items.entries()) {
    const bytes = await getAnswerImage(item.id, BAND, "tile");
    const file = join(PICS, `${row.id}-${i + 1}.webp`);
    if (bytes) {
      writeFileSync(file, bytes);
      sheetTiles.push(await sharp(bytes).resize(320, 240, { fit: "contain", background: i < (result.set?.visible ?? 0) ? "#808080" : "#c8c8c8" }).jpeg().toBuffer());
    }
    tiles.push({ file, visible: i < (result.set?.visible ?? 0), caption: item.caption, site: item.source.site, page: item.source.url, label: bytes ? null : "junk", note: bytes ? "" : "tile bytes missing" });
  }
  let sheet: string | null = null;
  if (sheetTiles.length > 0) {
    sheet = join(PICS, `${row.id}-sheet.jpg`);
    await sharp({ create: { width: 330 * sheetTiles.length + 10, height: 250, channels: 3, background: "#ffffff" } })
      .composite(sheetTiles.map((input, i) => ({ input, left: 10 + i * 330, top: 5 })))
      .jpeg({ quality: 80 })
      .toFile(sheet);
  }
  entries.push({ id: row.id, subject: row.subject, kind: row.kind, person: row.person === true, band: BAND, shown: items.length, visible: result.set?.visible ?? 0, skipped: result.trace.skipped ?? null, trace: result.trace, sheet, tiles });
  writeFileSync(join(OUT, "judging.json"), JSON.stringify(entries, null, 2));
  console.log(`[${row.id}] ${row.subject}: ${items.length} pictures (visible ${result.set?.visible ?? 0})${result.trace.skipped ? ` skipped=${result.trace.skipped}` : ""} ${ms}ms dropped=${JSON.stringify(result.trace.dropped_by_relevance ?? {})} quality=${JSON.stringify(result.trace.dropped_by_quality ?? {})}`);
}
if (blockSignal) console.log(`[answer-images-sample] STOPPED on a block signal: ${blockSignal}`);
setup.finishBench({ executed: entries.length, engine: "picture pipeline only (no chat model)" });
