// MUSIC-STUDIO-S2, MUSIC-LISTEN-C5: the one store for the two records the Music studio keeps, a saved song style (SongStyle) and a
// band the household made (MadeArtist). Every row crosses the spec's generated validator, so a row is always the spec shape and
// the two kinds share one implementation: they differ only in table, id, display field and which input fields a client may set.
//
// Rule 6a: a title, a band name, a back story and the style words are a person's own words. Nothing here logs a record or any of
// its text; an error names the field, never its value.
//
// Who may do what: reading follows ownership (yourself, or an owner/admin for a child), plus what a record is shared to
// (`household`, or a list of people), plus starter styles (no owner) for everyone. A teen's records stay private unless the teen
// shares them. A child's records are made by a parent. Only the owner (or a parent for a child) changes or deletes a record.
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { SongStyle } from "@maipai/spec/gen/ts/song-style.js";
import { MadeArtist } from "@maipai/spec/gen/ts/made-artist.js";
import { MadeAlbum } from "@maipai/spec/gen/ts/made-album.js";
import { db } from "@/db";
import { attachments, madeAlbums, madeArtists, madeRevisions, people, songStyles } from "@/db/schema";
import { canAccessPerson, canReadFileAudience, getPersonRole } from "@/lib/access";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { nextHlc } from "@/lib/hlc";
import { newMadeAlbumId, newMadeArtistId, newMadeRevisionId, newSongStyleId } from "@/lib/id";
import { readableItem } from "@/lib/media/access";
import { evaluateSafety } from "@/lib/safety";
import type { PersonRow } from "@/types";

export type MadeKind = "song_style" | "made_artist" | "made_album";
export type StoreResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string };

type Row = typeof songStyles.$inferSelect;
type Rec = Record<string, unknown> & { id: string; owner_person_id?: string | null; shared_to?: unknown };

interface Kind {
  table: typeof songStyles | typeof madeArtists | typeof madeAlbums;
  schema: typeof SongStyle | typeof MadeArtist | typeof MadeAlbum;
  newId: () => string;
  /** The record field kept in the `name` column. */
  nameField: "title" | "name";
  /** Record fields a client may set. Everything else is the server's. */
  inputs: readonly string[];
  /** The origin a client-made record gets. */
  origin: "household" | "made";
  noun: string;
}

const KINDS: Record<MadeKind, Kind> = {
  song_style: { table: songStyles, schema: SongStyle, newId: newSongStyleId, nameField: "title", inputs: ["title", "style", "seed", "shared_to"], origin: "household", noun: "style" },
  made_artist: {
    table: madeArtists,
    schema: MadeArtist,
    newId: newMadeArtistId,
    nameField: "name",
    inputs: ["name", "backstory", "genres", "members", "portrait_file_id", "logo_file_id", "style", "seed", "shared_to"],
    origin: "made",
    noun: "band",
  },
  made_album: {
    table: madeAlbums,
    schema: MadeAlbum,
    newId: newMadeAlbumId,
    nameField: "title",
    inputs: ["title", "made_artist_id", "song_style_id", "blurb", "look", "cover_file_id", "cover_seed", "track_media_ids", "style", "seed", "shared_to"],
    origin: "made",
    noun: "album",
  },
};

export const MADE_KINDS = Object.keys(KINDS) as MadeKind[];

function personBand(personId: string): AgeBand {
  const row = db.select().from(people).where(eq(people.id, personId)).get();
  return row ? speakerAgeBand(row as unknown as PersonRow, new Date()) : "child";
}

function toRecord(kind: Kind, row: Row): Rec {
  const body = JSON.parse(row.body) as Record<string, unknown>;
  return kind.schema.parse({
    ...body,
    id: row.id,
    [kind.nameField]: row.name,
    origin: row.origin,
    owner_person_id: row.personId,
    source: row.source,
    provenance: row.provenance,
    hlc: row.hlc,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  }) as Rec;
}

function mayRead(actor: PersonRow, row: Row): boolean {
  if (row.deletedAt) return false;
  if (row.personId === null || row.personId === actor.id) return true;
  if (canAccessPerson(actor, row.personId)) return true;
  const shared = (JSON.parse(row.body) as Rec).shared_to;
  return shared === "household" || (Array.isArray(shared) && shared.includes(actor.id));
}

/** The owner, or a parent for a child's record. A child never changes their own; a starter is nobody's to change. */
function mayWrite(actor: PersonRow, personId: string | null): boolean {
  if (personId === null) return false;
  if (actor.id === personId) return personBand(personId) !== "child";
  return canAccessPerson(actor, personId);
}

function load(kind: Kind, id: string): Row | undefined {
  return db.select().from(kind.table).where(eq(kind.table.id, id)).get();
}

/** The output floor on save: a minor owner's text, or any shared text, is read with the strictest band involved, and a flagged
 * text is refused. An adult's own words are not floored. The text itself is never returned in the error. */
function floorRefuses(record: Rec, ownerId: string, actor: PersonRow): boolean {
  const bands: AgeBand[] = [personBand(ownerId), speakerAgeBand(actor, new Date())];
  // A record shared with the household or with people is read by whoever is on that list, a child included, so the child's floor
  // applies to what is saved from then on.
  if (record.shared_to !== null && record.shared_to !== undefined) bands.push("child");
  if (bands.every((b) => b === "adult")) return false;
  const band: AgeBand = bands.includes("child") ? "child" : "teen";
  const style = record.style as { description?: string; genres?: string[] } | undefined;
  const members = Array.isArray(record.members) ? (record.members as { name: string; role: string }[]) : [];
  const texts = [
    record.title, record.name, record.backstory, record.blurb, record.look, style?.description, ...(style?.genres ?? []), ...((record.genres as string[] | undefined) ?? []),
    ...members.flatMap((m) => [m.name, m.role]),
  ];
  return texts.some((t) => typeof t === "string" && t !== "" && evaluateSafety(t, band).flagged);
}

/** Every file or library id in a record must be one the actor can read, so a record never points at someone else's file. */
function badReference(actor: PersonRow, record: Rec): string | null {
  const fileIds: unknown[] = [record.portrait_file_id, record.logo_file_id, record.cover_file_id];
  if (Array.isArray(record.members)) for (const m of record.members as { portrait_file_id?: string | null }[]) fileIds.push(m.portrait_file_id);
  const seed = record.seed as { file_id?: string; media_id?: string } | null | undefined;
  if (seed?.file_id) fileIds.push(seed.file_id);
  for (const fid of fileIds) {
    if (typeof fid !== "string") continue;
    const file = db.select().from(attachments).where(eq(attachments.id, fid)).get();
    if (!file || file.deletedAt || !canReadFileAudience(actor, file)) return "a file this refers to was not found";
  }
  if (seed?.media_id && !readableItem(actor, seed.media_id)) return "the library item this refers to was not found";
  // An album lists songs by id: each must be a song the actor can read, and its band and starting style must be theirs to see.
  if (Array.isArray(record.track_media_ids)) {
    for (const mediaId of record.track_media_ids) if (typeof mediaId !== "string" || !readableItem(actor, mediaId)) return "a song this album lists was not found";
  }
  if (typeof record.made_artist_id === "string" && !getMade("made_artist", actor, record.made_artist_id).ok) return "the band this refers to was not found";
  if (typeof record.song_style_id === "string" && !getMade("song_style", actor, record.song_style_id).ok) return "the song style this refers to was not found";
  return null;
}

function parseOrRefuse(kind: Kind, candidate: Record<string, unknown>): StoreResult<Rec> {
  const parsed = kind.schema.safeParse(candidate);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") || "record";
    return { ok: false, status: 400, error: `${path} is not valid` };
  }
  return { ok: true, value: parsed.data as Rec };
}

function rowFromRecord(kind: Kind, rec: Rec): Row {
  const { id, owner_person_id, source, provenance, hlc, created_at, updated_at, deleted_at, origin, ...rest } = rec as Rec & Record<string, unknown>;
  const name = String(rest[kind.nameField]);
  delete rest[kind.nameField];
  return {
    id,
    personId: (owner_person_id as string | null | undefined) ?? null,
    name,
    origin: origin as string,
    body: JSON.stringify(rest),
    source: source as string,
    provenance: provenance as string,
    hlc: hlc as string,
    createdAt: created_at as string,
    updatedAt: updated_at as string,
    deletedAt: (deleted_at as string | null | undefined) ?? null,
  };
}

function pickInputs(kind: Kind, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of kind.inputs) if (input[key] !== undefined) out[key] = input[key];
  return out;
}

export function listMade(kindName: MadeKind, actor: PersonRow, opts: { person?: string; scope?: "mine" | "shared" | "all" } = {}): StoreResult<Rec[]> {
  const kind = KINDS[kindName];
  if (kindName === "song_style") ensureStarterStyles();
  const target = opts.person ?? actor.id;
  if (!canAccessPerson(actor, target) || getPersonRole(target) === undefined) return { ok: false, status: 404, error: "person not found" };
  const rows = db.select().from(kind.table).where(isNull(kind.table.deletedAt)).orderBy(desc(kind.table.updatedAt), asc(kind.table.id)).all();
  const scope = opts.scope ?? "mine";
  const picked = rows.filter((row) => {
    const own = row.personId === target;
    if (scope === "mine") return own;
    const others = row.personId === null || (row.personId !== target && mayRead(actor, row));
    return scope === "shared" ? others : own || others;
  });
  return { ok: true, value: picked.filter((row) => mayRead(actor, row)).map((row) => toRecord(kind, row)) };
}

export function getMade(kindName: MadeKind, actor: PersonRow, id: string): StoreResult<Rec> {
  const kind = KINDS[kindName];
  if (kindName === "song_style" && id.startsWith("sstyle-starter")) ensureStarterStyles();
  const row = load(kind, id);
  if (!row || !mayRead(actor, row)) return { ok: false, status: 404, error: `${kind.noun} not found` };
  return { ok: true, value: toRecord(kind, row) };
}

export function createMade(kindName: MadeKind, actor: PersonRow, input: Record<string, unknown>, person?: string | null): StoreResult<Rec> {
  const kind = KINDS[kindName];
  const target = person ?? actor.id;
  if (!canAccessPerson(actor, target) || getPersonRole(target) === undefined) return { ok: false, status: 404, error: "person not found" };
  if (!mayWrite(actor, target)) return { ok: false, status: 403, error: `a child's ${kind.noun}s are made by a parent` };
  const now = new Date().toISOString();
  const candidate = {
    ...pickInputs(kind, input),
    id: kind.newId(),
    origin: kind.origin,
    owner_person_id: target,
    source: "hub",
    provenance: `${actor.id} (${actor.id === target ? "self" : "parent"})`,
    hlc: nextHlc(),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  const checked = parseOrRefuse(kind, candidate);
  if (!checked.ok) return checked;
  if (floorRefuses(checked.value, target, actor)) return { ok: false, status: 400, error: `that text is not allowed in a child's or teen's ${kind.noun}` };
  const bad = badReference(actor, checked.value);
  if (bad) return { ok: false, status: 400, error: bad };
  db.insert(kind.table).values(rowFromRecord(kind, checked.value)).run();
  return { ok: true, value: checked.value };
}

const FILE_FIELDS = ["portrait_file_id", "logo_file_id", "cover_file_id"];

/** `silent`: the change is the hub filling in its own work (a finished picture, a song joining an album), not a person's edit. A picture
 * that fills an empty slot is always silent; one that replaces a picture keeps the old version. */
export function updateMade(kindName: MadeKind, actor: PersonRow, id: string, patch: Record<string, unknown>, opts: { silent?: boolean } = {}): StoreResult<Rec> {
  const kind = KINDS[kindName];
  const row = load(kind, id);
  if (!row || !mayRead(actor, row)) return { ok: false, status: 404, error: `${kind.noun} not found` };
  if (!mayWrite(actor, row.personId)) return { ok: false, status: 403, error: `you can see this ${kind.noun}, not change it` };
  const changes = pickInputs(kind, patch);
  if (Object.keys(changes).length === 0) return { ok: false, status: 400, error: "nothing to change" };
  const current = toRecord(kind, row);
  const candidate = { ...current, ...changes, hlc: nextHlc(), updated_at: new Date().toISOString(), provenance: `${actor.id} (${actor.id === row.personId ? "self" : "parent"})` };
  const checked = parseOrRefuse(kind, candidate);
  if (!checked.ok) return checked;
  if (floorRefuses(checked.value, row.personId!, actor)) return { ok: false, status: 400, error: `that text is not allowed in a child's or teen's ${kind.noun}` };
  const bad = badReference(actor, checked.value);
  if (bad) return { ok: false, status: 400, error: bad };
  const next = rowFromRecord(kind, checked.value);
  const keys = Object.keys(changes);
  const fillsEmptyFile = keys.every((k) => FILE_FIELDS.includes(k) && (current as Record<string, unknown>)[k] == null);
  if (!opts.silent && !fillsEmptyFile) keepRevision(kindName, row, actor, "edit");
  db.update(kind.table).set({ name: next.name, body: next.body, provenance: next.provenance, hlc: next.hlc, updatedAt: next.updatedAt }).where(eq(kind.table.id, id)).run();
  return { ok: true, value: checked.value };
}

/** Deleting stamps `deleted_at` so a syncing client drops the record; the row stays until a purge. */
export function deleteMade(kindName: MadeKind, actor: PersonRow, id: string): StoreResult<{ id: string }> {
  const kind = KINDS[kindName];
  const row = load(kind, id);
  if (!row || !mayRead(actor, row)) return { ok: false, status: 404, error: `${kind.noun} not found` };
  if (!mayWrite(actor, row.personId)) return { ok: false, status: 403, error: `you can see this ${kind.noun}, not delete it` };
  const now = new Date().toISOString();
  db.update(kind.table).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(and(eq(kind.table.id, id), isNull(kind.table.deletedAt))).run();
  return { ok: true, value: { id } };
}

/** Keep the record's current version before something replaces it wholesale (a remake). Nothing happens when it is not the actor's to change. */
export function reviseMade(kindName: MadeKind, actor: PersonRow, id: string, reason: "edit" | "remake"): void {
  const row = load(KINDS[kindName], id);
  if (row && mayRead(actor, row) && mayWrite(actor, row.personId)) keepRevision(kindName, row, actor, reason);
}

/** MUSIC-STUDIO-EDIT: keep the version a record has now, before an edit or a remake replaces it. The earlier version stays
 * retrievable (listRevisions); nothing here is ever a silent overwrite. */
export function keepRevision(kindName: MadeKind, row: Row, actor: PersonRow, reason: "edit" | "remake"): void {
  db.insert(madeRevisions).values({
    id: newMadeRevisionId(), kind: kindName, recordId: row.id, personId: row.personId,
    body: JSON.stringify(toRecord(KINDS[kindName], row)), reason,
    provenance: `${actor.id} (${actor.id === row.personId ? "self" : "parent"})`, hlc: nextHlc(), createdAt: new Date().toISOString(),
  }).run();
}

export interface MadeRevision { id: string; reason: "edit" | "remake"; created_at: string; provenance: string; record: Rec }

/** The earlier versions of a record, newest first. Only someone who may change the record sees them. */
export function listRevisions(kindName: MadeKind, actor: PersonRow, id: string): StoreResult<MadeRevision[]> {
  const kind = KINDS[kindName];
  const row = load(kind, id);
  if (!row || !mayRead(actor, row)) return { ok: false, status: 404, error: `${kind.noun} not found` };
  if (!mayWrite(actor, row.personId)) return { ok: false, status: 403, error: `you can see this ${kind.noun}, not its earlier versions` };
  const rows = db.select().from(madeRevisions).where(and(eq(madeRevisions.kind, kindName), eq(madeRevisions.recordId, id))).orderBy(desc(madeRevisions.createdAt), desc(madeRevisions.id)).all();
  return { ok: true, value: rows.map((r) => ({ id: r.id, reason: r.reason as "edit" | "remake", created_at: r.createdAt, provenance: r.provenance, record: JSON.parse(r.body) as Rec })) };
}

/** Put an earlier version back. The version being replaced is kept too, so restoring is itself undoable. */
export function restoreRevision(kindName: MadeKind, actor: PersonRow, id: string, revisionId: string): StoreResult<Rec> {
  const found = listRevisions(kindName, actor, id);
  if (!found.ok) return found;
  const revision = found.value.find((r) => r.id === revisionId);
  if (!revision) return { ok: false, status: 404, error: "that earlier version was not found" };
  const kind = KINDS[kindName];
  const fields = pickInputs(kind, { ...revision.record, [kind.nameField]: revision.record[kind.nameField] });
  return updateMade(kindName, actor, id, fields);
}

/** A starter song style: a sound to begin from. Owned by nobody, readable by everyone, changed by no one (copy it to make it yours). */
const STARTERS: ReadonlyArray<{ id: string; title: string; description: string; genres: string[]; bpm: number; key?: string; instrumental?: boolean }> = [
  { id: "sstyle-starterlullaby", title: "Soft lullaby", description: "Slow and gentle, soft piano and a warm hum, easy to fall asleep to.", genres: ["lullaby", "ambient"], bpm: 68, key: "C major" },
  { id: "sstyle-starterfunkroad", title: "Sunny road trip", description: "Bright guitars, steady drums and a big singalong chorus, windows down.", genres: ["pop", "rock"], bpm: 118, key: "G major" },
  { id: "sstyle-starterlofifocus", title: "Lofi focus", description: "Dusty beats, mellow keys and no singing, calm enough to study to.", genres: ["lofi", "chillhop"], bpm: 82, key: "A minor", instrumental: true },
  { id: "sstyle-starterdancefloor", title: "Kitchen dance party", description: "Punchy bass, handclaps and a bouncy beat that makes everyone move.", genres: ["dance", "disco"], bpm: 124, key: "D minor" },
  { id: "sstyle-starterfolkporch", title: "Porch folk", description: "Acoustic guitar, a plain warm voice and a story told slowly.", genres: ["folk", "acoustic"], bpm: 92, key: "E major" },
  { id: "sstyle-starterepicscore", title: "Big adventure", description: "Sweeping strings, booming drums and a theme that builds and builds.", genres: ["cinematic", "orchestral"], bpm: 100, key: "D minor", instrumental: true },
];

/** Writes the starter styles once (idempotent, by id). Called when styles are listed or read, so a fresh hub has a shelf to begin from. */
export function ensureStarterStyles(): void {
  const have = new Set(db.select({ id: songStyles.id }).from(songStyles).where(isNull(songStyles.personId)).all().map((r) => r.id));
  const now = new Date().toISOString();
  for (const s of STARTERS) {
    if (have.has(s.id)) continue;
    const style = { description: s.description, genres: s.genres, bpm: s.bpm, ...(s.key ? { key: s.key } : {}), instrumental: s.instrumental ?? false };
    const rec = SongStyle.parse({ id: s.id, title: s.title, origin: "starter", owner_person_id: null, style, seed: null, shared_to: null, source: "hub", provenance: "music:starter", hlc: nextHlc(), created_at: now, updated_at: now, deleted_at: null });
    db.insert(songStyles).values(rowFromRecord(KINDS.song_style, rec as Rec)).run();
  }
}
