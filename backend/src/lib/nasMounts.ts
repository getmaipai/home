// Step 9: "NAS mounts declared with scan paths" (plan 4.15). See
// db/schema.ts's own comment on `nasMounts` for why this is declaration
// only - no media-library scanner exists yet to walk `scanPaths`, so
// this file just validates and stores what an admin types in.
import { eq } from "drizzle-orm";
import { existsSync, statSync } from "node:fs";
import { db } from "@/db";
import { nasMounts } from "@/db/schema";
import { newNasMountId } from "@/lib/id";

export interface NasMount {
  id: string;
  label: string;
  path: string;
  scanPaths: string[];
  createdAt: string;
  updatedAt: string;
}

function toMount(row: typeof nasMounts.$inferSelect): NasMount {
  return {
    id: row.id,
    label: row.label,
    path: row.path,
    scanPaths: JSON.parse(row.scanPaths) as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listNasMounts(): NasMount[] {
  return db.select().from(nasMounts).all().map(toMount);
}

export interface NasMountOpResult {
  ok: boolean;
  error?: string;
  value?: NasMount;
}

/** `path` is validated the same way backupTargets.ts's smb target is -
 * a real, already-mounted directory, never dialed by this hub. */
export function createNasMount(label: string, path: string, scanPaths: string[]): NasMountOpResult {
  const trimmedLabel = label.trim();
  const trimmedPath = path.trim();
  if (!trimmedLabel) return { ok: false, error: "label is required" };
  if (!trimmedPath) return { ok: false, error: "path is required" };
  if (!existsSync(trimmedPath)) return { ok: false, error: `${trimmedPath} does not exist - mount the share first` };
  if (!statSync(trimmedPath).isDirectory()) return { ok: false, error: `${trimmedPath} is not a directory` };

  const now = new Date().toISOString();
  const row = { id: newNasMountId(), label: trimmedLabel, path: trimmedPath, scanPaths: JSON.stringify(scanPaths), createdAt: now, updatedAt: now };
  db.insert(nasMounts).values(row).run();
  return { ok: true, value: toMount(row) };
}

export function deleteNasMount(id: string): boolean {
  const row = db.select({ id: nasMounts.id }).from(nasMounts).where(eq(nasMounts.id, id)).get();
  if (!row) return false;
  db.delete(nasMounts).where(eq(nasMounts.id, id)).run();
  return true;
}
