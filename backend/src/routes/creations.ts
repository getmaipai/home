// CREATOR-02: what a person's own picture, clip or film was made from. Owner-only (the maker); a hidden item (a minor reaching an adult-only one, a file
// that is not theirs, a trashed one) answers "not found" exactly like a file that does not exist, and a locked one answers with the lock tile only.
import { Hono } from "hono";
import type { AppEnv } from "@/types";
import { requireAuth } from "@/middleware/auth";
import { lockedView } from "@/lib/adultLock";
import { backfillCreationForFile } from "@/lib/creations/backfill";
import { readCreationByFile } from "@/lib/creations/store";

export const creationsRoutes = new Hono<AppEnv>();
creationsRoutes.use("*", requireAuth);

creationsRoutes.get("/by-file/:fileId", (c) => {
  const read = readCreationByFile(c.get("person"), c.req.param("fileId"), undefined, backfillCreationForFile);
  if (read.state === "locked") return c.json({ ...lockedView(), code: "locked" }, 423);
  if (read.state === "none") return c.json({ error: "There is no record of how that was made. Open the item from your Library and try again.", code: "not_found" }, 404);
  return c.json(read.creation, 200);
});
