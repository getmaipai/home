// SMOKE-CHAT-01: a one-command, REAL end-to-end chat smoke test.
//
//   bun run smoke:chat            (from the repo root or backend/)
//   bun run smoke:chat --force-beside-gate
//
// Starts a scratch Home (the backend only, the same spawn the screenshot
// script uses) in a throwaway data directory under the OS temp root on an
// OS-assigned port, never 8787 and never the live data/ folder, pointed at
// the MaiPai Stack that is already running (MAIPAI_SMOKE_STACK_URL,
// default http://127.0.0.1:8770; the Stack loads its own engine on demand,
// this script never starts an engine). It seeds a demo household (persona
// roster names only), signs in through the real login routes and drives the
// real POST /api/turn/stream (NDJSON) the way the web chat does, one request
// at a time. Exit code 0 only when no turn FAILed.
//
// Web search: the scratch Home needs a SearXNG. MAIPAI_SMOKE_SEARXNG_URL
// names one; when unset the household's own configured instance is read
// (read-only, never printed) from the live hub's database. A search turn is
// ordinary person-paced traffic, with a pause between consecutive searches.
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { reserveFreePort } from "../../tests/fixtures/reserveFreePort";
import { runningGates } from "../bench/liveHubQuiet";
import { waitForBackendPort } from "../../../scripts/screenshotRuntime";
import { judgeTurn, parseVmStat, wordCount, type TurnObservation, type TurnSpec, type TurnVerdict } from "./chatChecks";

const BACKEND_DIR = join(import.meta.dir, "..", "..");
// The household's own database, opened read-only for one setting. A worktree
// (<repo>/.claude/worktrees/<name>) has no data/ of its own, so the main
// checkout's is tried too.
const LIVE_DB = [join(BACKEND_DIR, "..", "data", "hub.db"), join(BACKEND_DIR, "..", "..", "..", "..", "data", "hub.db")].find((path) => existsSync(path)) ?? "";
const STACK_URL = (process.env.MAIPAI_SMOKE_STACK_URL ?? "http://127.0.0.1:8770").replace(/\/$/, "");
const TURN_TIMEOUT_MS = 5 * 60_000;
const SEARCH_PACE_MS = 20_000;
const MEMORY_503_WAIT_MS = 60_000;
const SECRET = "correcthorsebattery";
const FORCE = process.argv.includes("--force-beside-gate");
// MAIPAI_SMOKE_ONLY=adult-search,adult-followup runs just those turns, in order (a measurement run).
const ONLY = process.env.MAIPAI_SMOKE_ONLY ? process.env.MAIPAI_SMOKE_ONLY.split(",") : null;

const TURNS: TurnSpec[] = [
  { id: "adult-search", person: "adult", text: "when is the new avengers movie coming out" },
  { id: "adult-followup", person: "adult", text: "and is robert downey in it", followUp: true, expectSearch: true },
  { id: "adult-long", person: "adult", text: "explain in detail how a heat pump works", minWords: 150 },
  { id: "child-plain", person: "child", text: "why is the sky blue", maxWords: 120 },
  { id: "adult-spoken", person: "adult", text: "tell me one fun fact about octopuses", spoken: true, maxWords: 80 },
];

if (ONLY) {
  const unknown = ONLY.filter((id) => !TURNS.some((turn) => turn.id === id));
  if (unknown.length > 0) {
    console.error(`smoke:chat: MAIPAI_SMOKE_ONLY names unknown turns: ${unknown.join(", ")} (known: ${TURNS.map((turn) => turn.id).join(", ")})`);
    process.exit(2);
  }
}

function fail(message: string): never {
  console.error(`smoke:chat: ${message}`);
  process.exit(2);
}

/** Never beside a gate: a gate and a live engine turn both want the machine. */
function refuseBesideGate(): void {
  const busy = runningGates();
  if (busy.length === 0) return;
  const list = busy.map(([pid, cwd]) => `${pid}${cwd ? ` in ${cwd}` : ""}`).join(", ");
  if (FORCE) {
    console.warn(`smoke:chat: WARNING, running beside a gate (${list}) because --force-beside-gate was given; timings will be inflated.`);
    return;
  }
  console.error(`smoke:chat refused: a gate (scripts/check.sh, bun test or vite build) is running (${list}). Latency and memory numbers mean nothing beside one, and both want the machine. Wait for it to finish, or pass --force-beside-gate to run anyway.`);
  process.exit(2);
}

function liveSearxngUrl(): string | null {
  if (process.env.MAIPAI_SMOKE_SEARXNG_URL) return process.env.MAIPAI_SMOKE_SEARXNG_URL;
  if (!LIVE_DB) return null;
  try {
    const db = new Database(LIVE_DB, { readonly: true });
    try {
      const row = db.query("select value from settings_values where scope = 'household' and key = 'search.searxng_url'").get() as { value: string } | null;
      if (!row) return null;
      const parsed = JSON.parse(row.value);
      return typeof parsed === "string" && parsed ? parsed : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function machineState(): string {
  const lines: string[] = [];
  const load = loadavg().map((n) => n.toFixed(2)).join(" ");
  lines.push(`load average (1/5/15 min): ${load}`);
  try {
    const vm = Bun.spawnSync({ cmd: ["vm_stat"], stdout: "pipe", stderr: "ignore" });
    const parsed = vm.exitCode === 0 ? parseVmStat(new TextDecoder().decode(vm.stdout)) : null;
    if (parsed) lines.push(`vm_stat: free ${parsed.freeGb} GB, inactive ${parsed.inactiveGb} GB, wired ${parsed.wiredGb} GB, compressed ${parsed.compressedGb} GB`);
    const pressure = Bun.spawnSync({ cmd: ["memory_pressure", "-Q"], stdout: "pipe", stderr: "ignore" });
    const free = pressure.exitCode === 0 ? /free percentage:\s*(\d+)%/.exec(new TextDecoder().decode(pressure.stdout))?.[1] : null;
    if (free) lines.push(`memory pressure: ${free}% of memory free system-wide`);
  } catch {
    lines.push("vm_stat unavailable on this machine");
  }
  return lines.join("\n  ");
}

async function stackEngineLine(): Promise<string> {
  try {
    const response = await fetch(`${STACK_URL}/stack/v1/roles`, { signal: AbortSignal.timeout(5000) });
    const roles = (await response.json()) as { roles: { id: string; model: { id: string } | null; identity?: { actual: string | null } }[] };
    const chat = roles.roles.find((role) => role.id === "chat");
    return `Stack chat role: model ${chat?.model?.id ?? "not loaded yet"}, file ${chat?.identity?.actual ?? "unknown"}`;
  } catch (error) {
    return `Stack roles unreadable (${(error as Error).message})`;
  }
}

interface Session {
  cookie: string;
  personId: string;
}

async function api(base: string, path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.cookie) headers.set("Cookie", init.cookie);
  return fetch(`${base}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
}

const cookieOf = (response: Response): string => {
  const value = response.headers.get("set-cookie")?.split(";")[0];
  if (!value) throw new Error(`no session cookie from ${response.url}`);
  return value;
};

/** Seeds the demo household and signs both people in through the real routes. */
async function seedAndLogin(base: string, searxng: string | null): Promise<{ adult: Session; child: Session }> {
  const setup = await api(base, "/api/auth/setup", { method: "POST", body: JSON.stringify({ displayName: "Sage", secret: SECRET }) });
  if (!setup.ok) throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
  const setupCookie = cookieOf(setup);
  const settings: [string, unknown][] = [["engines.stack.url", STACK_URL], ["engines.stack.use_chat", true], ["engines.stack.use_embeddings", true]];
  if (searxng) settings.push(["search.searxng_url", searxng]);
  for (const [key, value] of settings) {
    const response = await api(base, "/api/settings", { method: "PUT", cookie: setupCookie, body: JSON.stringify({ scope: "household", key, value }) });
    if (!response.ok) throw new Error(`setting ${key} failed: ${response.status} ${await response.text()}`);
  }
  const created = await api(base, "/api/people", { method: "POST", cookie: setupCookie, body: JSON.stringify({ displayName: "Nova", role: "child" }) });
  if (!created.ok) throw new Error(`creating the demo child failed: ${created.status} ${await created.text()}`);
  const roster = (await (await api(base, "/api/people", { cookie: setupCookie })).json()) as { id: string; display_name: string }[];
  const sage = roster.find((person) => person.display_name === "Sage");
  const nova = roster.find((person) => person.display_name === "Nova");
  if (!sage || !nova) throw new Error("the seeded roster is missing Sage or Nova");
  // The real login routes: the adult proves a secret, the child is a bare tap.
  const adultLogin = await api(base, "/api/auth/verify-secret", { method: "POST", body: JSON.stringify({ personId: sage.id, secret: SECRET }) });
  if (!adultLogin.ok) throw new Error(`adult login failed: ${adultLogin.status} ${await adultLogin.text()}`);
  const childLogin = await api(base, "/api/auth/select", { method: "POST", body: JSON.stringify({ personId: nova.id }) });
  if (!childLogin.ok) throw new Error(`child login failed: ${childLogin.status} ${await childLogin.text()}`);
  return { adult: { cookie: cookieOf(adultLogin), personId: sage.id }, child: { cookie: cookieOf(childLogin), personId: nova.id } };
}

interface Streamed {
  observation: TurnObservation;
  conversationId: string | null;
  engine: string | null;
  unavailable: boolean;
}

/** One turn through POST /api/turn/stream, read as NDJSON like the web chat. */
async function streamTurn(base: string, session: Session, spec: TurnSpec, conversationId: string | null): Promise<Streamed> {
  const started = performance.now();
  const body: Record<string, unknown> = { surface: "chat", text: spec.text };
  if (spec.spoken) body.spoken = true;
  if (conversationId) body.conversation_id = conversationId;
  let reply = "";
  let firstDeltaMs: number | null = null;
  let tool: string | null = null;
  let sources = 0;
  let failure: string | null = null;
  let unavailable = false;
  let httpStatus = 0;
  let convo: string | null = conversationId;
  let engine: string | null = null;
  try {
    const response = await api(base, "/api/turn/stream", { method: "POST", cookie: session.cookie, body: JSON.stringify(body), signal: AbortSignal.timeout(TURN_TIMEOUT_MS) });
    httpStatus = response.status;
    if (!response.ok || !response.body) {
      failure = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
      unavailable = response.status === 503;
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (line: string): void => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as Record<string, any>;
        if (event.type === "turn_meta") convo = event.conversation_id ?? convo;
        else if (event.type === "delta") {
          if (firstDeltaMs === null) firstDeltaMs = Math.round(performance.now() - started);
          reply += event.text;
        } else if (event.type === "error") {
          failure = `${event.code ?? "error"}: ${event.error}`;
          unavailable = event.code === "unavailable";
        } else if (event.type === "done") {
          const value = event.value ?? {};
          sources = Array.isArray(value.sources) ? value.sources.length : 0;
          tool = value.plugin_id ?? (value.rung === "search" || sources > 0 ? "websearch" : null);
          if (value.rung === "failed") failure = failure ?? "rung failed";
          engine = value.stats?.engine ?? null;
          if (!reply && typeof value.reply?.text === "string") reply = value.reply.text;
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(handle);
      }
      handle(buffer);
    }
  } catch (error) {
    failure = `request failed: ${(error as Error).message}`;
  }
  return { observation: { httpStatus, reply, firstDeltaMs, totalMs: Math.round(performance.now() - started), tool, sources, failure }, conversationId: convo, engine, unavailable };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const trimmed = (text: string, max = 400): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}... (${wordCount(text)} words)` : flat;
};

async function portIsFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return false; // something answered
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  refuseBesideGate();
  const stackProbe = await fetch(`${STACK_URL}/stack/v1/roles`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!stackProbe?.ok) fail(`the Stack does not answer at ${STACK_URL}/stack/v1/roles; it must already be running (this script never starts an engine).`);
  const searxng = liveSearxngUrl();
  if (!searxng) console.warn("smoke:chat: WARNING, no SearXNG URL (set MAIPAI_SMOKE_SEARXNG_URL); search turns will report it.");

  const dataDir = mkdtempSync(join(tmpdir(), "maipai-home-smoke-"));
  const kiwixPort = reserveFreePort();
  const backend = Bun.spawn({
    cmd: ["bun", "run", "src/index.ts"],
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", // a throwaway hub opts out of the machine-wide one-hub lock
      MAIPAI_MDNS: "off", // a scratch Home never advertises on the LAN (MDNS-HOST-01)
      PORT: "0",
      MAIPAI_DATA_DIR: dataDir,
      MAIPAI_BACKUP_DIR: join(dataDir, "backups"),
      MAIPAI_KEYSTORE_BACKEND: "file", // never the login keychain
      MAIPAI_TTS_DISABLE_SPAWN: "1",
      MAIPAI_KIWIX_PORT: String(kiwixPort),
      MAIPAI_WYOMING_PORT: "0",
      MAIPAI_BACKGROUND_URL: "http://127.0.0.1:1", // the memory judge never spawns its own engine
      MAIPAI_LLAMA_SERVER_URL: "",
      MAIPAI_EMBED_URL: "",
    },
    stdout: "pipe",
    stderr: "ignore",
  });
  let port = 0;
  let results: { spec: TurnSpec; seen: TurnObservation; verdict: TurnVerdict; retried: boolean }[] = [];
  let engineSeen: string | null = null;
  let exitCode = 1;
  try {
    const out = backend.stdout;
    if (!out || typeof out === "number") throw new Error("the scratch Home gave no stdout");
    port = await waitForBackendPort(out, 60_000);
    if (port === 8787) throw new Error("the scratch Home bound 8787, which is the live app's port");
    const base = `http://127.0.0.1:${port}`;
    console.log(`smoke:chat: scratch Home on port ${port}, data in a throwaway directory, Stack at ${STACK_URL}`);
    const people = await seedAndLogin(base, searxng);
    let conversation: string | null = null;
    let previousSearched = false;
    for (const spec of TURNS.filter((turn) => !ONLY || ONLY.includes(turn.id))) {
      const session = spec.person === "adult" ? people.adult : people.child;
      if (previousSearched) await sleep(SEARCH_PACE_MS);
      let streamed = await streamTurn(base, session, spec, spec.followUp ? conversation : null);
      let retried = false;
      if (streamed.unavailable) {
        console.log(`  [${spec.id}] the Stack answered unavailable, reason verbatim: ${streamed.observation.failure}`);
        console.log(`  [${spec.id}] waiting ${MEMORY_503_WAIT_MS / 1000}s, then one retry`);
        await sleep(MEMORY_503_WAIT_MS);
        streamed = await streamTurn(base, session, spec, spec.followUp ? conversation : null);
        retried = true;
      }
      if (spec.person === "adult" && !spec.spoken) conversation = streamed.conversationId;
      engineSeen = streamed.engine ?? engineSeen;
      previousSearched = streamed.observation.tool === "websearch";
      const verdict = judgeTurn(spec, streamed.observation);
      results.push({ spec, seen: streamed.observation, verdict, retried });
      const o = streamed.observation;
      console.log(`\n[${verdict.verdict}] ${spec.id} (${spec.person}${spec.spoken ? ", spoken" : ""}${spec.followUp ? ", follow-up" : ""}${retried ? ", after retry" : ""}): "${spec.text}"`);
      console.log(`  reply: ${trimmed(o.reply) || "(empty)"}`);
      console.log(`  first delta ${o.firstDeltaMs === null ? "none" : `${o.firstDeltaMs} ms`}, total ${o.totalMs} ms, ${wordCount(o.reply)} words, tool: ${o.tool ?? "none"}, sources: ${o.sources}, failure: ${o.failure ?? "none"}`);
      for (const text of verdict.fails) console.log(`  FAIL: ${text}`);
      for (const text of verdict.warns) console.log(`  WARN: ${text}`);
    }
    const fails = results.filter((r) => r.verdict.verdict === "FAIL").length;
    const warns = results.filter((r) => r.verdict.verdict === "WARN").length;
    console.log(`\nengine: ${engineSeen ?? "not reported"} (from the engine's x-maipai-engine and x-maipai-model headers, via the turn stats)`);
    console.log(await stackEngineLine());
    console.log(`machine:\n  ${machineState()}`);
    console.log(`\nsmoke:chat summary: ${results.length - fails - warns} PASS, ${warns} WARN, ${fails} FAIL`);
    exitCode = fails > 0 || results.length === 0 ? 1 : 0;
  } catch (error) {
    console.error(`smoke:chat: ${(error as Error).message}`);
    exitCode = 1;
  } finally {
    backend.kill("SIGTERM");
    const exited = await Promise.race([backend.exited.then(() => true), sleep(15_000).then(() => false)]);
    if (!exited) {
      backend.kill("SIGKILL");
      await backend.exited;
    }
    rmSync(dataDir, { recursive: true, force: true });
    const stillBound = port ? !(await portIsFree(port)) : false;
    const kiwixBound = !(await portIsFree(kiwixPort));
    console.log(`cleanup: scratch Home stopped, data directory removed (${existsSync(dataDir) ? "STILL PRESENT" : "gone"}), port ${port || "n/a"} ${stillBound ? "STILL BOUND" : "free"}, sidecar port ${kiwixBound ? "STILL BOUND" : "free"}`);
    if (stillBound || kiwixBound || existsSync(dataDir)) exitCode = 1;
  }
  process.exit(exitCode);
}

await main();
