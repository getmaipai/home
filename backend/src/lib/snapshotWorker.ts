// A Worker that runs `VACUUM INTO` on its own connection to the live
// hub.db, so the snapshot never blocks the event loop and never re-opens
// the live database from the main thread (which would trip resetDb's
// guard and double-map the WAL file).
//
// The connection is read-ONLY in spirit but not in flag: a WAL-mode
// database opened with `readonly: true` refuses VACUUM INTO outright
// ("disk I/O error"), because the engine wants to manage its own
// journals. VACUUM INTO into a NEW file never modifies the source
// database's pages, so a second read-write handle on the same file
// is safe - the two connections coordinate through SQLite's own
// locking, which is exactly what a normal second reader would do.
//
// This file must not import @/db or anything that transitively does:
// module-level imports run at worker spawn, and a second open handle on
// the live database from the main thread is exactly what resetDb
// refuses.
//
// A node:worker_threads Worker runs as a plain Node worker, not a Bun
// Worker: `self` has no `onmessage` (Bun's Worker global), so messages
// arrive through node:worker_threads's own `parentPort`.
import { Database } from "bun:sqlite";
import { parentPort } from "node:worker_threads";

if (parentPort) {
  parentPort.on("message", ({ src, dst }: { src: string; dst: string }) => {
    const db = new Database(src);
    try {
      db.query("VACUUM INTO ?").run(dst);
      parentPort?.postMessage({ ok: true });
    } catch (err) {
      parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      db.close();
    }
  });
}
