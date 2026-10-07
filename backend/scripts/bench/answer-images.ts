// ANSWER-IMG-05: the replay bench for pictures in answers (design:
// data-scratch/research/chat-images-in-answers.md sections 4.3 and 13; rule
// 13). Measurement only: nothing here tunes the pipeline or decides anything
// for a turn.
//
// Every turn runs the real default turn path in this process the way
// routes/turn.ts streams it (runTurnNextStream + streamTurnEvents, the shape
// CHAT-AB-01's arm C uses), against the household's resident chat model on
// the MaiPai Stack, through a loopback stand-in that forwards every request
// unchanged and records, per engine request, the tools offered and the tools
// the model called. Two arms, run in alternating blocks (OFF round 1, ON
// round 1, OFF round 2, ...) so machine drift hits both and the stable
// prefix stays warm inside a block:
//   OFF  the catalog record as shipped (no show_images);
//   ON   the same record with show_images added, as the switch would ship it.
// The arm is this process's own copy of the catalog entry; the source file
// is never touched by this script.
//
// The outside world is a person's: the household's own SearXNG through a
// pass-through tee that stops all searching on the first block signal, and
// Wikidata, Wikipedia and Commons through the pipeline's own per-host pace.
// Every outbound request is tapped; a 403 or 429 from any outside host ends
// the run (THIRD-PARTY-SERVICES.md: back off on the first signal). A turn
// that searched or fetched pictures is followed by a pause.
//
// Pictures shown are written to disk (tile bytes, from the hub's own cache)
// with one contact sheet per turn, to be opened and judged by a person.
//
//   MAIPAI_DATA_DIR=<fresh dir under the OS temp root> \
//   MAIPAI_IMG05_SEARXNG_URL=<the household's SearXNG> \
//   MAIPAI_IMG05_OUT=<output dir> \
//   bun run scripts/bench/answer-images.ts [--repeats 5] [--only id,id] [--arms OFF,ON] [--conversation]
//
// The Stack is the one at MAIPAI_SMOKE_STACK_URL (default
// http://127.0.0.1:8770), already running; this script never starts, stops
// or restarts an engine.
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import dataset from "./datasets/answer-images.json";
import { refuseIfGateRunning, waitForHubQuiet } from "./liveHubQuiet";

type Label = "V" | "N" | "either" | "n/a";
type PersonKey = "owner" | "teen" | "childOff" | "childOn";
type Arm = "OFF" | "ON";
interface Row { id: string; label: Label; person: PersonKey; text: string; setup?: string; subject?: string; spoken?: boolean; zeroPictures?: boolean }

const STACK_URL = (process.env.MAIPAI_SMOKE_STACK_URL ?? "http://127.0.0.1:8770").replace(/\/$/, "");
const OUT = process.env.MAIPAI_IMG05_OUT ?? join(process.cwd(), "..", "data-scratch", "chat-ab", "img05");
const PICS = join(OUT, "pics");
const arg = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : (process.argv[at + 1] ?? null);
};
const REPEATS = Math.max(1, Number(arg("--repeats") ?? 5) || 5);
const ONLY = arg("--only") ? new Set(arg("--only")!.split(",")) : null;
const ARMS = (arg("--arms") ?? "OFF,ON").split(",") as Arm[];
const CONVERSATION = process.argv.includes("--conversation");
const CONVERSATION_ONLY = process.argv.includes("--conversation-only");
const OUTSIDE_PACE_MS = 20_000;
const FORCE = process.argv.includes("--force-beside-gate");
const SHOW = "show_images";

if (!FORCE) refuseIfGateRunning("answer-images");
const searxng = process.env.MAIPAI_IMG05_SEARXNG_URL;
if (!searxng) {
  console.error("answer-images refused: MAIPAI_IMG05_SEARXNG_URL is not set (the household's own SearXNG).");
  process.exit(2);
}
mkdirSync(PICS, { recursive: true });

// ---- the outbound tap: every request this process makes to the outside ----
interface Outbound { host: string; status: number | null; at: number }
const outbound: Outbound[] = [];
let blockSignal: string | null = null;
const realFetch = globalThis.fetch;
const loopback = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (loopback(url.hostname)) return realFetch(input, init);
  const row: Outbound = { host: url.hostname, status: null, at: Date.now() };
  outbound.push(row);
  const response = await realFetch(input, init);
  row.status = response.status;
  // The services this bench drives turn after turn (Wikidata, Wikipedia,
  // Commons and their picture hosts) stop the run on their first 403 or 429;
  // any host's 429 does too. A 403 from one page a search read once is that
  // host's own refusal, already quieted by the product, and is recorded only.
  const driven = /(^|\.)(wikidata|wikipedia|wikimedia)\.org$/.test(url.hostname);
  if ((response.status === 429 || (response.status === 403 && driven)) && !blockSignal) blockSignal = `${response.status} from ${url.hostname}`;
  return response;
}) as typeof fetch;

// ---- the Stack stand-in: forwards everything, records chat requests ----
interface EngineTimings { promptN: number | null; promptMs: number | null; predictedN: number | null; predictedMs: number | null; cacheN: number | null }
interface EngineRequest { offered: string[]; toolChoice: unknown; called: { name: string; args: string }[]; contentToolText: boolean; cachedTokens: number | null; promptTokens: number | null; startAt: number; firstByteAt: number | null; endAt: number | null; timings: EngineTimings | null }
const requests: EngineRequest[] = [];
let engineHeaders = { engine: "unknown", model: "unknown" };

function parseCompletion(raw: string, record: EngineRequest): void {
  const calls = new Map<number, { name: string; args: string }>();
  let content = "";
  const eat = (obj: any) => {
    const choice = obj?.choices?.[0];
    const delta = choice?.delta ?? choice?.message;
    if (typeof delta?.content === "string") content += delta.content;
    for (const [i, call] of ((delta?.tool_calls ?? []) as any[]).entries()) {
      const index = typeof call.index === "number" ? call.index : i;
      const seen = calls.get(index) ?? { name: "", args: "" };
      if (call.function?.name) seen.name += call.function.name;
      if (call.function?.arguments) seen.args += call.function.arguments;
      calls.set(index, seen);
    }
    const usage = obj?.usage;
    if (usage) {
      record.promptTokens = usage.prompt_tokens ?? record.promptTokens;
      record.cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? record.cachedTokens;
    }
    if (obj?.timings?.cache_n !== undefined) record.cachedTokens = obj.timings.cache_n;
    // ANSWER-IMG-05b: the engine's own split of each request's time (prompt
    // evaluation against decoding), to find where a called round's extra goes.
    if (obj?.timings) record.timings = { promptN: obj.timings.prompt_n ?? null, promptMs: obj.timings.prompt_ms ?? null, predictedN: obj.timings.predicted_n ?? null, predictedMs: obj.timings.predicted_ms ?? null, cacheN: obj.timings.cache_n ?? null };
  };
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try { eat(JSON.parse(trimmed)); } catch { /* not JSON */ }
  } else {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { eat(JSON.parse(payload)); } catch { /* partial line */ }
    }
  }
  record.called = [...calls.values()].filter((c) => c.name);
  record.contentToolText = /"name"\s*:\s*"show_images"/.test(content);
}

const standIn = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return Response.json({ status: "ok" });
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    const upstream = await realFetch(`${STACK_URL}${url.pathname}${url.search}`, { method: req.method, headers: req.headers, body, signal: req.signal });
    if (req.method === "POST" && url.pathname === "/v1/chat/completions" && body) {
      const record: EngineRequest = { offered: [], toolChoice: undefined, called: [], contentToolText: false, cachedTokens: null, promptTokens: null, startAt: performance.now(), firstByteAt: null, endAt: null, timings: null };
      try {
        const parsed = JSON.parse(new TextDecoder().decode(body)) as { tools?: { function?: { name?: string } }[]; tool_choice?: unknown };
        record.offered = (parsed.tools ?? []).map((t) => t.function?.name ?? "?");
        record.toolChoice = parsed.tool_choice;
      } catch { /* not JSON */ }
      requests.push(record);
      // MAIPAI_IMG05_DUMP=1: every engine request body to disk, to read the
      // exact prompt and tool block each band sends.
      if (process.env.MAIPAI_IMG05_DUMP === "1") writeFileSync(join(OUT, `request-${String(requests.length).padStart(4, "0")}.json`), new TextDecoder().decode(body));
      engineHeaders = { engine: upstream.headers.get("x-maipai-engine") ?? engineHeaders.engine, model: upstream.headers.get("x-maipai-model") ?? engineHeaders.model };
      if (!upstream.body) return upstream;
      const [mine, theirs] = upstream.body.tee();
      void (async () => {
        const reader = mine.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (record.firstByteAt === null) record.firstByteAt = performance.now();
          chunks.push(value);
        }
        record.endAt = performance.now();
        parseCompletion(new TextDecoder().decode(Buffer.concat(chunks)), record);
      })().catch(() => undefined);
      return new Response(theirs, { status: upstream.status, headers: upstream.headers });
    }
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  },
});
const standInUrl = standIn.url.toString().replace(/\/$/, "");

// ---- the search tee: forwards, counts, stops on the first block signal ----
let searches = 0;
let searchStopped: string | null = null;
const tee = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (searchStopped) return new Response("search stopped by the bench", { status: 503 });
    searches++;
    const upstream = await realFetch(`${searxng.replace(/\/$/, "")}${url.pathname}${url.search}`, { headers: { "user-agent": req.headers.get("user-agent") ?? "MaiPai-Home" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!upstream) return new Response("upstream failed", { status: 502 });
    const text = await upstream.text();
    if (upstream.status === 429 || upstream.status === 403) searchStopped = `${upstream.status} from SearXNG`;
    if (/captcha|too many requests/i.test(text.slice(0, 20_000)) && /unresponsive_engines/.test(text)) {
      try {
        const unresponsive = (JSON.parse(text).unresponsive_engines ?? []) as [string, string][];
        const hit = unresponsive.find(([, why]) => /captcha|too many requests|access denied/i.test(why));
        if (hit) console.log(`[answer-images] SearXNG reports engine ${hit[0]}: ${hit[1]} (its own engine back-off, recorded)`);
      } catch { /* not JSON */ }
    }
    return new Response(text, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
  },
});

process.env.MAIPAI_LLAMA_SERVER_URL = standInUrl;
process.env.MAIPAI_EMBED_URL = standInUrl;

const setup = await import("./setup");
const { setHouseholdSettingValue, setValue } = await import("@/lib/settings");
const { resolveTurnBudget, __setToolOfferOverridesForTests } = await import("@/lib/turnMachine/budget");
const { createConversation, outcomesForConversation } = await import("@/lib/conversationHistory");
const { runTurnNextStream } = await import("@/lib/turnMachine/turnNext");
const { streamTurnEvents } = await import("@/routes/turn");
const { getAnswerImage } = await import("@/lib/answerImages/cache");
const { sqlite, db } = await import("@/db");
const { people } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { newPersonId } = await import("@/lib/id");
const { nextHlc } = await import("@/lib/hlc");
const sharp = (await import("sharp")).default;

await setup.startBench();
setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
const searchSet = setHouseholdSettingValue("search.searxng_url", tee.url.toString().replace(/\/$/, ""));
if (!searchSet.ok) throw new Error(`search setting: ${searchSet.error}`);

const shipped = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult").tools_offered.filter((id) => id !== SHOW);
function useArm(arm: Arm): void {
  __setToolOfferOverridesForTests(arm === "ON" ? [SHOW] : []);
}

function insertPerson(name: string, role: string) {
  const id = newPersonId();
  const now = new Date().toISOString();
  sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, 'bench', 0, ?, ?, ?)").run(id, name, role, id.slice(-12), now, now, nextHlc());
  const row = db.select().from(people).where(eq(people.id, id)).get();
  if (!row) throw new Error(`could not create ${name}`);
  return row;
}
const persons = { owner: insertPerson("Sage", "owner"), teen: insertPerson("Pippa", "teen"), childOff: insertPerson("Bramble", "child"), childOn: insertPerson("Clover", "child") };
insertPerson(dataset.household_member, "adult");
const turnedOn = setValue(persons.owner, `person:${persons.childOn.id}`, "reference.images", true);
if (!turnedOn.ok) throw new Error(`turning pictures on for the child: ${turnedOn.error}`);

interface Picture { id: string; bytes: number; width: number | null; height: number | null; decoded: boolean; file: string | null; dhash: string | null; site: string; caption: string }
interface Run {
  arm: Arm; row: string; label: Label; person: PersonKey; rep: number; text: string;
  offered: boolean; called: string[]; subjects: string[]; textShapedCall: boolean;
  firstTextMs: number | null; totalMs: number; reply: string; error: string | null;
  images: { visible: number; items: number; afterParagraph: number; badge: number; near: [number, number, number][]; pictures: Picture[]; sheet: string | null } | null;
  skipped: string | null; outbound: Record<string, number>; cachedTokens: number | null; promptTokens: number | null;
  outsideTouched: boolean;
  /** The picture pipeline's own admin-only trace for the call. */
  trace: unknown;
  /** Each engine request of the turn, times relative to the turn's start. */
  engine: { startMs: number; firstByteMs: number | null; endMs: number | null; called: string[]; timings: EngineTimings | null }[];
}
const runs: Run[] = [];
const conversationRuns: Run[] = [];

async function dhash(bytes: Uint8Array): Promise<string | null> {
  try {
    const raw = await sharp(bytes).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x]! > raw[y * 9 + x + 1]! ? "1" : "0";
    return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
  } catch {
    return null;
  }
}
function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

async function savePictures(tag: string, band: "adult" | "teen" | "child", items: { id: string; source: { site: string }; caption: string }[]): Promise<{ pictures: Picture[]; sheet: string | null }> {
  const pictures: Picture[] = [];
  const tiles: Buffer[] = [];
  for (const [i, item] of items.entries()) {
    const bytes = await getAnswerImage(item.id, band, "tile");
    const picture: Picture = { id: item.id, bytes: bytes?.length ?? 0, width: null, height: null, decoded: false, file: null, dhash: null, site: item.source.site, caption: item.caption };
    if (bytes) {
      try {
        const meta = await sharp(bytes).metadata();
        picture.width = meta.width ?? null;
        picture.height = meta.height ?? null;
        picture.decoded = Boolean(meta.width && meta.height);
        picture.file = join(PICS, `${tag}-${i + 1}.${meta.format ?? "bin"}`);
        writeFileSync(picture.file, bytes);
        picture.dhash = await dhash(bytes);
        tiles.push(await sharp(bytes).resize(320, 240, { fit: "contain", background: "#808080" }).jpeg().toBuffer());
      } catch {
        picture.decoded = false;
      }
    }
    pictures.push(picture);
  }
  if (tiles.length === 0) return { pictures, sheet: null };
  const sheet = join(PICS, `${tag}-sheet.jpg`);
  await sharp({ create: { width: 330 * tiles.length + 10, height: 250, channels: 3, background: "#ffffff" } })
    .composite(tiles.map((input, i) => ({ input, left: 10 + i * 330, top: 5 })))
    .jpeg({ quality: 80 })
    .toFile(sheet);
  return { pictures, sheet };
}

const bandOf = (key: PersonKey): "adult" | "teen" | "child" => (key === "owner" ? "adult" : key === "teen" ? "teen" : "child");

/** One turn the way routes/turn.ts streams it; the clock starts before the turn begins. */
async function turn(arm: Arm, row: Row, rep: number, conversationId: string | null, tag: string): Promise<{ run: Run; conversationId: string }> {
  const actor = persons[row.person];
  let convo = conversationId;
  if (!convo) {
    const created = createConversation(actor as never, { surface: "chat" });
    if (!created.ok) throw new Error(`createConversation: ${created.error}`);
    convo = created.value.id;
  }
  const reqMark = requests.length;
  const outMark = outbound.length;
  const searchMark = searches;
  const t0 = performance.now();
  let reply = "";
  let firstTextMs: number | null = null;
  let error: string | null = null;
  let imagesEvent: any = null;
  try {
    const result = await runTurnNextStream(actor as never, "chat", row.text, { conversationId: convo, spoken: row.spoken === true });
    if (!result.ok) error = result.error;
    else if (result.kind === "immediate") {
      reply = result.value.reply.text;
      firstTextMs = performance.now() - t0;
    } else {
      for await (const event of streamTurnEvents(result, actor.id, 900, undefined, actor.role === "child" || actor.role === "teen")) {
        if (event.type === "delta") {
          reply += event.text;
          if (firstTextMs === null && event.text.trim()) firstTextMs = performance.now() - t0;
        } else if (event.type === "images") imagesEvent = event;
        else if (event.type === "done") {
          if (!reply.trim()) reply = event.value.reply.text;
          if (firstTextMs === null && reply.trim()) firstTextMs = performance.now() - t0;
        } else if (event.type === "error") error = `${event.code ?? "error"}: ${event.error}`;
      }
    }
  } catch (err) {
    error = (err as Error).message;
  }
  const totalMs = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 300)); // the tee's parse of the last stream
  const mine = requests.slice(reqMark);
  const offered = mine.some((r) => r.offered.includes(SHOW));
  const outcomes = outcomesForConversation(convo, 5).at(-1)?.outcomes ?? [];
  const called = [...new Set([...mine.flatMap((r) => r.called.map((c) => c.name)), ...outcomes.filter((o) => o.via === "tool_call" || o.via === undefined).map((o) => o.packageId)])].sort();
  const subjects = [
    ...mine.flatMap((r) => r.called.filter((c) => c.name === SHOW).map((c) => { try { return String(JSON.parse(c.args).subject ?? ""); } catch { return c.args; } })),
  ];
  const showOutcome = outcomes.find((o) => o.packageId === SHOW);
  let skipped: string | null = null;
  let trace: unknown = null;
  if (showOutcome && typeof (showOutcome as { detail?: unknown }).detail === "string") {
    try { trace = JSON.parse((showOutcome as { detail: string }).detail); skipped = (trace as { skipped?: string }).skipped ?? null; } catch { /* not JSON */ }
  }
  const out: Record<string, number> = {};
  for (const o of outbound.slice(outMark)) out[`${o.host} ${o.status ?? "-"}`] = (out[`${o.host} ${o.status ?? "-"}`] ?? 0) + 1;
  let images: Run["images"] = null;
  if (imagesEvent) {
    const saved = await savePictures(tag, bandOf(row.person), imagesEvent.items);
    // Near-duplicate candidates for the person judging the sheets (dhash
    // distance of 10 or less); the person's eye decides, not this number.
    const near: [number, number, number][] = [];
    saved.pictures.forEach((a, i) => saved.pictures.forEach((b, j) => {
      if (j > i && a.dhash && b.dhash && hamming(a.dhash, b.dhash) <= 10) near.push([i + 1, j + 1, hamming(a.dhash, b.dhash)]);
    }));
    images = { visible: imagesEvent.visible, items: imagesEvent.items.length, afterParagraph: imagesEvent.after_paragraph, badge: imagesEvent.items.length - imagesEvent.visible, near, ...saved };
  }
  const run: Run = {
    arm, row: row.id, label: row.label, person: row.person, rep, text: row.text,
    offered, called, subjects, textShapedCall: mine.some((r) => r.contentToolText),
    firstTextMs, totalMs, reply, error, images, skipped, outbound: out,
    cachedTokens: mine[0]?.cachedTokens ?? null, promptTokens: mine[0]?.promptTokens ?? null,
    outsideTouched: searches > searchMark || outbound.length > outMark,
    trace,
    engine: mine.map((r) => ({ startMs: r.startAt - t0, firstByteMs: r.firstByteAt === null ? null : r.firstByteAt - t0, endMs: r.endAt === null ? null : r.endAt - t0, called: r.called.map((c) => c.name), timings: r.timings })),
  };
  return { run, conversationId: convo };
}

const hubLog = process.env.MAIPAI_HUB_LOG;
let lastOutside = 0;
async function paced(): Promise<void> {
  const since = Date.now() - lastOutside;
  if (lastOutside > 0 && since < OUTSIDE_PACE_MS) await new Promise((r) => setTimeout(r, OUTSIDE_PACE_MS - since));
  if (hubLog) await waitForHubQuiet(hubLog, (m) => console.log(m));
}

function environment(): Record<string, unknown> {
  const sh = (cmd: string) => { try { return execSync(cmd, { encoding: "utf-8" }).trim(); } catch { return "n/a"; } };
  return {
    date: new Date().toISOString(),
    engineBuild: engineHeaders.engine,
    modelFile: engineHeaders.model,
    hardware: `${sh("sysctl -n machdep.cpu.brand_string")}, ${Math.round(Number(sh("sysctl -n hw.memsize")) / 1024 ** 3)} GB unified memory`,
    loadAtEnd: loadavg().map((n) => n.toFixed(2)).join(" "),
    repeats: REPEATS,
    arms: { OFF: shipped, ON: [...shipped, SHOW].sort() },
    sampling: "production: the turn path's own sampling, thinking off (the default toggle)",
    searches, searchStopped, blockSignal,
  };
}
function save(): void {
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ environment: environment(), runs, conversationRuns }, null, 2));
}

const rows = (dataset.rows as Row[]).filter((r) => !ONLY || ONLY.has(r.id));
try {
  if (!CONVERSATION_ONLY) {
    for (let rep = 1; rep <= REPEATS && !blockSignal && !searchStopped; rep++) {
      for (const arm of ARMS) {
        useArm(arm);
        for (const row of rows) {
          if (arm === "OFF" && (row.label === "n/a" || row.label === "either")) continue;
          if (blockSignal || searchStopped) break;
          await paced();
          let convo: string | null = null;
          if (row.setup) {
            const first = await turn(arm, { ...row, text: row.setup }, rep, null, `${row.id}-${arm}-${rep}-setup`);
            convo = first.conversationId;
            if (first.run.outsideTouched) { lastOutside = Date.now(); await paced(); }
          }
          const { run } = await turn(arm, row, rep, convo, `${row.id}-${arm}-${rep}`);
          runs.push(run);
          if (run.outsideTouched) lastOutside = Date.now();
          console.log(`[${arm} r${rep}] ${row.id} (${row.label}) offered=${run.offered} called=[${run.called.join(",")}]${run.subjects.length ? ` subject=${JSON.stringify(run.subjects)}` : ""} first=${run.firstTextMs === null ? "none" : Math.round(run.firstTextMs)}ms total=${Math.round(run.totalMs)}ms pictures=${run.images ? `${run.images.items} (visible ${run.images.visible}, after_paragraph ${run.images.afterParagraph})` : "none"}${run.skipped ? ` skipped=${run.skipped}` : ""}${run.error ? ` ERROR=${run.error}` : ""}`);
          save();
        }
      }
    }
  }
  if ((CONVERSATION || CONVERSATION_ONLY) && !blockSignal && !searchStopped) {
    useArm("ON");
    let convo: string | null = null;
    for (const [i, text] of dataset.non_visual_conversation.entries()) {
      await paced();
      const { run, conversationId } = await turn("ON", { id: `conv-${i + 1}`, label: "N", person: "owner", text }, 1, convo, `conv-${i + 1}`);
      convo = conversationId;
      conversationRuns.push(run);
      if (run.outsideTouched) lastOutside = Date.now();
      console.log(`[conv ${i + 1}] called=[${run.called.join(",")}] first=${run.firstTextMs === null ? "none" : Math.round(run.firstTextMs)}ms "${text}"`);
      save();
    }
  }
} finally {
  save();
  if (blockSignal) console.log(`[answer-images] STOPPED on a block signal: ${blockSignal}`);
  if (searchStopped) console.log(`[answer-images] search STOPPED: ${searchStopped}`);
  standIn.stop(true);
  tee.stop(true);
}
setup.finishBench({ executed: runs.length + conversationRuns.length, engine: `chat on the Stack (${engineHeaders.engine}, ${engineHeaders.model})` });
