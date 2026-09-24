// CHAT-22: the one setup every conversational live bench shares, so a
// bench can never touch a household's data directory, spawn or download
// an engine, or report success for having run nothing. Imported FIRST
// (`import "./setup";` before anything that reaches "@/db"), because
// that module opens, migrates, and applies any staged restore to
// whatever MAIPAI_DATA_DIR names at import time; a guard inside main()
// runs too late. Grown from Track B's scripts/bench/memory/guard.ts,
// which checked only the temp-root rule.
//
// The rules, each refused with exit code 2 before any mutation:
// 1. MAIPAI_DATA_DIR is set, sits under the OS temp root (the same shape
//    tests/reset-db.ts insists on), and either does not exist yet or is
//    an empty directory. A directory with anything in it, a household's
//    or a previous run's, is never reused: every run gets a fresh one.
// 2. MAIPAI_LLAMA_SERVER_URL and MAIPAI_EMBED_URL both name an engine
//    that answers its health probe right now. The supervisors' URL tier
//    spawns nothing and downloads nothing; without a URL they would
//    spawn (and, for a missing model, download), which a bench must
//    never do. A URL that nothing answers is refused too: every
//    downstream call swallows an unreachable engine (complete() returns
//    ok:false, the embed helpers return undefined), so a bench pointed
//    at a dead port would score every case FAIL and still end with
//    "executed N cases", exit 0 (a code review on CHAT-22); startBench()
//    below, the first line of every bench's main(), probes both.
// 3. MAIPAI_BACKGROUND_URL, when unset, is pointed at a closed port so
//    the memory judge can never spawn its engine from a bench either;
//    a bench that needs the judge (judge-eval) probes it and refuses
//    when nothing answers. The keystore is pinned to its file backend
//    and the speech engine's spawn tier is closed for the same reason.
//
// resetDb() is never called here or by any bench: it lives in
// tests/reset-db.ts for bun:test alone. A bench's own cleanup deletes
// only the rows it created, inside its own disposable database, and
// never stops an engine it did not start (finishBench() below does not
// call stopChatBackend(); the URL tier has nothing to stop anyway).
import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { sanitizeEngineUrl } from "@/lib/engineIdentity";

const CLOSED_PORT_URL = "http://127.0.0.1:1";

function refuse(message: string): never {
  console.error(`bench setup refused: ${message}`);
  process.exit(2);
}

const dir = process.env.MAIPAI_DATA_DIR;
if (!dir) refuse("MAIPAI_DATA_DIR is not set; a bench needs a fresh directory under the system temp root and never runs against a household's data directory.");
const resolved = resolve(dir);
const tempRoot = resolve(tmpdir());
// Prefix plus separator: a sibling of the temp root (/tmpdata next to
// /tmp) is not under it, and the temp root itself is not a bench's
// directory either (it would fill the shared root with hub.db and keys).
if (!resolved.startsWith(tempRoot + sep)) refuse(`MAIPAI_DATA_DIR (${resolved}) is not under the system temp root (${tempRoot}).`);
if (existsSync(resolved)) {
  if (!statSync(resolved).isDirectory()) refuse(`MAIPAI_DATA_DIR (${resolved}) exists and is not a directory.`);
  const entries = readdirSync(resolved);
  if (entries.length > 0) refuse(`MAIPAI_DATA_DIR (${resolved}) is not empty (${entries.length} entries, e.g. ${entries[0]}); a bench never reuses a directory, create a fresh one.`);
}
if (!process.env.MAIPAI_LLAMA_SERVER_URL) refuse("MAIPAI_LLAMA_SERVER_URL is not set; a bench connects only to an engine already running, it never spawns or downloads one.");
if (!process.env.MAIPAI_EMBED_URL) refuse("MAIPAI_EMBED_URL is not set; a bench connects only to an embed engine already running, it never spawns or downloads one.");
// B-GUARD-02 (a review, 2026-09-24): the real-SearXNG clearance check
// used to live here too, keyed to one specific env var name
// (MAIPAI_SEARXNG_URL) - which meant a script reading a differently-
// named one (stream-next-01-live.ts's own MAIPAI_BENCH_SEARXNG_URL)
// silently skipped it entirely. Moved to liveHubQuiet.ts's
// refuseRealSearxngWithoutClearance(), called at each script's own
// point of writing search.searxng_url into the household setting - the
// one definition, checked against the URL value actually about to take
// effect, whatever variable it came from, rather than re-derived here
// from a name this module has no way to keep in sync with every
// caller's own choice.

/** Rule 2's second half, awaited as the first line of every bench's
 * main(): both URLs answer the same /health probe the supervisors use
 * (ready means "ok"; a loading, hung or absent server reads false
 * within three seconds). Not a top-level await here: an async module's
 * sibling imports do not wait for it, so "@/db" would open the
 * database while the probe was still in flight. The directory is the
 * bench's own fresh one by then, so refusing from main() mutates
 * nothing that matters. */
export async function startBench(): Promise<void> {
  for (const [name, url] of [["MAIPAI_LLAMA_SERVER_URL", process.env.MAIPAI_LLAMA_SERVER_URL], ["MAIPAI_EMBED_URL", process.env.MAIPAI_EMBED_URL]] as const) {
    if (!url || !(await new LlamaServerClient(url).health())) refuse(`no engine answers at ${name} (${sanitizeEngineUrl(url)}); a bench needs an engine that is already running and ready.`);
  }
}
if (!process.env.MAIPAI_BACKGROUND_URL) process.env.MAIPAI_BACKGROUND_URL = CLOSED_PORT_URL;
// The remaining ways a bench could reach outside its directory,
// pinned here so the contract holds when a bench is run by hand and not
// only under tests/preload.ts (a code review on CHAT-22): the keystore
// writes its key under MAIPAI_DATA_DIR instead of the developer's login
// keychain, and the speech engine's spawn tier stays closed.
if (!process.env.MAIPAI_KEYSTORE_BACKEND) process.env.MAIPAI_KEYSTORE_BACKEND = "file";
if (!process.env.MAIPAI_TTS_DISABLE_SPAWN) process.env.MAIPAI_TTS_DISABLE_SPAWN = "1";
// paths.ts puts backups in a SIBLING of the data directory, which for a
// bench would be the shared temp root (or a real backup folder when the
// shell exports MAIPAI_BACKUP_DIR); pinned inside the bench's own
// directory, the fourth key tests/isolation.ts pins for the same reason.
process.env.MAIPAI_BACKUP_DIR = resolve(resolved, "backups");

export const benchDataDir = resolved;
export { finishBench, type BenchSummary } from "./finish";
