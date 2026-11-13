// CREATOR-03 (CREATOR-PORT-2026-11-13, docs/design/creatoros-port-2026-11-13.md section 7.4): what a synth appears in, read from the stored cast link
// (`creation_cast`), and the cast of a film as its rolling credits read it. Nothing here writes. The viewer rule is the Library's, reused as written: a
// creation is listed only when its main file passes `fileVisibilitySql` (owner, a share to the viewer or the household, the minor audience gate) and is
// not a locked item for this viewer (`lockedFilterSql`), and the record's own mark passes `lockState`. A locked or adult-only item is left out of the list
// and of every count, never named.
import { sqlite } from "@/db";
import { fileVisibilitySql, canReadFileAudience } from "@/lib/access";
import { lockState, lockedFilterSql, requestProof, type AdultProof } from "@/lib/adultLock";
import { libraryProvenanceSql } from "@/lib/libraryProvenance";
import type { PersonRow } from "@/types";
import type { Creation } from "./store";

export interface CreditItem {
  creation_id: string;
  kind: Creation["kind"];
  file_id: string;
  /** The picture that stands for the item: the poster of a clip or film when it has one the viewer may see, else the item's own file. */
  thumb_file_id: string;
  title: string;
  role: string;
  made_at: string;
  production_id: string | null;
}

interface Row {
  id: string; kind: string; file_ids: string; body: string; made_audience: string; lock: string; person_id: string; created_at: string;
  file_name: string; production_title: string | null;
}

const KIND_TITLE: Record<string, string> = { picture: "Picture", video: "Video", film: "Film", reel: "Reel", song: "Song", sound: "Sound", show: "Show" };
const sentence = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** Every item the viewer may open that this synth (one the caller already checked the viewer may use) is cast in, newest first. `subjectId` is the synth's own subject (a picture's cast carries it with no synth id). */
export function listSynthCreditItems(actor: PersonRow, synth: { id: string; subject_id?: string | null }, proof: AdultProof = requestProof()): CreditItem[] {
  const synthId = synth.id;
  const subjectId = synth.subject_id ?? "";
  const meta = libraryProvenanceSql("a.provenance");
  const rows = sqlite.query<Row, (string | number)[]>(`
    SELECT DISTINCT c.id, c.kind, c.file_ids, c.body, c.made_audience, c.lock, c.person_id, c.created_at, coalesce(nullif(a.file_name,''), (SELECT pj.prompt FROM picture_jobs pj WHERE pj.id = json_extract(${meta},'$.job') AND pj.person_id = a.owner_person_id),
        (SELECT vj.prompt FROM video_jobs vj WHERE vj.id = json_extract(${meta},'$.job') AND vj.person_id = a.owner_person_id)) AS file_name,
      (SELECT p.title FROM media_productions p WHERE p.id = json_extract(c.body,'$.production_id')) AS production_title
    FROM creation_cast cc
    JOIN creations c ON c.id = cc.creation_id
    JOIN attachments a ON a.id = json_extract(c.file_ids,'$[0]')
    LEFT JOIN (SELECT file_id, max("to" = ? OR "to" = 'household') AS visible FROM shares GROUP BY file_id) s ON s.file_id = a.id
    WHERE (cc.synth_id = ? OR (? != '' AND cc.subject_id = ?))
      AND ${fileVisibilitySql(actor, "a", "s.visible")}
      AND NOT ${lockedFilterSql(actor, meta, proof)}
    ORDER BY c.created_at DESC, c.id DESC LIMIT 500`).all(actor.id, synthId, subjectId, subjectId, actor.id, actor.id);
  const items: CreditItem[] = [];
  for (const row of rows) {
    const body = JSON.parse(row.body) as Creation;
    const fileIds = JSON.parse(row.file_ids) as string[];
    const main = fileIds[0]!;
    // The record's own mark must also be open for this viewer (a minor reaching an adult-only record, an adult without the unlock).
    if (lockState({ ownerPersonId: row.person_id, madeAudience: row.made_audience === "adult-only" ? "adult-only" : "all-ages", lock: row.lock === "off" ? "off" : "on" }, actor, proof) !== "open") continue;
    const poster = fileIds[1] && posterVisible(actor, fileIds[1]) ? fileIds[1] : main;
    const member = body.cast.find((entry) => entry.synth_id === synthId || (subjectId !== "" && entry.subject_id === subjectId));
    items.push({
      creation_id: row.id, kind: body.kind, file_id: main, thumb_file_id: poster,
      title: row.production_title?.trim() || row.file_name?.trim().slice(0, 80) || KIND_TITLE[body.kind] || "Item",
      role: sentence(member?.role?.trim() || "cast"), made_at: body.made_at, production_id: body.production_id ?? null,
    });
  }
  return items;
}

function posterVisible(actor: PersonRow, fileId: string): boolean {
  const row = sqlite.query<{ owner: string; provenance: string; visible: number | null }, [string, string]>(
    `SELECT a.owner_person_id AS owner, a.provenance, (SELECT max("to" = ? OR "to" = 'household') FROM shares WHERE file_id = a.id) AS visible FROM attachments a WHERE a.id = ? AND a.deleted_at IS NULL`).get(actor.id, fileId);
  if (!row || !canReadFileAudience(actor, { ownerPersonId: row.owner, provenance: row.provenance })) return false;
  return row.owner === actor.id || row.visible === 1;
}

export interface FilmCreditLine { role: string; name: string }

/**
 * The cast of a film as its rolling credits show it: the stored cast link first (the creation records of this production, which cover a film cut again after
 * its record exists), then the production's own stored cast (the list the film's record is written from); each member's name is the cast record's name and
 * the role is the one stored with it. Empty when nothing is stored (a film made before the store): the caller then falls back to the plan's names.
 */
export function storedFilmCredits(productionId: string, productionCast: ReadonlyArray<{ subject_id: string; role: string }>, nameOf: (subjectId: string) => string | null | undefined): FilmCreditLine[] {
  const rows = sqlite.query<{ body: string }, [string]>(`SELECT body FROM creations WHERE json_extract(body,'$.production_id') = ? ORDER BY created_at, id`).all(productionId);
  const members = new Map<string, string>();
  for (const row of rows) for (const entry of (JSON.parse(row.body) as Creation).cast) if (!members.has(entry.subject_id)) members.set(entry.subject_id, entry.role);
  for (const entry of productionCast) if (!members.has(entry.subject_id)) members.set(entry.subject_id, entry.role);
  const lines: FilmCreditLine[] = [];
  for (const [subjectId, role] of members) {
    const name = nameOf(subjectId)?.trim();
    if (name) lines.push({ role: sentence(role.trim() || "cast"), name: name.slice(0, 80) });
  }
  return lines.slice(0, 19);
}

/**
 * The lines a film's rolling credits show. Stored cast replaces only the plan's cast lines (a line naming a stored cast member or a member of the plan's own
 * cast); the plan's crew and other lines ("Directed by", "Music by") stay, in the plan's order, and the stored cast sits where the first replaced line was
 * (at the end when the plan had none). With nothing stored (a film made before the store) the plan's lines are used as they are.
 */
export function filmCreditLines(stored: readonly FilmCreditLine[], planCredits: readonly FilmCreditLine[], planCastNames: readonly string[] = []): FilmCreditLine[] {
  if (stored.length === 0) return [...planCredits];
  const castNames = new Set([...stored.map((line) => line.name), ...planCastNames].map((name) => name.trim().toLocaleLowerCase()));
  const out: FilmCreditLine[] = [];
  let placed = false;
  for (const line of planCredits) {
    if (castNames.has(line.name.trim().toLocaleLowerCase())) { if (!placed) { out.push(...stored); placed = true; } continue; }
    out.push(line);
  }
  if (!placed) out.push(...stored);
  return out;
}
