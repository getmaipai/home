// VIDEO-LORA-03 (docs/dev/loras.md): keeps the Home `Lora` records in step with the files the Stack holds, and is the one migration of the old preference
// store. The Stack owns the bytes and the facts read from them (hash, size, rank, base); Home owns the record. Rule 4, one store: every Stack LoRA that has no
// record gets one here (with the old `video_adapter_prefs` row folded in, then deleted), so nothing is lost and nothing keeps a second copy.
//
// A migrated record is usable by admins only (the owner's 2026-11-02 rule: a LoRA that was on for chat yesterday is admin-only today), and its audience is the
// Stack's classification; an all-ages one names the admin who last confirmed it as `audience_set_by` (the spec asks for an admin's explicit choice). A row that
// was `pending` (added, not yet confirmed) keeps its pending state as an unacknowledged licence until an admin opens it.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, pictureAdapterPrefs, videoAdapterPrefs } from "@/db/schema";
import { ALL_BASE_IDS, type BaseId } from "@/lib/loras/baseFamilies";
import { deleteLoraRecord, getLoraRecord, listLoraRecords, saveLora, type Lora } from "@/lib/loras/store";
import { clipsUsingStyle } from "@/lib/loras/usage";
import { patchLora, type StackLora } from "@/lib/pictures/stack";
import { StackVideoError, listVideoLoras, removeVideoLora, updateVideoLora, type StackVideoLora } from "@/lib/videos/stack";

const SYNC_MS = 10_000;
const PERSON = /^person-[a-z0-9]{6,}$/;
const BASES: readonly string[] = ALL_BASE_IDS;
type Base = BaseId;

let lastSync = 0;
let inflight: Promise<void> | null = null;
let picturesInflight: Promise<void> | null = null;
export function dropLoraSyncCache(): void { lastSync = 0; }
export function __resetLoraSyncForTests(): void { lastSync = 0; inflight = null; picturesInflight = null; }

/** The household owner: the admin a migrated record names when the old row named nobody usable. */
function ownerId(): string | null {
  const row = db.select({ id: people.id }).from(people).where(eq(people.role, "owner")).all()[0];
  return row?.id ?? null;
}

function cleanWords(words: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of words) {
    // eslint-disable-next-line no-control-regex
    const word = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (word && !out.some((w) => w.toLowerCase() === word.toLowerCase())) out.push(word);
  }
  return out.slice(0, 12);
}

function sourceOf(url: string | null): Lora["source"] {
  const none = { site: "file" as const, url: null, remote_id: null, version_id: null, token_ref: null };
  if (!url || url.length > 2048) return none;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "huggingface.co" || host.endsWith(".huggingface.co")) return { site: "huggingface", url, remote_id: null, version_id: null, token_ref: null };
    if (host === "civitai.com" || host.endsWith(".civitai.com")) return { site: "civitai", url, remote_id: null, version_id: null, token_ref: null };
  } catch { /* not a URL: a file */ }
  return none;
}

const iso = (value: string | undefined, fallback: string): string => { const t = Date.parse(value ?? ""); return Number.isNaN(t) ? fallback : new Date(t).toISOString(); };

/** The `Lora` record of a Stack file that has none yet, or null when the file cannot be made into a valid one (no owner to name, a malformed hash). */
export function recordFromStack(stack: StackVideoLora, pref: { enabled: boolean; updatedBy: string | null } | null, fallbackAdmin: string | null, now = new Date().toISOString(), media: "video" | "picture" = "video"): Lora | null {
  const sha = String(stack.sha256 ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha) || !fallbackAdmin) return null;
  const addedBy = /^added:(.+)$/.exec(pref?.updatedBy ?? "")?.[1] ?? null;
  const pending = pref?.updatedBy === "pending" || (media === "picture" && addedBy !== null && pref?.enabled === false);
  const confirmer = pref?.updatedBy && PERSON.test(pref.updatedBy) ? pref.updatedBy : addedBy ?? fallbackAdmin;
  // The spec's base list is the video engines only; a picture style's model family stays a fact the Stack owns (read at use, never copied here).
  const base: Base | "unknown" = media === "video" && (BASES as readonly string[]).includes(stack.base_model) ? (stack.base_model as Base) : "unknown";
  const def = Math.min(2, Math.max(0, Number.isFinite(stack.strength_default) ? stack.strength_default : 1));
  const addedAt = iso(stack.added_at, now);
  const adultOnly = stack.classification !== "all-ages";
  return {
    id: stack.id,
    name: (stack.name ?? "").trim().slice(0, 80) || stack.id,
    kind: "style",
    description: "",
    media,
    source: sourceOf(stack.source_url),
    file: { sha256: sha, bytes: Math.min(4_294_967_296, Math.max(1, Math.floor(stack.bytes || 1))), rank: Number.isInteger(stack.rank) && (stack.rank as number) >= 1 ? (stack.rank as number) : null, modules: [], format: "safetensors" },
    base_model: base,
    compatible_with: base === "unknown" ? [] : [base],
    trigger_words: cleanWords(stack.trigger_words ?? []),
    trigger_position: "start",
    positive_addins: [], negative_addins: [], avoid_as_positive: [],
    strength: media === "picture" ? { default: def, min: 0, max: 2 } : { default: def, min: 0, max: Math.max(1.5, def) },
    audience: adultOnly ? "adult-only" : "all-ages",
    audience_set_by: adultOnly ? null : confirmer,
    audience_set_at: adultOnly ? null : addedAt,
    // A video style migrates admin-only (the owner's 2026-11-02 rule). A picture style keeps what the household had: on for adults unless it was switched off.
    availability: { who: media === "picture" && pref?.enabled !== false ? "adults" : "admins", people: [] },
    added_by: stack.added_by && PERSON.test(stack.added_by) ? stack.added_by : fallbackAdmin,
    added_at: addedAt,
    licence: { id: (stack.licence ?? "").slice(0, 80) || null, text: null, commercial_use: "unknown", acknowledged_by: pending ? null : confirmer, acknowledged_at: pending ? null : addedAt },
    preview: null,
    removed_at: null,
    trash_until: null,
    last_check: null,
    provenance: { origin: media === "picture" && addedBy !== null ? "file" : "migration", job_id: null },
    created_at: now,
    updated_at: now,
    hlc: "0:0:migrate",
  };
}

async function run(): Promise<void> {
  let stack: StackVideoLora[];
  try { stack = await listVideoLoras(); } catch { return; }
  lastSync = Date.now();
  const records = new Map(listLoraRecords().map((r) => [r.id, r]));
  const prefs = new Map(db.select().from(videoAdapterPrefs).all().map((row) => [row.adapterId, row]));
  const owner = ownerId();
  for (const s of stack) {
    const have = records.get(s.id);
    if (!have) {
      const made = recordFromStack(s, prefs.get(s.id) ?? null, owner);
      if (!made) continue;
      try {
        saveLora(made, "migration");
        db.delete(videoAdapterPrefs).where(eq(videoAdapterPrefs.adapterId, s.id)).run();
      } catch { /* a file that cannot be made a valid record stays unlisted, and so unusable: fail closed */ }
      continue;
    }
    // The Stack owns the facts read from the bytes. Written from the record as it is NOW, not the snapshot above: an admin's edit made while an earlier file was
    // being mirrored must not be written back over.
    const sha = String(s.sha256 ?? "").toLowerCase();
    const current = getLoraRecord(s.id) ?? have;
    if (/^[a-f0-9]{64}$/.test(sha) && (sha !== current.file.sha256 || s.bytes !== current.file.bytes)) {
      try { saveLora({ ...current, file: { ...current.file, sha256: sha, bytes: Math.min(4_294_967_296, Math.max(1, Math.floor(s.bytes || 1))) } }, "migration"); } catch { /* keep the old facts */ }
    }
    // The Stack's own classification is the second lock, written by Home: a record that is adult-only is never all-ages there.
    if (have.audience === "adult-only" && s.classification === "all-ages") await updateVideoLora(s.id, { classification: "adult-only" }).catch(() => undefined);
  }
  // The 30-day trash: the file and the record go together.
  const now = new Date().toISOString();
  for (const r of records.values()) {
    if (r.trash_until !== null && r.trash_until <= now) {
      // Re-read: an admin may have restored it while an earlier file was being removed (a snapshot taken before the awaits would delete a restored style).
      const live = getLoraRecord(r.id);
      if (!live || live.trash_until === null || live.trash_until > now) continue;
      // A clip being made with it right now keeps the style: the purge tries again on a later sync.
      if (clipsUsingStyle(r.id, ["queued", "running"]).length > 0) continue;
      // The record goes only when the file is gone (or was already): a Stack that could not delete it keeps the record, and the purge tries again.
      const gone = await removeVideoLora(r.id).then(() => true, (error: unknown) => error instanceof StackVideoError && error.status === 404);
      if (gone) deleteLoraRecord(r.id);
    }
  }
}

/** Brings the records up to date with the Stack's library (at most once every 10 seconds; a Stack that does not answer changes nothing). */
export async function syncLoras(force = false): Promise<void> {
  if (!force && Date.now() - lastSync < SYNC_MS) return;
  if (!inflight) inflight = run().finally(() => { inflight = null; });
  await inflight;
}

/**
 * VIDEO-LORA-12: the picture styles join the same table. Every Stack picture style that has no record gets one (the old `picture_adapter_prefs` row folded in, then
 * deleted), and a record that is adult-only is never all-ages on the Stack (the second lock, written by Home). Never throws: a file that cannot be made a valid
 * record stays unlisted and so unusable (fail closed).
 */
export async function adoptPictureLoras(stack: readonly StackLora[], addedBy: string | null = null): Promise<void> {
  // Calls run one after another: a call that names who just added a style must not be answered by an earlier call that never heard of it.
  const before = picturesInflight ?? Promise.resolve();
  const mine: Promise<void> = (async () => {
    await before.catch(() => undefined);
    const prefs = new Map(db.select().from(pictureAdapterPrefs).all().map((row) => [row.adapterId, row]));
    const owner = ownerId();
    for (const s of stack) {
      const have = getLoraRecord(s.id);
      if (!have) {
        // A style an admin just added starts switched off and unconfirmed, whatever the old row says.
        const pref = addedBy ? { enabled: false, updatedBy: `added:${addedBy}` } : prefs.get(s.id) ?? null;
        const made = recordFromStack(s as unknown as StackVideoLora, pref, owner, undefined, "picture");
        if (!made) continue;
        try {
          saveLora(made, "migration");
          db.delete(pictureAdapterPrefs).where(eq(pictureAdapterPrefs.adapterId, s.id)).run();
        } catch (error) { console.warn(`[loras] picture style ${s.id} could not be adopted and stays unlisted: ${(error as Error).message}`); }
      } else if (have.media === "picture" && have.audience === "adult-only" && s.classification === "all-ages") {
        await patchLora(s.id, { classification: "adult-only" }).catch(() => undefined);
      }
    }
  })();
  picturesInflight = mine;
  return mine.finally(() => { if (picturesInflight === mine) picturesInflight = null; });
}
