#!/usr/bin/env bun
// MAKER-E: drive the companion pack maker (MAKER-D routes) over HTTP against a running Home, one command per step.
//   bun run scripts/pack/make_character.ts --companion <id> --still <look version id> --shapes photo [--dev-url http://127.0.0.1:<port>]
//     [--yes-stage B,C] [--approve A|B|C] [--cancel] [--restart] [--status] [--i-mean-the-live-hub]
// Exit codes: 0 done, 2 waiting for an approval (or still running with --status), 1 failed or refused.
// Sign-in: MAIPAI_MAKER_COOKIE (a session token) or MAIPAI_MAKER_SECRET (+ MAIPAI_MAKER_PERSON, a name or id, default Sage). Never printed.
// It never approves B or C by itself; only `--approve` or an explicit `--yes-stage` does. No flag touches the live hub without `--i-mean-the-live-hub`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface MakeOptions {
  companion: string; still?: string; shapes: string; box?: string; devUrl: string;
  yesStages: string[]; approve?: string; cancel?: boolean; restart?: boolean; status?: boolean; liveOk?: boolean; pollMs?: number;
}
export interface MakeIo { fetch: (url: string, init?: RequestInit) => Promise<Response>; out: (line: string) => void; sleep: (ms: number) => Promise<void>; cookie?: string; secret?: string; person?: string }
interface StageView { name: string; status: string; reasons: string[]; stack_jobs: string[] }
interface JobView { status: string; stage: string | null; waiting_for: "A" | "B" | "C" | null; error: string | null; interrupted?: boolean; notes?: string[]; stages: StageView[] }

export const LIVE_HUB_LINE = "That address is the live hub (the family's installed Home). Point --dev-url at a worktree dev hub (bun run dev), or pass --i-mean-the-live-hub when the owner said so.";
export function isLiveHub(url: string): boolean {
  try { const u = new URL(url); return u.port === "3000" || u.hostname.endsWith(".ts.net"); } catch { return true; }
}

const post = (io: MakeIo, base: string, path: string, body: unknown, cookie: string) => io.fetch(`${base}/api/${path}`, { method: "POST", headers: { cookie: `session=${cookie}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const detail = async (r: Response) => { try { return ((await r.json()) as { error?: string }).error ?? `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; } };

async function signIn(io: MakeIo, base: string): Promise<string> {
  if (io.cookie) return io.cookie;
  if (!io.secret) throw new Error("Set MAIPAI_MAKER_COOKIE (a session token) or MAIPAI_MAKER_SECRET (the secret of the signed-in person) in the environment, then run again.");
  const profiles = (await (await io.fetch(`${base}/api/auth/profiles`)).json()) as Array<{ id: string; displayName: string }>;
  const who = io.person ?? "Sage", p = profiles.find((x) => x.id === who || x.displayName.toLowerCase() === who.toLowerCase());
  if (!p) throw new Error(`No person named "${who}" on that Home. Set MAIPAI_MAKER_PERSON to a name on the sign-in screen.`);
  const r = await io.fetch(`${base}/api/auth/verify-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: p.id, secret: io.secret }) });
  if (!r.ok) throw new Error(`Sign-in was refused (${await detail(r)}). Check MAIPAI_MAKER_SECRET.`);
  const m = /(?:^|[,;\s])session=([^;,\s]+)/.exec(r.headers.get("set-cookie") ?? "");
  if (!m) throw new Error("Signed in but no session came back (a second factor may be required). Use MAIPAI_MAKER_COOKIE instead.");
  return m[1]!;
}

/** What to look at when the job waits, and the command that approves it. */
export function approvalHelp(o: MakeOptions, stage: string, base: string): string[] {
  const id = encodeURIComponent(o.companion), cmd = `bun run scripts/pack/make_character.ts --companion ${o.companion} --dev-url ${base} --approve ${stage}`;
  if (stage === "B") return [`LOOK: the idle loops and the listen, think and speak clips. Open ${base}/api/companions/${id}/states and play each take's clip.h264.mp4.`, "CHECK: no green edge, no winks or blinks that jump, steady lighting, the face and clothes stay the same.", `APPROVE: ${cmd}`];
  if (stage === "C") return [`LOOK: the assembled pack in the player. Open ${base}/api/companions/${id}/pack/pack.json, then the companion's talking pane, and speak one line.`, "CHECK: mouth shapes match the sound, the rest frame matches the loops, no green.", `APPROVE (this installs the pack): ${cmd}`];
  return [`APPROVE: ${cmd}`];
}

const line = (s: StageView) => `${s.name}: ${s.status}${s.stack_jobs.length ? ` (Stack job ${s.stack_jobs.join(", ")})` : ""}${s.reasons.length ? ` - ${s.reasons.join(" ")}` : ""}`;

/** Returns the exit code. */
export async function runMakeCharacter(o: MakeOptions, io: MakeIo): Promise<number> {
  const base = o.devUrl.replace(/\/+$/, "");
  if (isLiveHub(base) && !o.liveOk) { io.out(LIVE_HUB_LINE); return 1; }
  let cookie: string;
  try { cookie = await signIn(io, base); } catch (e) { io.out((e as Error).message); return 1; }
  const path = `companions/${encodeURIComponent(o.companion)}/pack-job`;
  const readJob = async (): Promise<JobView | null> => { const r = await io.fetch(`${base}/api/${path}`, { headers: { cookie: `session=${cookie}` } }); return r.ok ? ((await r.json()) as JobView) : null; };

  if (o.cancel) {
    const r = await post(io, base, `${path}/cancel`, {}, cookie);
    io.out(r.ok ? "The pack job was stopped. Start it again to make the clips again." : `Could not stop it: ${await detail(r)}`); return r.ok ? 0 : 1;
  }
  if (o.status) {
    const j = await readJob(); if (!j) { io.out("No pack job for this companion yet."); return 1; }
    for (const s of j.stages) io.out(line(s));
    io.out(`job: ${j.status}${j.waiting_for ? `, waiting for approval ${j.waiting_for}` : ""}${j.error ? `, ${j.error}` : ""}`);
    return j.status === "done" ? 0 : j.status === "failed" || j.status === "cancelled" ? 1 : 2;
  }
  if (o.box) io.out("Note: --box is not read by the maker yet (the routes take no box); it is ignored.");
  if (o.approve) {
    const r = await post(io, base, `${path}/approve`, { stage: o.approve }, cookie);
    if (!r.ok) { io.out(`Approval ${o.approve} was not accepted: ${await detail(r)}`); return 1; }
    io.out(`Approved ${o.approve}.`);
  } else {
    if (!o.still) { io.out("Pass --still <the approved look version id>."); return 1; }
    const r = await post(io, base, path, { still_id: o.still, shapes: o.shapes, ...(o.restart ? { restart: true } : {}) }, cookie);
    if (!r.ok) { io.out(`The pack job did not start: ${await detail(r)}`); return 1; }
    io.out(o.restart ? "Started again from the start." : "Started (or continued) the pack job.");
  }
  const seen = new Map<string, string>(); let announced = "";
  for (;;) {
    const j = await readJob();
    if (!j) { io.out("The pack job could not be read. Check the Home is still running."); return 1; }
    for (const s of j.stages) { const l = line(s); if (seen.get(s.name) !== l && s.status !== "pending") { seen.set(s.name, l); io.out(l); } }
    if (j.status === "done") { io.out("Done: the pack is installed."); return 0; }
    if (j.status === "failed") { io.out(`Failed at ${j.stage ?? "a step"}: ${j.error ?? "no reason given"}`); return 1; }
    if (j.status === "cancelled") { io.out("The pack job was stopped."); return 1; }
    if (j.status === "waiting_approval" && j.waiting_for) {
      if (o.yesStages.includes(j.waiting_for)) {
        const r = await post(io, base, `${path}/approve`, { stage: j.waiting_for }, cookie);
        if (!r.ok) { io.out(`Approval ${j.waiting_for} was not accepted: ${await detail(r)}`); return 1; }
        io.out(`Approved ${j.waiting_for} (asked for with --yes-stage).`); continue;
      }
      if (announced !== j.waiting_for) { announced = j.waiting_for; io.out(`WAITING for approval ${j.waiting_for}.`); for (const l of approvalHelp(o, j.waiting_for, base)) io.out(l); }
      return 2;
    }
    if (j.interrupted && announced !== "x") { announced = "x"; io.out("The Home restarted while this ran. Run the same command again to continue at the step that stopped."); return 2; }
    await io.sleep(o.pollMs ?? 3000);
  }
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env, root = process.cwd()): MakeOptions | string {
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (f: string) => argv.includes(f);
  const companion = get("--companion"); if (!companion) return "Pass --companion <household companion id>.";
  let devUrl = get("--dev-url");
  if (!devUrl) { const pf = join(root, "data/dev/port"); if (existsSync(pf)) devUrl = `http://127.0.0.1:${readFileSync(pf, "utf8").trim()}`; }
  if (!devUrl) return "Pass --dev-url http://127.0.0.1:<port> (the worktree dev hub; `bash scripts/dev.sh url` prints it).";
  const still = get("--still");
  if (still && /[\\/]/.test(still)) return "--still takes the look version id of the approved starting picture, not a file path. Upload the picture as the look in Home and approve it first.";
  return { companion, still, shapes: get("--shapes") ?? "photo", box: get("--box"), devUrl, yesStages: (get("--yes-stage") ?? "").split(",").map((s) => s.trim()).filter(Boolean), approve: get("--approve"), cancel: has("--cancel"), restart: has("--restart"), status: has("--status"), liveOk: has("--i-mean-the-live-hub") };
}

if (import.meta.main) {
  const o = parseArgs(process.argv.slice(2));
  if (typeof o === "string") { console.error(o); process.exit(1); }
  const code = await runMakeCharacter(o, { fetch, out: (l) => console.log(l), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), cookie: process.env.MAIPAI_MAKER_COOKIE, secret: process.env.MAIPAI_MAKER_SECRET, person: process.env.MAIPAI_MAKER_PERSON });
  process.exit(code);
}
