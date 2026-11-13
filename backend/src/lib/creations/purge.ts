// CREATOR-02: a purged file takes its creation record with it. Kept apart from store.ts (which reads the Library's rules) so `purgeFileRecord` in
// attachments.ts can call it without an import loop: this file touches only the database handle.
import { sqlite } from "@/db";

/** A purged file takes its record with it when it is the record's main file; a purged poster or 5.1 sibling only leaves the list. Called from `purgeFileRecord`. */
export function dropCreationsForFile(fileId: string): void {
  try {
    const rows = sqlite.query<{ id: string; file_ids: string; body: string }, [string]>("SELECT id, file_ids, body FROM creations WHERE EXISTS (SELECT 1 FROM json_each(creations.file_ids) WHERE value = ?)").all(fileId);
    for (const row of rows) {
      const ids = JSON.parse(row.file_ids) as string[];
      if (ids[0] === fileId || ids.length === 1) {
        sqlite.query("DELETE FROM creation_cast WHERE creation_id = ?").run(row.id);
        sqlite.query("DELETE FROM creations WHERE id = ?").run(row.id);
      } else {
        const rest = ids.filter((id) => id !== fileId);
        const body = JSON.parse(row.body) as { file_ids: string[] };
        body.file_ids = rest;
        sqlite.query("UPDATE creations SET file_ids = ?, body = ? WHERE id = ?").run(JSON.stringify(rest), JSON.stringify(body), row.id);
      }
    }
  } catch { /* a record that cannot be dropped is rebuilt or cleared by the next purge; the file purge never fails for it */ }
}

