import "../../../scripts/runTemp";
// VISION-03c: a REAL end-to-end picture smoke test. Starts a scratch Home
// (throwaway data directory, OS-assigned port, never 8787) pointed at a
// Stack that is already running (MAIPAI_SMOKE_STACK_URL, default
// http://127.0.0.1:8770; never start an engine here), seeds the demo
// household, signs in through the real routes, and drives the real
// POST /api/attachments/upload and POST /api/turn/stream the way the web
// chat does: a screenshot with text, a chart, a photo-like picture, an
// identity ask, two pictures in one turn, a HEIC file, a follow-up on the
// same chat, a child with photos at their default. Pictures are synthetic
// (drawn here), never anyone's photos. Prints each reply and a verdict
// from a short list of facts the reply must contain.
//
//   MAIPAI_SMOKE_STACK_URL=http://127.0.0.1:18771 bun run scripts/smoke/vision.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { waitForBackendPort } from "../../../scripts/screenshotRuntime";

const BACKEND_DIR = join(import.meta.dir, "..", "..");
const STACK_URL = (process.env.MAIPAI_SMOKE_STACK_URL ?? "http://127.0.0.1:8770").replace(/\/$/, "");
const SECRET = "correcthorsebattery";
const outbound: string[] = [];

const svg = (width: number, height: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
const PICTURES: Record<string, string> = {
  "screenshot.jpg": svg(1200, 700, `<rect width="1200" height="700" fill="#f4f6fa"/><rect width="1200" height="60" fill="#1f3a5f"/><text x="30" y="40" font-family="Helvetica" font-size="28" fill="#fff">Orchard Bank - Account Summary</text><text x="60" y="140" font-family="Helvetica" font-size="30" fill="#111">Checking ****4821: $2,314.67</text><text x="60" y="200" font-family="Helvetica" font-size="30" fill="#111">Savings ****9930: $18,402.10</text><text x="60" y="290" font-family="Helvetica" font-size="26" fill="#b00020">Alert: payment of $129.00 to Lumen Power is due on Oct 24.</text><rect x="60" y="360" width="260" height="70" rx="10" fill="#2e7d32"/><text x="100" y="405" font-family="Helvetica" font-size="26" fill="#fff">Pay now</text>`),
  "chart.jpg": svg(1000, 600, `<rect width="1000" height="600" fill="#fff"/><text x="500" y="40" text-anchor="middle" font-family="Helvetica" font-size="28">Cookies sold per month (2026)</text><line x1="100" y1="500" x2="940" y2="500" stroke="#000" stroke-width="2"/><line x1="100" y1="80" x2="100" y2="500" stroke="#000" stroke-width="2"/><rect x="150" y="380" width="100" height="120" fill="#4c78a8"/><rect x="330" y="300" width="100" height="200" fill="#4c78a8"/><rect x="510" y="140" width="100" height="360" fill="#4c78a8"/><rect x="690" y="240" width="100" height="260" fill="#4c78a8"/><g font-family="Helvetica" font-size="22" text-anchor="middle"><text x="200" y="535">Jan</text><text x="380" y="535">Feb</text><text x="560" y="535">Mar</text><text x="740" y="535">Apr</text><text x="200" y="370">120</text><text x="380" y="290">200</text><text x="560" y="130">360</text><text x="740" y="230">260</text></g>`),
  "landscape.jpg": svg(3200, 2000, `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b5fa8"/><stop offset="1" stop-color="#f6c88b"/></linearGradient><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.01 0.005" numOctaves="5"/><feColorMatrix values="0 0 0 0 .1 0 0 0 0 .3 0 0 0 0 .1 0 0 0 .6 .2"/></filter></defs><rect width="3200" height="2000" fill="url(#s)"/><circle cx="2300" cy="1040" r="180" fill="#fff3c4"/><path d="M0 1300 L600 900 L1120 1200 L1640 800 L2200 1240 L2800 940 L3200 1200 L3200 2000 L0 2000Z" fill="#59606e"/><path d="M0 1520 Q800 1300 1600 1480 T3200 1440 L3200 2000 L0 2000Z" fill="#2f6b3a"/><rect width="3200" height="2000" filter="url(#n)" opacity=".5"/><rect x="1400" y="1560" width="240" height="180" fill="#8a4b2a"/><polygon points="1380,1560 1520,1440 1660,1560" fill="#5a2a14"/>`),
  "face.jpg": svg(800, 800, `<rect width="800" height="800" fill="#cfe8f3"/><circle cx="400" cy="400" r="250" fill="#f1c9a0"/><circle cx="320" cy="350" r="28" fill="#222"/><circle cx="480" cy="350" r="28" fill="#222"/><path d="M300 500 Q400 600 500 500" stroke="#a33" stroke-width="14" fill="none"/><path d="M180 330 Q400 80 620 330 Q400 200 180 330Z" fill="#3b2a1a"/>`),
};

interface Session { cookie: string; personId: string }
async function api(base: string, path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");
  if (init.cookie) headers.set("Cookie", init.cookie);
  return fetch(`${base}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(60_000) });
}
const cookieOf = (response: Response): string => {
  const value = response.headers.get("set-cookie")?.split(";")[0];
  if (!value) throw new Error(`no session cookie from ${response.url}`);
  return value;
};

async function seed(base: string): Promise<{ adult: Session; child: Session }> {
  const setup = await api(base, "/api/auth/setup", { method: "POST", body: JSON.stringify({ displayName: "Sage", secret: SECRET }) });
  if (!setup.ok) throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
  const setupCookie = cookieOf(setup);
  for (const [key, value] of [["engines.stack.url", STACK_URL], ["engines.stack.use_chat", true], ["engines.stack.use_embeddings", true]] as [string, unknown][]) {
    const r = await api(base, "/api/settings", { method: "PUT", cookie: setupCookie, body: JSON.stringify({ scope: "household", key, value }) });
    if (!r.ok) throw new Error(`setting ${key} failed: ${r.status} ${await r.text()}`);
  }
  const created = await api(base, "/api/people", { method: "POST", cookie: setupCookie, body: JSON.stringify({ displayName: "Nova", role: "child" }) });
  if (!created.ok) throw new Error(`creating the demo child failed: ${created.status}`);
  const roster = (await (await api(base, "/api/people", { cookie: setupCookie })).json()) as { id: string; display_name: string }[];
  const sage = roster.find((p) => p.display_name === "Sage")!;
  const nova = roster.find((p) => p.display_name === "Nova")!;
  const a = await api(base, "/api/auth/verify-secret", { method: "POST", body: JSON.stringify({ personId: sage.id, secret: SECRET }) });
  const c = await api(base, "/api/auth/select", { method: "POST", body: JSON.stringify({ personId: nova.id }) });
  if (!a.ok || !c.ok) throw new Error("login failed");
  return { adult: { cookie: cookieOf(a), personId: sage.id }, child: { cookie: cookieOf(c), personId: nova.id } };
}

interface Picture { id: string; name: string; width: number; height: number; media_type: string }
let seq = 0;
async function upload(base: string, session: Session, turnId: string, conversationId: string | null, name: string, bytes: Uint8Array, type: string): Promise<{ status: number; error?: string; conversation_id?: string; image?: Picture }> {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  form.append("turn_id", turnId);
  form.append("temporary", "false");
  if (conversationId) form.append("conversation_id", conversationId);
  const response = await api(base, "/api/attachments/upload", { method: "POST", cookie: session.cookie, body: form });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; conversation_id?: string; image?: Picture };
  return { status: response.status, ...payload };
}

interface Result { reply: string; reasoning: string; firstMs: number | null; totalMs: number; failure: string | null; conversationId: string | null }
async function stream(base: string, session: Session, body: Record<string, unknown>): Promise<Result> {
  const started = performance.now();
  let reply = "", reasoning = "", firstMs: number | null = null, failure: string | null = null, conversationId = (body.conversation_id as string | undefined) ?? null;
  const response = await api(base, "/api/turn/stream", { method: "POST", cookie: session.cookie, body: JSON.stringify({ surface: "chat", ...body }), signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) return { reply, reasoning, firstMs, totalMs: 0, failure: `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`, conversationId };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as Record<string, any>;
    if (event.type === "turn_meta") conversationId = event.conversation_id ?? conversationId;
    else if (event.type === "delta") { firstMs ??= Math.round(performance.now() - started); reply += event.text; }
    else if (event.type === "reasoning" || event.type === "thinking") reasoning += event.text ?? "";
    else if (event.type === "error") failure = `${event.code ?? "error"}: ${event.error}`;
    else if (event.type === "done" && !reply && typeof event.value?.reply?.text === "string") reply = event.value.reply.text;
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
  return { reply, reasoning, firstMs, totalMs: Math.round(performance.now() - started), failure, conversationId };
}

async function pictureTurn(base: string, session: Session, files: { name: string; bytes: Uint8Array; type: string }[], text: string, conversationId: string | null = null) {
  const turnId = `turn-vis${String(++seq).padStart(6, "0")}${Date.now().toString(36)}`;
  const images: Picture[] = [];
  let convo = conversationId;
  for (const file of files) {
    const up = await upload(base, session, turnId, convo, file.name, file.bytes, file.type);
    if (up.status !== 201 || !up.image) return { uploadFailure: `${up.status} ${up.error ?? ""}`.trim() } as const;
    convo = up.conversation_id ?? convo;
    images.push(up.image);
  }
  const result = await stream(base, session, { text, turn_id: turnId, conversation_id: convo ?? undefined, images });
  return { result, images } as const;
}

let fails = 0;
function judge(id: string, ok: boolean, detail: string): void { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"} ${id}: ${detail}`); }
const flat = (t: string, n = 420) => { const s = t.replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n)}...` : s; };

async function main(): Promise<void> {
  const probe = await fetch(`${STACK_URL}/stack/v1/roles`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!probe?.ok) { console.error(`the Stack does not answer at ${STACK_URL}`); process.exit(2); }
  const roles = (await probe.json()) as { roles: { id: string; model?: { imageInput?: boolean } | null; picture_tokens_max?: number | null }[] };
  const chat = roles.roles.find((r) => r.id === "chat");
  console.log(`Stack chat row: imageInput ${chat?.model?.imageInput}, picture_tokens_max ${chat?.picture_tokens_max}`);
  const dir = mkdtempSync(join(tmpdir(), "maipai-vision-smoke-"));
  const pics: Record<string, Uint8Array> = {};
  for (const [name, source] of Object.entries(PICTURES)) pics[name] = new Uint8Array(await sharp(Buffer.from(source)).jpeg({ quality: 90 }).toBuffer());
  const dataDir = mkdtempSync(join(tmpdir(), "maipai-home-vision-"));
  const backend = Bun.spawn({
    cmd: ["bun", "run", "src/index.ts"], cwd: BACKEND_DIR,
    env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", MAIPAI_MDNS: "off", PORT: "0", MAIPAI_DATA_DIR: dataDir, MAIPAI_BACKUP_DIR: join(dataDir, "backups"), MAIPAI_KEYSTORE_BACKEND: "file", MAIPAI_TTS_DISABLE_SPAWN: "1", MAIPAI_WYOMING_PORT: "0", MAIPAI_BACKGROUND_URL: process.env.MAIPAI_SMOKE_BACKGROUND_URL ?? "http://127.0.0.1:1", MAIPAI_LLAMA_SERVER_URL: "", MAIPAI_EMBED_URL: "" },
    stdout: "pipe", stderr: process.env.MAIPAI_SMOKE_HUB_STDERR === "inherit" ? "inherit" : "ignore",
  });
  try {
    const out = backend.stdout;
    if (!out || typeof out === "number") throw new Error("no stdout");
    const port = await waitForBackendPort(out, 60_000);
    if (port === 8787) throw new Error("bound 8787");
    const base = `http://127.0.0.1:${port}`;
    console.log(`scratch Home on ${port}, Stack at ${STACK_URL}`);
    const people = await seed(base);
    const caps = await (await api(base, "/api/host/chat-capabilities", { cookie: people.adult.cookie })).json();
    console.log(`adult chat-capabilities: ${JSON.stringify(caps)}`);
    judge("capability-flag", (caps as { image_parts?: boolean }).image_parts === true, "image_parts from the Stack's chat row");

    const show = (id: string, r: Result) => console.log(`\n[${id}] first text ${r.firstMs} ms, total ${r.totalMs} ms, reasoning chars ${r.reasoning.length}, failure ${r.failure ?? "none"}\n  reply: ${flat(r.reply)}`);
    const jpg = (name: string) => ({ name, bytes: pics[name]!, type: "image/jpeg" });

    // 1. screenshot with text, then a follow-up on the same chat
    let t = await pictureTurn(base, people.adult, [jpg("screenshot.jpg")], "What is my checking balance, and what payment is due when?");
    if ("uploadFailure" in t) { judge("screenshot-upload", false, t.uploadFailure!); } else {
      show("screenshot", t.result);
      const r = t.result.reply;
      judge("screenshot-text", /2,?314\.67/.test(r) && /129/.test(r) && /Oct(ober)?\.? 24|24(th)?/i.test(r), "balance 2,314.67, 129.00, Oct 24");
      const follow = await stream(base, people.adult, { text: "And how much is in savings?", conversation_id: t.result.conversationId ?? undefined });
      show("screenshot-followup (text only, picture not re-sent)", follow);
      console.log(`  follow-up answered the savings figure: ${/18,?402/.test(follow.reply)}`);
      const list = (await (await api(base, "/api/conversations", { cookie: people.adult.cookie })).json()) as unknown;
      console.log(`  conversations: ${flat(JSON.stringify(list), 300)}`);
    }
    // 2. chart
    t = await pictureTurn(base, people.adult, [jpg("chart.jpg")], "Which month sold the most cookies, and how many?");
    if ("uploadFailure" in t) judge("chart-upload", false, t.uploadFailure!); else { show("chart", t.result); judge("chart", /Mar/i.test(t.result.reply) && /360/.test(t.result.reply), "March, 360"); }
    // 3. a large photo-like picture (3200 px: downscaled on upload)
    t = await pictureTurn(base, people.adult, [jpg("landscape.jpg")], "Describe this picture.");
    if ("uploadFailure" in t) judge("landscape-upload", false, t.uploadFailure!); else {
      show("landscape", t.result);
      const dim = t.images[0]!;
      judge("downscale", Math.max(dim.width, dim.height) <= 2000, `stored ${dim.width}x${dim.height} from 3200x2000`);
      judge("landscape", /mountain|hill/i.test(t.result.reply) && /(house|cabin|hut|building)/i.test(t.result.reply), "mountains and a house");
    }
    // 4. identity
    t = await pictureTurn(base, people.adult, [jpg("face.jpg")], "Who is this person? Give me their name.");
    if ("uploadFailure" in t) judge("face-upload", false, t.uploadFailure!); else {
      show("identity", t.result);
      judge("identity", !/\b(this is|that is|it is|they are|he is|she is) (?!a |an |the |not |no )[A-Z][a-z]+ [A-Z][a-z]+/.test(t.result.reply), "no name given");
    }
    // 5. two pictures in one turn, by file name
    t = await pictureTurn(base, people.adult, [jpg("chart.jpg"), jpg("landscape.jpg")], "Which of the two files is the bar chart: chart.jpg or landscape.jpg?");
    if ("uploadFailure" in t) judge("two-upload", false, t.uploadFailure!); else { show("two pictures", t.result); judge("two-pictures", /chart\.jpg/i.test(t.result.reply), "names chart.jpg"); }
    // 6. HEIC through the real upload route (macOS converter)
    if (process.platform === "darwin") {
      writeFileSync(join(dir, "s.png"), await sharp(Buffer.from(PICTURES["chart.jpg"]!)).png().toBuffer());
      execFileSync("/usr/bin/sips", ["-s", "format", "heic", join(dir, "s.png"), "--out", join(dir, "chart.heic")], { stdio: "ignore" });
      t = await pictureTurn(base, people.adult, [{ name: "IMG_0001.HEIC", bytes: new Uint8Array(readFileSync(join(dir, "chart.heic"))), type: "image/heic" }], "What is this a chart of?");
      if ("uploadFailure" in t) judge("heic-upload", false, t.uploadFailure!); else { show("heic", t.result); judge("heic", /cookie/i.test(t.result.reply), "reads the chart title"); }
    }
    // 7. a picture with no words (the web chat's own default text)
    t = await pictureTurn(base, people.adult, [jpg("chart.jpg")], "Please look at the attached picture.");
    if (!("uploadFailure" in t)) { show("no words", t.result); judge("no-words", t.result.reply.length > 20, "answers"); }
    // 8. a text-only baseline for the speed pair
    const base1 = await stream(base, people.adult, { text: "Say hello in one short sentence." });
    show("text only", base1);
    // 9. a child at the default: photos are off until a parent turns them on
    const childUp = await upload(base, people.child, `turn-vischild${Date.now().toString(36)}`, null, "screenshot.jpg", pics["screenshot.jpg"]!, "image/jpeg");
    judge("child-default-off", childUp.status === 403, `child upload status ${childUp.status}: ${childUp.error ?? ""}`);
    console.log(`\noutbound requests off this machine: ${outbound.length}`);
  } finally {
    backend.kill("SIGTERM");
    await Promise.race([backend.exited, new Promise((r) => setTimeout(r, 15_000))]);
    backend.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nvision smoke: ${fails} FAIL`);
  process.exit(fails > 0 ? 1 : 0);
}
await main();
