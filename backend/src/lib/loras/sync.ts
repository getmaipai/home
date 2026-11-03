// VIDEO-LORA-03 (docs/dev/loras.md): keeps the Home `Lora` records in step with the files the Stack holds, and is the one migration of the old preference
// store. The Stack owns the bytes and the facts read from them (hash, size, rank, base); Home owns the record. Rule 4, one store: every Stack LoRA that has no
// record gets one here (with the old `video_adapter_prefs` row folded in, then deleted), so nothing is lost and nothing keeps a second copy.
//
// A migrated record is usable by admins only (the owner's 2026-11-02 rule: a LoRA that was on for chat yesterday is admin-only today), and its audience is the
// Stack's classification; an all-ages one names the admin who last confirmed it as `audience_set_by` (the spec asks for an admin's explicit choice). A row that
// was `pending` (added, not yet confirmed) keeps its pending state as an unacknowledged licence until an admin opens it.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, videoAdapterPrefs } from "@/db/schema";
import { deleteLoraRecord, listLoraRecords, saveLora, type Lora } from "@/lib/loras/store";
import { StackVideoError, listVideoLoras, removeVideoLora, updateVideoLora, type StackVideoLora } from "@/lib/videos/stack";

const SYNC_MS = 10_000;
const PERSON = /^person-[a-z0-9]{6,}$/;
const BASES = ["ltx-2.3", "ltx-2.5", "wan2.2-ti2v-5b"] as const;
type Base = (typeof BASES)[number];

let lastSync = 0;
let inflight: Promise<void> | null = null;
export function dropLoraSyncCache(): void { lastSync = 0; }
export function __resetLoraSyncForTests(): void { lastSync = 0; inflight = null; }

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
export function recordFromStack(stack: StackVideoLora, pref: { enabled: boolean; updatedBy: string | null } | null, fallbackAdmin: string | null, now = new Date().toISOString()): Lora | null {
  const sha = String(stack.sha256 ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha) || !fallbackAdmin) return null;
  const pending = pref?.updatedBy === "pending";
  const confirmer = pref?.updatedBy && PERSON.test(pref.updatedBy) ? pref.updatedBy : fallbackAdmin;
  const base: Base | "unknown" = (BASES as readonly string[]).includes(stack.base_model) ? (stack.base_model as Base) : "unknown";
  const def = Math.min(2, Math.max(0, Number.isFinite(stack.strength_default) ? stack.strength_default : 1));
  const addedAt = iso(stack.added_at, now);
  const adultOnly = stack.classification !== "all-ages";
  return {
    id: stack.id,
    name: (stack.name ?? "").trim().slice(0, 80) || stack.id,
    kind: "style",
    description: "",
    media: "video",
    source: sourceOf(stack.source_url),
    file: { sha256: sha, bytes: Math.min(4_294_967_296, Math.max(1, Math.floor(stack.bytes || 1))), rank: Number.isInteger(stack.rank) && (stack.rank as number) >= 1 ? (stack.rank as number) : null, modules: [], format: "safetensors" },
    base_model: base,
    compatible_with: base === "unknown" ? [] : [base],
    trigger_words: cleanWords(stack.trigger_words ?? []),
    trigger_position: "start",
    positive_addins: [], negative_addins: [], avoid_as_positive: [],
    strength: { default: def, min: 0, max: Math.max(1.5, def) },
    audience: adultOnly ? "adult-only" : "all-ages",
    audience_set_by: adultOnly ? null : confirmer,
    audience_set_at: adultOnly ? null : addedAt,
    availability: { who: "admins", people: [] },
    added_by: stack.added_by && PERSON.test(stack.added_by) ? stack.added_by : fallbackAdmin,
    added_at: addedAt,
    licence: { id: (stack.licence ?? "").slice(0, 80) || null, text: null, commercial_use: "unknown", acknowledged_by: pending ? null : confirmer, acknowledged_at: pending ? null : addedAt },
    preview: null,
    removed_at: null,
    trash_until: null,
    last_check: null,
    provenance: { origin: "migration", job_id: null },
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
    // The Stack owns the facts read from the bytes.
    const sha = String(s.sha256 ?? "").toLowerCase();
    if (/^[a-f0-9]{64}$/.test(sha) && (sha !== have.file.sha256 || s.bytes !== have.file.bytes)) {
      try { saveLora({ ...have, file: { ...have.file, sha256: sha, bytes: Math.min(4_294_967_296, Math.max(1, Math.floor(s.bytes || 1))) } }, "migration"); } catch { /* keep the old facts */ }
    }
    // The Stack's own classification is the second lock, written by Home: a record that is adult-only is never all-ages there.
    if (have.audience === "adult-only" && s.classification === "all-ages") await updateVideoLora(s.id, { classification: "adult-only" }).catch(() => undefined);
  }
  // The 30-day trash: the file and the record go together.
  const now = new Date().toISOString();
  for (const r of records.values()) {
    if (r.trash_until !== null && r.trash_until <= now) {
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
