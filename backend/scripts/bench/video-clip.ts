// VIDEO-GEN-07: times one clip made through Home against a scratch Stack and records the result. Not part of
// check.sh (it needs the video model, the GPU and about two and a half minutes).
//
//   VIDEO_BENCH_HOME=http://127.0.0.1:18890 VIDEO_BENCH_NAME=Sage VIDEO_BENCH_SECRET=<test passcode> \
//   VIDEO_BENCH_OUT=/path/to/out bun backend/scripts/bench/video-clip.ts
//
// Home must be a scratch one (own data directory, its Stack URL pointing at a scratch Stack). The script signs in
// with the test credentials it is given (or creates the first person when Home has none), starts the clip the way a
// chat turn does (POST /api/turn/stream with an ordinary request, so the model's tool call, the gates and the
// handoff are all in the measurement), then polls the card route the chat UI polls and records:
//   - turn_ms: from the request to the end of the reply stream (the answer is never held by the clip);
//   - first_progress_ms: the first poll that shows rendering or decoding;
//   - clip_ms: the request to a finished clip on the card;
//   - the phases seen with their first-seen times, the clip's size in bytes, and a Range request check.
// It takes the shared GPU lock (mkdir /private/tmp/claude-501/bench.lock) for the run and always releases it; a caller
// that already holds the lock sets VIDEO_BENCH_HAVE_LOCK=1 and keeps it.
import { mkdirSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOME = (process.env.VIDEO_BENCH_HOME ?? "").replace(/\/$/, "");
const NAME = process.env.VIDEO_BENCH_NAME ?? "";
const SECRET = process.env.VIDEO_BENCH_SECRET ?? "";
const PROMPT = process.env.VIDEO_BENCH_PROMPT ?? "make a short video of a paper boat in the rain";
const OUT = process.env.VIDEO_BENCH_OUT ?? "";
const LOCK = process.env.VIDEO_BENCH_LOCK ?? "/private/tmp/claude-501/bench.lock";
const HAVE_LOCK = process.env.VIDEO_BENCH_HAVE_LOCK === "1";
const MAX_MS = Number(process.env.VIDEO_BENCH_MAX_MS ?? 900_000);
if (!HOME || !NAME || !SECRET || !OUT) throw new Error("Set VIDEO_BENCH_HOME, VIDEO_BENCH_NAME, VIDEO_BENCH_SECRET and VIDEO_BENCH_OUT.");
if (/:(3000|8787|8770)\b/.test(HOME)) throw new Error("This bench is for a scratch Home, never the live one.");
mkdirSync(OUT, { recursive: true });

async function takeLock(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    try { mkdirSync(LOCK); return; } catch { await new Promise((r) => setTimeout(r, 30_000)); }
  }
  throw new Error("The GPU lock stayed taken for an hour.");
}

let cookie = "";
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(HOME + path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(cookie ? { cookie } : {}) } });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(",").map((c) => c.split(";")[0]).join("; ");
  return res;
}
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function signIn(): Promise<void> {
  const profiles = await (await call("/api/auth/profiles")).json() as Array<{ id: string; display_name: string }>;
  const found = Array.isArray(profiles) ? profiles.find((p) => p.display_name === NAME) : undefined;
  if (found) {
    const res = await post("/api/auth/verify-secret", { personId: found.id, secret: SECRET });
    if (!res.ok) throw new Error(`Could not sign in ${NAME}: ${res.status}`);
    return;
  }
  const res = await post("/api/auth/setup", { displayName: NAME, secret: SECRET });
  if (!res.ok) throw new Error(`Could not set up ${NAME}: ${res.status}`);
}

interface Card { items: Array<{ id: string; state: string; percent: number; label: string; clip: { url: string; file_id: string } | null; error: string | null }> }

if (!HAVE_LOCK) await takeLock();
const results: Record<string, unknown> = { prompt_chars: PROMPT.length, started_at: new Date().toISOString() };
try {
  await signIn();
  const t0 = Date.now();
  const turn = await post("/api/turn/stream", { text: PROMPT, surface: "chat" });
  if (!turn.ok) throw new Error(`The turn was refused: ${turn.status}`);
  const text = await turn.text();
  const turnMs = Date.now() - t0;
  const events = text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as Record<string, any>; } catch { return {}; } });
  const done = events.find((e) => e.type === "done") as { value?: { video?: { id: string }; reply?: { text?: string } } } | undefined;
  const jobId = done?.value?.video?.id;
  results.turn_ms = turnMs;
  results.tool_called = events.some((e) => e.t === "tool_call" && e.package_id === "generate_video");
  results.reply_chars = done?.value?.reply?.text?.length ?? 0;
  if (!jobId) throw new Error("The turn did not start a video (the model did not call the tool, or it was refused).");
  const phases: Record<string, number> = {};
  let firstProgress: number | null = null;
  let card: Card | null = null;
  while (Date.now() - t0 < MAX_MS) {
    const res = await call(`/api/videos/jobs/${jobId}`);
    card = await res.json() as Card;
    const item = card.items[card.items.length - 1]!;
    const phase = `${item.state}:${item.label}`;
    if (!(phase in phases)) phases[phase] = Date.now() - t0;
    if (firstProgress === null && item.percent > 0 && item.state === "running") firstProgress = Date.now() - t0;
    if (item.state === "done" || item.state === "failed" || item.state === "cancelled") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const item = card?.items[card.items.length - 1];
  results.final_state = item?.state ?? "unknown";
  results.error = item?.error ?? null;
  results.phases_first_seen_ms = phases;
  results.first_progress_ms = firstProgress;
  if (item?.state === "done" && item.clip) {
    results.clip_ms = Date.now() - t0;
    const whole = await call(item.clip.url);
    const bytes = new Uint8Array(await whole.arrayBuffer());
    writeFileSync(join(OUT, "clip.mp4"), bytes);
    results.clip_bytes = bytes.byteLength;
    results.content_type = whole.headers.get("content-type");
    const part = await call(item.clip.url, { headers: { Range: "bytes=0-1023" } });
    results.range_status = part.status;
    results.range_content_range = part.headers.get("content-range");
  }
} finally {
  results.finished_at = new Date().toISOString();
  writeFileSync(join(OUT, "result.json"), JSON.stringify(results, null, 2));
  if (!HAVE_LOCK) { try { rmdirSync(LOCK); } catch { /* released already */ } }
  console.log(JSON.stringify(results, null, 2));
}
