import { Hono } from "hono";
import { requireRole } from "@/middleware/auth";
import { listBackups, runBackup, pruneBackups } from "@/lib/backup";
import type { AppEnv } from "@/types";

export const backupsRoutes = new Hono<AppEnv>();

// Owner/admin only: unlike memory/conversation history, a backup isn't
// scoped to any one person, it's the whole household's data. No restore
// route: lib/backup.ts's restoreBackup() is real and tested, but wiring
// it to an HTTP route that clobbers the live database needs the staged
// update/rollback machinery (2.4) this build doesn't have yet; see that
// file's own comment for why.
backupsRoutes.get("/", requireRole("owner", "admin"), async (c) => c.json(listBackups()));

backupsRoutes.post("/run", requireRole("owner", "admin"), async (c) => {
  const info = runBackup();
  pruneBackups();
  return c.json(info);
});
