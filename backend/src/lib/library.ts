import { sqlite } from "@/db";
import { canReadFileAudience, fileAudience, fileVisibilitySql } from "@/lib/access";
import { mediaKindSql } from "@/lib/storage/usage";
import { libraryProvenanceSql } from "@/lib/libraryProvenance";
import { trashTotals } from "@/lib/libraryTrash";
import { expiringLibraryFiles } from "@/lib/libraryRetention";
import type { PersonRow } from "@/types";

export interface LibraryQuery { limit?: number; cursor?: string; type?: string; owner?: string; shared?: "with-me" | "by-me"; search?: string; sort?: "newest" | "oldest" | "name" | "size" }
interface Cursor { v: 1; key: string | number; created: string; id: string; scope: string }
export class LibraryCursorError extends Error {}
function scope(q: LibraryQuery) { return JSON.stringify([q.type ?? "", q.owner ?? "", q.shared ?? "", q.search ?? "", q.sort ?? "newest"]); }
function cursor(q: LibraryQuery): Cursor | null {
  if (!q.cursor) return null;
  try {
    const c = JSON.parse(Buffer.from(q.cursor, "base64url").toString()) as Cursor;
    if (c.v !== 1 || c.scope !== scope(q) || typeof c.created !== "string" || typeof c.id !== "string" || !(typeof c.key === "string" || typeof c.key === "number")) throw new Error();
    return c;
  } catch { throw new LibraryCursorError("The page address is invalid. Open the Library again."); }
}

/** One joined read, with a grouped share relation so multiple pointers never multiply files. */
function base(actor: PersonRow, q: LibraryQuery) {
  const params: (string | number)[] = [actor.id, actor.id, actor.id];
  let filter = "1=1";
  if (q.type) { filter += " AND kind = ?"; params.push(q.type); }
  if (q.owner === "me") { filter += " AND owner_person_id = ?"; params.push(actor.id); }
  else if (q.owner === "household") filter += " AND owner_deleted_at IS NOT NULL";
  else if (q.owner) { filter += " AND owner_person_id = ?"; params.push(q.owner); }
  if (q.shared === "with-me") { filter += " AND owner_person_id != ?"; params.push(actor.id); }
  if (q.shared === "by-me") { filter += " AND owner_person_id = ? AND share_count > 0"; params.push(actor.id); }
  if (q.search) { filter += " AND (name LIKE ? ESCAPE '\\' OR prompt LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')"; const escaped = `%${q.search.replace(/[\\%_]/g, "\\$&")}%`; params.push(escaped, escaped, escaped); }
  // Companion relations only fold files when their parent passes the same viewer boundary.
  return { params, sql: `WITH meta AS (
    SELECT a.*, ${libraryProvenanceSql("a.provenance")} AS meta, ${mediaKindSql("a.media_type")} AS kind,
      p.display_name, p.deleted_at AS owner_deleted_at, coalesce(s.share_count,0) AS share_count, coalesce(s.household,0) AS household,
      pj.prompt AS picture_prompt, vj.prompt AS video_prompt, vj.request AS video_request,
      mj.request AS music_request, mj.duration_s, mj.cover_file_id
    FROM attachments a JOIN people p ON p.id = a.owner_person_id
    LEFT JOIN (SELECT file_id, count(DISTINCT "to") AS share_count, max("to" = 'household') AS household,
      max("to" = ? OR "to" = 'household') AS visible FROM shares GROUP BY file_id) s ON s.file_id = a.id
    LEFT JOIN picture_jobs pj ON pj.id = json_extract(${libraryProvenanceSql("a.provenance")},'$.job') AND pj.person_id = a.owner_person_id
    LEFT JOIN video_jobs vj ON vj.id = json_extract(${libraryProvenanceSql("a.provenance")},'$.job') AND vj.person_id = a.owner_person_id
    LEFT JOIN music_jobs mj ON mj.id = coalesce(json_extract(${libraryProvenanceSql("a.provenance")},'$.job_id'),json_extract(${libraryProvenanceSql("a.provenance")},'$.job')) AND mj.person_id = a.owner_person_id
    WHERE ${fileVisibilitySql(actor, "a", "s.visible")}
  ), named AS (
    SELECT *, coalesce(picture_prompt,video_prompt,json_extract(meta,'$.prompt'),'') AS prompt,
      coalesce(json_extract(CASE WHEN json_valid(music_request) THEN music_request ELSE '{}' END,'$.title'),json_extract(meta,'$.title'),'') AS title,
      coalesce(duration_s,json_extract(meta,'$.duration_seconds'),json_extract(meta,'$.seconds'),json_extract(CASE WHEN json_valid(video_request) THEN video_request ELSE '{}' END,'$.seconds')) AS duration,
      (EXISTS(SELECT 1 FROM music_jobs cm JOIN meta parent ON parent.id = cm.file_id
        WHERE cm.cover_file_id = m.id)
        OR (json_extract(meta,'$.writer') = 'video-poster' AND EXISTS(
          SELECT 1 FROM meta parent WHERE parent.owner_person_id = m.owner_person_id
            AND json_extract(parent.meta,'$.writer') = 'video-gen'
            AND json_extract(parent.meta,'$.job') = json_extract(m.meta,'$.job')))) AS companion
    FROM meta m
  ), visible AS (
    SELECT *, coalesce(nullif(file_name,''),nullif(title,''),nullif(prompt,''),(CASE kind WHEN 'image' THEN 'Picture' WHEN 'video' THEN 'Video' WHEN 'audio' THEN 'Audio' WHEN 'document' THEN 'Document' WHEN 'story' THEN 'Story' ELSE 'File' END || ', ' || CAST(strftime('%d',created_at) AS INTEGER) || ' ' || substr('JanFebMarAprMayJunJulAugSepOctNovDec',3*(CAST(strftime('%m',created_at) AS INTEGER)-1)+1,3))) AS name FROM named
  ), filtered AS (SELECT * FROM visible WHERE ${filter}),
  tiles AS (SELECT * FROM filtered f WHERE coalesce(companion,0) = 0
    AND NOT (json_extract(meta,'$.writer') = 'image-edit' AND EXISTS(SELECT 1 FROM filtered r WHERE r.id = json_extract(f.meta,'$.root') AND coalesce(r.companion,0) = 0)))` };
}

interface Row { id: string; kind: "image" | "video" | "audio" | "document" | "story" | "file"; name: string; media_type: string; size: number; created_at: string; owner_person_id: string; display_name: string; share_count: number; household: number; retention: string; provenance: string; duration: number | null; cover_file_id: string | null; thumbnail: string | null; versions: number }
export function listLibrary(actor: PersonRow, q: LibraryQuery) {
  const c = cursor(q);
  const b = base(actor,q);
  const sort = q.sort ?? "newest";
  const column = sort === "name" ? "name COLLATE NOCASE" : sort === "size" ? "size" : "created_at";
  const direction = sort === "oldest" || sort === "name" ? "ASC" : "DESC";
  const op = direction === "ASC" ? ">" : "<";
  let seek = "";
  if (c) { seek = `WHERE (${column}, created_at, id) ${op} (?, ?, ?)`; b.params.push(c.key,c.created,c.id); }
  const limit = q.limit ?? 60;
  b.params.push(limit + 1);
  const rows = sqlite.query<Row, (string | number)[]>(`${b.sql} SELECT *,
    coalesce((SELECT e.id FROM visible e WHERE json_extract(e.meta,'$.writer') = 'image-edit' AND json_extract(e.meta,'$.root') = tiles.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1),
      (SELECT p.id FROM visible p WHERE json_extract(p.meta,'$.writer') = 'video-poster' AND json_extract(p.meta,'$.job') = json_extract(tiles.meta,'$.job') ORDER BY p.id LIMIT 1),
      (SELECT c.id FROM visible c WHERE c.id = tiles.cover_file_id),id) AS thumbnail,
    1 + (SELECT count(*) FROM visible e WHERE json_extract(e.meta,'$.writer') = 'image-edit' AND json_extract(e.meta,'$.root') = tiles.id) AS versions
    FROM tiles ${seek} ORDER BY ${column} ${direction},created_at ${direction},id ${direction} LIMIT ?`).all(...b.params);
  const more = rows.length > limit;
  const page = rows.slice(0,limit);
  const last = page.at(-1);
  const expiring = expiringLibraryFiles(actor.id);
  return { items: page.filter(row => canReadFileAudience(actor, { ownerPersonId: row.owner_person_id, provenance: row.provenance })).map(row => ({ id: row.id, kind: row.kind, name: row.name, media_type: row.media_type, size_bytes: row.size, created_at: row.created_at,
    owner: { id: row.owner_person_id, display_name: row.display_name }, shared_with: { count: row.share_count, household: Boolean(row.household) },
    retention: row.retention, audience: fileAudience(row.provenance), duration_seconds: row.kind === "audio" || row.kind === "video" ? row.duration : null,
    thumb_url: `/api/files/${row.thumbnail}/thumb?w=320`, expires_at: expiring.get(row.id)?.expiresAt ?? null, version_count: row.versions })),
    next_cursor: more && last ? Buffer.from(JSON.stringify({ v: 1, key: sort === "name" ? last.name : sort === "size" ? last.size : last.created_at, created: last.created_at, id: last.id, scope: scope(q) })).toString("base64url") : null };
}
export function librarySummary(actor: PersonRow, q: LibraryQuery) {
  const b = base(actor,q);
  const rows = sqlite.query<{ kind: string; items: number; bytes: number }, (string | number)[]>(`${b.sql} SELECT kind,
    (SELECT count(*) FROM tiles t WHERE t.kind = f.kind) AS items,
    (SELECT coalesce(sum(u.size),0) FROM (SELECT sha256, max(size) AS size FROM filtered g WHERE g.kind = f.kind GROUP BY sha256) u) AS bytes
    FROM (SELECT DISTINCT kind FROM filtered) f`).all(...b.params);
  const per_kind: Record<string, { items: number; bytes: number }> = Object.fromEntries(["image","video","audio","document","story","file"].map(kind => [kind,{ items: 0, bytes: 0 }]));
  for (const row of rows) per_kind[row.kind] = { items: row.items, bytes: row.bytes };
  const expiring = expiringLibraryFiles(actor.id);
  // One total over the whole set, so identical bytes filed under two kinds are still counted once.
  const total = sqlite.query<{ bytes: number }, (string | number)[]>(`${b.sql} SELECT coalesce(sum(u.size),0) AS bytes FROM (SELECT max(size) AS size FROM filtered GROUP BY sha256) u`).get(...b.params)?.bytes ?? 0;
  return { items: rows.reduce((n,r) => n+r.items,0), bytes: total, per_kind, trash: trashTotals(actor), expiring: { items: expiring.size, bytes: [...expiring.values()].reduce((n, e) => n + e.size, 0) } };
}
