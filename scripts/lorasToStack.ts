// STACK-LORAS-01 slice 5: moves Home's `loras` table into the Stack's library through POST /stack/v1/loras/import, then proves it.
//
//   bun scripts/lorasToStack.ts --db <hub.db> --stack <url> --stack-data <dir> --out <dir> [--apply] [--live]
//
// Modes:
//   default (dry run)  Reads a COPY of the database, writes the backup and the people export, asks the Stack to compare (GET only).
//                      Nothing is posted. It says what an apply would do.
//   --apply            Posts every record, then compares. Needs a Stack that is not the live one.
//   --live             Required with --apply when the Stack URL or database is the live one (port 8770, or a database under /usr/local).
//                      Also needs MAIPAI_LORAS_LIVE_CONFIRM=migrate-live-loras in the environment. Without both it refuses.
// It never writes to the database or to the Stack's files (the Stack writes its own manifest). It never deletes anything. Exit 0 only when
// every record matches; Home drops its table (slice 6) only after exit 0.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

export const LIVE_CONFIRM = "migrate-live-loras";
const PREVIEW_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface HomeLora { id: string; record: Record<string, any>; removedAt: string | null; trashUntil: string | null; }
export interface Item { lora: Record<string, any>; preview: { content_type: string; data_base64: string } | null; }
export interface Mismatch { id: string; field: string; home: unknown; stack: unknown; }
export interface Report {
  mode: "dry-run" | "apply"; homeCount: number; stackCount: number; posted: number; results: Record<string, number>;
  previewsSent: number; mismatches: Mismatch[]; fileChecks: { id: string; sha256: string; ok: boolean; note?: string }[]; backupSha256: string; ok: boolean;
}

export const sha256Hex = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** Refuses a live run unless both `--live` and the confirmation word are present. A scratch run passes with neither. */
export function checkLive(opts: { apply: boolean; live: boolean; stack: string; db: string; env: Record<string, string | undefined> }): string | null {
  const isLive = /:(8770)(\/|$)/.test(opts.stack) || opts.db.startsWith("/usr/local/");
  if (!opts.apply) return null;
  if (isLive && !opts.live) return "That is the live Stack or the live database. Re-run with --live only when Jesse has said to migrate the live data.";
  if (opts.live && opts.env.MAIPAI_LORAS_LIVE_CONFIRM !== LIVE_CONFIRM) return `--live needs MAIPAI_LORAS_LIVE_CONFIRM=${LIVE_CONFIRM} in the environment.`;
  if (opts.live && !isLive) return "--live is for the live Stack only; this one is not. Drop --live.";
  return null;
}

/** Copies the database and its -wal and -shm files into a scratch folder and opens the copy, so the source is never opened for writing. */
export function openCopy(dbPath: string): { db: Database; dir: string } {
  const dir = join(tmpdir(), `loras-migrate-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, join(dir, "hub.db" + suffix));
  return { db: new Database(join(dir, "hub.db")), dir };
}

export function readHome(db: Database): { loras: HomeLora[]; dump: unknown } {
  const rows = db.query("select * from loras order by id").all() as Record<string, any>[];
  const marks = (db.query("select name from sqlite_master where name = 'adult_mark_log'").get() ? db.query("select * from adult_mark_log order by id").all() : []) as unknown[];
  const loras = rows.map((row) => ({ id: row.id as string, record: JSON.parse(row.record as string) as Record<string, any>, removedAt: (row.removed_at ?? null) as string | null, trashUntil: (row.trash_until ?? null) as string | null }));
  return { loras, dump: { loras: rows, adult_mark_log: marks } };
}

/** The people table the plan keeps in Home: lora id to the people a style is shared with (slice 6 puts it in a small Home table). */
export const peopleOf = (lora: Record<string, any>): string[] => [...((lora.availability?.people as string[] | undefined) ?? [])].sort();

/** The preview bytes of a Home record: the attachment's file under Home's data folder, or null when the style has none. Throws when it has one that cannot be read. */
export function previewOf(db: Database, dataDir: string, lora: Record<string, any>): Item["preview"] {
  const fileId = lora.preview?.file_id as string | undefined;
  if (!fileId) return null;
  const row = db.query("select media_type, storage_path from attachments where id = ?").get(fileId) as { media_type: string; storage_path: string } | null;
  if (!row || !PREVIEW_TYPES.has(row.media_type)) throw new Error(`${lora.id}: its preview ${fileId} is not a readable picture record. Fix or clear the preview, then run again.`);
  const path = join(dataDir, row.storage_path);
  if (!existsSync(path)) throw new Error(`${lora.id}: its preview file ${row.storage_path} is missing from ${dataDir}. Restore it, then run again.`);
  return { content_type: row.media_type, data_base64: readFileSync(path).toString("base64") };
}

/** Home's key for the Stack: STACK_HOME_VIEW_TOKEN, else the file the Stack keeps in its own data folder. Never printed. */
export function homeToken(stackData: string | null, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.STACK_HOME_VIEW_TOKEN?.trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  const path = stackData ? join(stackData, "keys", "home-view-token") : "";
  if (path && existsSync(path)) return readFileSync(path, "utf8").trim();
  throw new Error("No Home key for the Stack. Set STACK_HOME_VIEW_TOKEN, or pass --stack-data with the Stack's data folder (it holds keys/home-view-token).");
}

let token = "";
async function call(stack: string, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${stack}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "x-maipai-home-token": token, "x-maipai-view": "full" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`The Stack answered ${response.status} on ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** What the Stack should hold for one Home record, field by field. Differences come back as mismatches. */
export function compareOne(home: HomeLora, stack: Record<string, any> | undefined, previewSent: boolean): Mismatch[] {
  const id = home.id; const lora = home.record; const out: Mismatch[] = [];
  const check = (field: string, h: unknown, s: unknown) => { if (JSON.stringify(h) !== JSON.stringify(s)) out.push({ id, field, home: h, stack: s }); };
  if (!stack) return [{ id, field: "present", home: true, stack: false }];
  check("id", id, stack.id);
  check("name", lora.name, stack.name);
  check("sha256", lora.file?.sha256, stack.sha256);
  check("media", lora.media, stack.media);
  check("removed_at", home.removedAt, stack.removed_at ?? null);
  check("trash_until", home.trashUntil, stack.trash_until ?? null);
  check("preview", previewSent || !lora.preview ? Boolean(lora.preview) : false, Boolean(stack.preview));
  // The Stack may keep a style adult-only that Home called all-ages (an import never lowers), but never the reverse.
  const nsfw = stack.classification === "adult-only";
  if (lora.audience === "adult-only" && !nsfw) out.push({ id, field: "nsfw", home: "adult-only", stack: stack.classification });
  if (lora.audience !== "adult-only" && nsfw) out.push({ id, field: "nsfw(stack stricter)", home: lora.audience, stack: stack.classification });
  const kept = stack.home as Record<string, any> | null;
  check("home.audience", lora.audience, kept?.audience ?? null);
  check("home.availability.who", lora.availability?.who, kept?.availability?.who ?? null);
  check("people", peopleOf(lora), peopleOf(kept ?? {}));
  return out;
}

export async function migrate(opts: { dbPath: string; dataDir: string; stack: string; stackData: string | null; out: string; apply: boolean }): Promise<Report> {
  token = homeToken(opts.stackData);
  const { db } = openCopy(opts.dbPath);
  try {
    const { loras, dump } = readHome(db);
    mkdirSync(opts.out, { recursive: true });
    const dumpText = JSON.stringify(dump, null, 1);
    writeFileSync(join(opts.out, "loras-table-dump.json"), dumpText, { mode: 0o600 });
    writeFileSync(join(opts.out, "loras-people.json"), JSON.stringify(Object.fromEntries(loras.map((l) => [l.id, peopleOf(l.record)])), null, 1), { mode: 0o600 });
    const items: Item[] = loras.map((l) => ({ lora: l.record, preview: previewOf(db, opts.dataDir, l.record) }));
    const report: Report = { mode: opts.apply ? "apply" : "dry-run", homeCount: loras.length, stackCount: 0, posted: 0, results: {}, previewsSent: items.filter((i) => i.preview).length, mismatches: [], fileChecks: [], backupSha256: sha256Hex(dumpText), ok: false };
    if (opts.apply && items.length) {
      const answer = await call(opts.stack, "/stack/v1/loras/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
      report.posted = items.length;
      for (const r of answer.results as { id: string; result: string }[]) report.results[r.result] = (report.results[r.result] ?? 0) + 1;
    }
    const live = [...(await call(opts.stack, "/stack/v1/loras?removed=false")).loras, ...(await call(opts.stack, "/stack/v1/loras?removed=true")).loras] as Record<string, any>[];
    report.stackCount = live.length;
    for (const home of loras) report.mismatches.push(...compareOne(home, live.find((s) => s.id === home.id), true));
    if (opts.stackData) {
      for (const home of loras) {
        const sha = home.record.file?.sha256 as string;
        const dirs = ["images", "video"].map((d) => join(opts.stackData!, d, "loras"));
        const file = dirs.map((d) => join(d, `${home.id}.safetensors`)).find(existsSync);
        if (!file) { report.fileChecks.push({ id: home.id, sha256: sha, ok: false, note: "file not found in the Stack data folder" }); continue; }
        const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
        report.fileChecks.push({ id: home.id, sha256: actual, ok: actual === sha });
      }
    }
    const everyResultFine = Object.keys(report.results).every((k) => k === "imported" || k === "unchanged");
    report.ok = report.mismatches.length === 0 && report.fileChecks.every((f) => f.ok) && (!opts.apply || everyResultFine);
    return report;
  } finally { db.close(); }
}

function arg(name: string, argv: string[]): string | null { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] ?? null : null; }

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dbPath = arg("--db", argv); const stack = arg("--stack", argv); const out = arg("--out", argv);
  if (!dbPath || !stack || !out) { console.error("Usage: bun scripts/lorasToStack.ts --db <hub.db> --stack <http://127.0.0.1:port> --out <folder> [--stack-data <folder>] [--data-dir <Home data folder>] [--apply] [--live]"); process.exit(2); }
  const apply = argv.includes("--apply");
  const refusal = checkLive({ apply, live: argv.includes("--live"), stack, db: dbPath, env: process.env });
  if (refusal) { console.error(refusal); process.exit(2); }
  const report = await migrate({ dbPath, dataDir: arg("--data-dir", argv) ?? join(dbPath, ".."), stack, stackData: arg("--stack-data", argv), out, apply });
  writeFileSync(join(out, `report-${basename(dbPath)}-${apply ? "apply" : "dry"}.json`), JSON.stringify(report, null, 1), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, fileChecks: report.fileChecks.map((f) => ({ id: f.id, ok: f.ok })) }, null, 1));
  if (!report.ok) console.error("NOT a full match. Home must not drop its table.");
  process.exit(report.ok ? 0 : 1);
}
