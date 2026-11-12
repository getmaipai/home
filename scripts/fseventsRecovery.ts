// HOST-GUARD-08: after the host guard restarted the Mac's file-event service and this dev hub restarted itself (scripts/dev.sh
// restart-hub), check as the owner that file watching works again: a file changed now is seen by a real watcher within the limit,
// and the file written during the restart window (before the hub stopped) is there after it. Counts and timestamps only.
//   bun scripts/fseventsRecovery.ts --probe <dir> --restarted-at <n> --token <text> --out <file> [--copy-to <file>] [--timeout-ms 15000]
// Exit 0 on pass, 1 on fail. The host guard reads the copy (in <data_dir>/host-guard/recovery/) and keeps new dev work paused on a fail.
import { watch, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface RecoveryResult { version: 1; checked_at: number; restarted_at: number; live_event_ms: number; window_seen: boolean; result: "pass" | "fail" }

export async function checkRecovery(opts: { probe: string; restartedAt: number; token: string; timeoutMs?: number; now?: () => number }): Promise<RecoveryResult> {
  const now = opts.now ?? Date.now;
  mkdirSync(opts.probe, { recursive: true });
  const windowFile = join(opts.probe, "window.txt");
  const windowSeen = existsSync(windowFile) && readFileSync(windowFile, "utf8").trim() === opts.token;
  const name = `live-${process.pid}-${now()}.txt`;
  const started = now();
  const liveEventMs = await new Promise<number>((resolve) => {
    let done = false;
    const finish = (ms: number) => { if (done) return; done = true; clearTimeout(timer); watcher.close(); resolve(ms); };
    const watcher = watch(opts.probe, (_event, file) => { if (file && String(file).endsWith(name)) finish(now() - started); });
    const timer = setTimeout(() => finish(-1), Math.max(0, opts.timeoutMs ?? 15_000));
    // Write after the watcher is listening; a short pause lets the stream start.
    setTimeout(() => { try { writeFileSync(join(opts.probe, name), String(started)); } catch { finish(-1); } }, 200);
  });
  return { version: 1, checked_at: Math.floor(now() / 1000), restarted_at: opts.restartedAt, live_event_ms: liveEventMs, window_seen: windowSeen, result: liveEventMs >= 0 && windowSeen ? "pass" : "fail" };
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const get = (k: string) => { const i = argv.indexOf(k); return i === -1 ? undefined : argv[i + 1]; };
  const probe = get("--probe"); const out = get("--out"); const token = get("--token") ?? "";
  const restartedAt = Number(get("--restarted-at"));
  if (!probe || !out || !Number.isInteger(restartedAt)) {
    console.error("usage: bun scripts/fseventsRecovery.ts --probe <dir> --restarted-at <n> --token <text> --out <file> [--copy-to <file>] [--timeout-ms N]");
    process.exit(2);
  }
  const result = await checkRecovery({ probe, restartedAt, token, timeoutMs: Number(get("--timeout-ms") ?? 15_000) });
  const text = `${JSON.stringify(result)}\n`;
  writeAtomic(out, text);
  const copy = get("--copy-to");
  if (copy) { try { writeAtomic(copy, text); } catch (error) { console.error(`Could not hand the result to the host guard at ${copy}: ${error instanceof Error ? error.message : String(error)}`); } }
  console.log(result.result === "pass"
    ? `File watching recovered: a change was seen in ${result.live_event_ms} ms and the restart-window file was picked up.`
    : `File watching did not recover (change seen: ${result.live_event_ms >= 0 ? "yes" : "no"}, restart-window file: ${result.window_seen ? "yes" : "no"}). Restart this dev hub: bash scripts/dev.sh stop, then bash scripts/dev.sh start.`);
  process.exit(result.result === "pass" ? 0 : 1);
}
