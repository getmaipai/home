// STACK-LORAS-01 slice 4 (docs/plans/stack-owns-loras-2026-11-25.md): the ONE read of the household's LoRA library. The Stack holds the library
// (`GET /stack/v1/loras`); Home keeps no copy. This module reads it over the paired link into a short in-memory snapshot (a few seconds, never persisted,
// never written to the database) and turns each Stack record into the spec `Lora` the rest of Home already reads. Writes go to the Stack through `callStack`.
//
// Fail closed (the note, "Safety gates"): when the Stack cannot be read, the snapshot is empty. No style is listed, none is usable, and an id Home cannot
// resolve counts as adult-only (`videos/adultStyle.ts`). A snapshot older than `MAX_AGE_MS` also reads as empty, so a caller that forgot to `await
// refreshLoras()` never acts on stale audience data. A Stack record whose status is `drive_missing` is unavailable (`loraUsable`).
//
// The only Home-side data about a style is `lora_people`: the named adults of `availability.people`, keyed by id (E5: who may use something stays in Home).
import { db } from "@/db";
import { loraPeople } from "@/db/schema";
import { createStackHttp } from "@/lib/stack/http";
import { nextHlc } from "@/lib/hlc";
import { ALL_BASE_IDS } from "@/lib/loras/baseFamilies";
import { INGREDIENTS_LIBRARY_NAME } from "@/lib/videos/ingredientsAdapter";
import { Lora } from "@maipai/spec/gen/ts/lora.js";

export type { Lora };

/** What the Stack answers for one style (`GET /stack/v1/loras`). `home` is the spec record Home sent on import, kept as sent. */
export interface StackLoraView {
  id: string; media: "picture" | "video"; name: string; base_model: string; classification: "all-ages" | "adult-only"; /** Who set the nsfw tag: the download site's check or a Stack admin; absent or null on an older record. */ classification_origin?: "site" | "admin" | null; sha256: string; bytes: number; strength_default: number;
  trigger_words: string[]; licence: string; source_url: string | null; added_by: string | null; added_at: string; disk_id: string | null; disk_label: string;
  status: "ready" | "drive_missing" | "installing" | "failed"; status_note: string | null; removed_at: string | null; trash_until: string | null; preview: string | null;
  home: Record<string, unknown> | null;
}

export class LorasStackError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "LorasStackError"; }
}

const stack = createStackHttp({
  makeError: (status, code, message) => new LorasStackError(status, code, message),
  noStackMessage: "The engine isn't set up on this computer yet. Ask an admin to check Settings, Engine.",
  unreachableMessage: "The engine isn't answering, so styles can't be shown. Check that the engine is running, then try again.",
  timeoutMs: 20_000,
});
export const __setLorasFetchForTests = stack.__setFetchForTests;

/** A snapshot this fresh is reused; one older than the second figure is not read at all. */
export const FRESH_MS = 3_000;
export const MAX_AGE_MS = 15_000;

let snapshot: { at: number; ok: boolean; items: Lora[]; views: StackLoraView[] } | null = null;
let inflight: Promise<boolean> | null = null;
export function dropLoraSnapshot(): void { snapshot = null; }
export function __resetLoraSnapshotForTests(): void { snapshot = null; inflight = null; }
/** Test seam: the snapshot as if the Stack had just answered with these views. */
export function __primeLoraSnapshotForTests(views: readonly StackLoraView[]): void { snapshot = { at: Date.now(), ok: true, items: mapViews(stylesOnly(views)), views: stylesOnly(views) }; }

const BASES: readonly string[] = ALL_BASE_IDS;
const PERSON = /^person-[a-z0-9]{6,}$/;
const WHO = new Set(["admins", "adults", "people"]);

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

/** The named adults of each style (Home's own small table). */
function readPeople(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of db.select().from(loraPeople).all()) {
    try { const parsed = JSON.parse(row.people) as unknown; if (Array.isArray(parsed)) out.set(row.loraId, parsed.filter((p): p is string => typeof p === "string")); } catch { /* a row that does not parse names nobody */ }
  }
  return out;
}

/**
 * One Stack record as the spec `Lora`. The Stack's own fields are the truth for what it holds: audience (`classification`), name, words, strength, trash
 * state, drive and status. Fields only Home sent on import (description, add-ins, kind, licence text, `availability.who`) come from `home`, and a native Stack
 * record without them gets the safe default: admins only, a plain style, nothing to add. Null for a record Home cannot read (no id, a bad hash).
 */
export function loraFromStack(view: StackLoraView, people: ReadonlyMap<string, string[]>): Lora | null {
  const sha = String(view.sha256 ?? "").toLowerCase();
  if (typeof view.id !== "string" || !/^lora-[a-z0-9]{6,}$/.test(view.id) || !/^[a-f0-9]{64}$/.test(sha)) return null;
  const h = (view.home && typeof view.home === "object" ? view.home : {}) as Partial<Lora>;
  const media: Lora["media"] = view.media === "picture" ? "picture" : "video";
  const fromHome = typeof h.base_model === "string" && ["ltx-2.3", "ltx-2.5", "wan2.2-ti2v-5b", "unknown"].includes(h.base_model) ? h.base_model : null;
  // The spec's base list is the video engines only; a picture style's family stays a fact the Stack owns.
  const flat = media === "video" && BASES.includes(view.base_model) ? (view.base_model as Lora["base_model"]) : "unknown";
  const base = (fromHome ?? flat) as Lora["base_model"];
  const adultOnly = view.classification !== "all-ages";
  const addedAt = Date.parse(view.added_at ?? "") ? new Date(view.added_at).toISOString() : new Date(0).toISOString();
  const addedBy = view.added_by && PERSON.test(view.added_by) ? view.added_by : typeof h.added_by === "string" ? h.added_by : "stack";
  const def = Math.min(2, Math.max(0, Number.isFinite(view.strength_default) ? view.strength_default : 1));
  const hs = h.strength ?? { default: def, min: 0, max: media === "picture" ? 2 : Math.max(1.5, def) };
  const strength = { default: def, min: Math.min(hs.min, def), max: Math.max(hs.max, def) };
  const who = h.availability && WHO.has(h.availability.who) ? h.availability.who : "admins";
  const licence = h.licence ?? { id: (view.licence ?? "").slice(0, 80) || null, text: null, commercial_use: "unknown" as const, acknowledged_by: null, acknowledged_at: null };
  return {
    ...h,
    id: view.id,
    name: (view.name ?? "").trim().slice(0, 80) || view.id,
    kind: h.kind ?? "style",
    description: h.description ?? "",
    media,
    source: h.source ?? sourceOf(view.source_url),
    file: { sha256: sha, bytes: Math.min(4_294_967_296, Math.max(1, Math.floor(view.bytes || 1))), rank: h.file?.rank ?? null, modules: h.file?.modules ?? [], format: "safetensors" },
    base_model: base,
    compatible_with: fromHome && Array.isArray(h.compatible_with) ? h.compatible_with : base === "unknown" ? [] : [base],
    trigger_words: Array.isArray(view.trigger_words) ? view.trigger_words : [],
    trigger_position: h.trigger_position ?? "start",
    positive_addins: h.positive_addins ?? [], negative_addins: h.negative_addins ?? [], avoid_as_positive: h.avoid_as_positive ?? [],
    strength,
    audience: adultOnly ? "adult-only" : "all-ages",
    audience_set_by: adultOnly ? null : h.audience_set_by ?? addedBy,
    audience_set_at: adultOnly ? null : h.audience_set_at ?? addedAt,
    availability: { who, people: who === "people" ? people.get(view.id) ?? [] : [] },
    added_by: addedBy,
    added_at: addedAt,
    // The one global licence accept at the Stack replaced the per-install confirmation: a style in the library has been accepted.
    licence: { ...licence, acknowledged_by: licence.acknowledged_by ?? "stack", acknowledged_at: licence.acknowledged_at ?? addedAt },
    preview: h.preview ?? null,
    disk_id: view.disk_id ?? null,
    status: view.status ?? "ready",
    removed_at: view.removed_at ?? null,
    trash_until: view.trash_until ?? null,
    last_check: h.last_check ?? null,
    provenance: h.provenance ?? { origin: "install", job_id: null },
    created_at: h.created_at ?? addedAt,
    updated_at: h.updated_at ?? addedAt,
    hlc: h.hlc ?? "0:0:stack",
  } as Lora;
}

/** The Ingredients adapter is an engine part for "make a video from pictures", not a style: it never reaches a list or a picker. */
const stylesOnly = (views: readonly StackLoraView[]): StackLoraView[] => views.filter((view) => view.name !== INGREDIENTS_LIBRARY_NAME);

function mapViews(views: readonly StackLoraView[]): Lora[] {
  const people = readPeople();
  return views.flatMap((view) => { const lora = loraFromStack(view, people); return lora ? [lora] : []; });
}

/** One call to the Stack, answered as the Stack answered it. A refusal throws `LorasStackError` with the Stack's own sentence and code. */
export async function callStack(method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) };
  const res = await stack.request(path, init);
  if (!res.ok) return stack.failure(res, { fallback: (status) => `The engine answered ${status}. Try again in a moment.` });
  let parsed: unknown = {};
  try { parsed = await res.json(); } catch { /* an answer with no body is an empty object */ }
  return { status: res.status, body: parsed };
}

/** A style's preview picture bytes, or null when it has none or the Stack cannot be read. */
export async function stackPreview(id: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await stack.request(`/stack/v1/loras/${encodeURIComponent(id)}/preview`, { method: "GET" });
    if (!res.ok) return null;
    return { bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  } catch { return null; }
}

async function load(): Promise<boolean> {
  try {
    const [live, trash] = await Promise.all([callStack("GET", "/stack/v1/loras"), callStack("GET", "/stack/v1/loras?removed=true")]);
    const views = [...((live.body as { loras?: StackLoraView[] }).loras ?? []), ...((trash.body as { loras?: StackLoraView[] }).loras ?? [])];
    const kept = stylesOnly(views);
    snapshot = { at: Date.now(), ok: true, items: mapViews(kept), views: kept };
    return true;
  } catch {
    snapshot = { at: Date.now(), ok: false, items: [], views: [] };
    return false;
  }
}

/**
 * Reads the Stack's library into the snapshot unless the one held is under three seconds old (`force` always reads). Returns whether the library could be read.
 * Every async path that decides something about a style awaits this first; the sync readers below only ever see the snapshot.
 */
export async function refreshLoras(force = false): Promise<boolean> {
  if (!force && snapshot && snapshot.ok && Date.now() - snapshot.at < FRESH_MS) return true;
  if (inflight) { const running = inflight; if (!force) return running; await running.catch(() => undefined); }
  const run = load().finally(() => { if (inflight === run) inflight = null; });
  inflight = run;
  return run;
}

function current(): Lora[] { return snapshot && snapshot.ok && Date.now() - snapshot.at <= MAX_AGE_MS ? snapshot.items : []; }
/** Every record in the snapshot (removed ones included). Empty when the Stack could not be read: fail closed. */
export function listLoraRecords(): Lora[] { return current(); }
export function getLoraRecord(id: string): Lora | null { return current().find((lora) => lora.id === id) ?? null; }
/** The Stack's own flat record of one style (the facts Home does not copy into a `Lora`, such as a picture style's base family). Null when unreadable: fail closed. */
export function stackViewOf(id: string): StackLoraView | null { return snapshot && snapshot.ok && Date.now() - snapshot.at <= MAX_AGE_MS ? snapshot.views.find((v) => v.id === id) ?? null : null; }
/** Every Stack record in the snapshot (live and trash), for a pass-through that redacts each one by `loraAccess` before it leaves Home. Empty when the Stack cannot be read. */
export function listStackViews(): StackLoraView[] { return snapshot && snapshot.ok && Date.now() - snapshot.at <= MAX_AGE_MS ? snapshot.views : []; }
/** Whether the last read of the Stack worked and is still fresh. */
export function loraLibraryReadable(): boolean { return snapshot !== null && snapshot.ok && Date.now() - snapshot.at <= MAX_AGE_MS; }

/** The named adults of a style, written by an admin's availability change. Only adults are accepted (a minor or an unknown id is refused by the caller). */
export function setLoraPeople(id: string, people: readonly string[], by: string): void {
  const values = { people: JSON.stringify([...new Set(people)]), updatedAt: new Date().toISOString(), hlc: nextHlc(), provenance: `person:${by}` };
  db.insert(loraPeople).values({ loraId: id, ...values }).onConflictDoUpdate({ target: loraPeople.loraId, set: values }).run();
  dropLoraSnapshot();
}
