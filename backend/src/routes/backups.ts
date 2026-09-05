import { Hono } from "hono";
import { requireRole } from "@/middleware/auth";
import {
  listBackups,
  runBackup,
  pruneBackups,
  stageRestore,
  pendingRestore,
  cancelPendingRestore,
} from "@/lib/backup";
import { RestoreRefused } from "@/lib/restoreStaging";
import type { AppEnv } from "@/types";

export const backupsRoutes = new Hono<AppEnv>();

// Owner/admin only: unlike memory/conversation history, a backup isn't
// scoped to any one person, it's the whole household's data.
backupsRoutes.get("/", requireRole("owner", "admin"), async (c) => c.json(listBackups()));

backupsRoutes.post("/run", requireRole("owner", "admin"), async (c) => {
  const info = runBackup();
  pruneBackups();
  return c.json(info);
});

// Restore is owner-only, a deliberate step up from the owner/admin gate
// on the two routes above. Running a backup is additive and reversible;
// restoring replaces every person, memory and conversation in the house
// with an older set, including the roster that decides who is an admin
// in the first place. That is the household owner's call.
//
// Staging, not applying: see lib/restoreStaging.ts for why a running
// hub cannot safely swap its own live database, and what happens at the
// next restart instead.
backupsRoutes.get("/restore/pending", requireRole("owner", "admin"), (c) => {
  return c.json({ pending: pendingRestore() });
});

backupsRoutes.post("/restore/cancel", requireRole("owner"), (c) => {
  return c.json({ cancelled: cancelPendingRestore() });
});

backupsRoutes.post("/:filename/restore", requireRole("owner"), (c) => {
  const actor = c.get("person");
  const filename = c.req.param("filename");
  // Never a caller-supplied path. listBackups() is the only source of
  // truth for what exists, so a filename that isn't in it (a traversal
  // attempt, a stale name) is refused before anything touches the disk.
  if (!listBackups().some((b) => b.filename === filename)) {
    return c.json({ error: `no such backup: ${filename}` }, 404);
  }
  try {
    return c.json({ pending: stageRestore(filename, actor.id) });
  } catch (err) {
    // Only RestoreRefused messages are written for the person reading
    // them, so only those are passed through. A code review (2026-09-05)
    // found this returning every error verbatim, which sent a browser
    // Node's "Unsupported state or unable to authenticate data" for a
    // corrupt archive and, worse, an absolute server path out of the
    // data directory for a filesystem failure.
    if (err instanceof RestoreRefused) return c.json({ error: err.message }, 400);
    console.error(`[restore] staging ${filename} failed:`, err);
    return c.json({ error: "that backup could not be read. Try another one." }, 400);
  }
});
