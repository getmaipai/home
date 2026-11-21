// TEMPLATE-02 (RULES.md C1, C3, C4, C9, C10, C11, E7, E8, 6a; design record data-scratch/reports/video-template-02-v4-2026-11-20.md): templates a person saves from a finished clip or
// picture, in the spec's `media-template` shape (spec 0.1.458). Private to the owner until "Share with home" (`shared_with: "household"`); never a share record. Cast is `cast_*`
// blanks in the words only, references and styles are empty, no model ids exist in the record. Rated at save time (the stricter of the words' rating and the source's stamp);
// listed only through `listTemplates`, which filters by the viewer's ceiling and the household setting. A person's lock on the source carries over; being unchecked never makes one.
import { eq, or } from "drizzle-orm";
import { isGuestRole } from "@/lib/audience";
import { MediaTemplate, type MediaTemplate as MediaTemplateRecord } from "@maipai/spec/gen/ts/media-template.js";
import { validateMediaTemplate } from "@maipai/spec/records/ts/validate.js";
import { db } from "@/db";
import { savedTemplates } from "@/db/schema";
import { lockState } from "@/lib/adultLock";
import { passForPerson } from "@/lib/filter/pass";
import { getStamp, getStamps } from "@/lib/filter/stamps";
import { stampAllowed } from "@/lib/filter/stampCompare";
import { adultStylesAllowed } from "@/lib/pictures/policy";
import type { PersonRow } from "@/types";

export type SavedKind = "picture" | "video";
export type VideoTemplateSettingsRow = { seconds: number; look?: string; camera?: string; orientation?: "landscape" | "portrait"; tier?: "standard" | "boost" | "max" };


export type Row = typeof savedTemplates.$inferSelect;



export function recordOf(row: Row): MediaTemplateRecord | null {
  const stamp = getStamp("template", row.id);
  const { fingerprint: _fingerprint, ...rating } = (stamp ?? {}) as Record<string, unknown>;
  const candidate = {
    id: row.id, kind: row.kind, title: row.title, summary: row.summary, category: row.category, audience: row.audience, prompt: row.prompt, references: [], styles: [],
    ...(row.aspect ? { aspect: row.aspect } : {}), provenance: row.provenance, created_at: row.createdAt, updated_at: row.updatedAt, hlc: row.hlc, owner_person_id: row.ownerPersonId,
    ...(row.sharedWith ? { shared_with: row.sharedWith } : {}), ...(stamp ? { content_rating: rating } : {}),
  };
  const parsed = MediaTemplate.safeParse(candidate);
  if (!parsed.success || validateMediaTemplate(parsed.data as never).length > 0) return null;
  return parsed.data;
}

/** The saved-template reader every list and lookup goes through: the viewer's own rows and the household-shared ones, kept only if the stamp is within the viewer's made-content ceiling,
 * a lock the viewer cannot open hides the row (absent, never shown locked: C10), and a guest never sees a household-shared row. */
export function visibleRows(actor: PersonRow, rows: Row[]): Row[] {
  const stamps = getStamps("template", rows.map((row) => row.id));
  const pass = passForPerson(actor);
  const ceiling = pass.ceiling.made, unrated = pass.unrated.has("made");
  return rows.filter((row) => {
    const owner = row.ownerPersonId === actor.id;
    if (!owner && (row.sharedWith !== "household" || isGuestRole(actor.role))) return false;
    if (!stampAllowed(stamps.get(row.id) ?? null, ceiling, unrated)) return false;
    if (row.lock === "on" && lockState({ ownerPersonId: row.ownerPersonId, madeAudience: row.audience as "all-ages" | "adult-only", lock: "on" }, actor) !== "open") return false;
    if (row.audience === "adult-only" && !adultStylesAllowed()) return false;   // the household check runs after the stamp filter, for saved rows too
    return true;
  });
}

export function listSavedTemplates(actor: PersonRow, kind?: SavedKind): MediaTemplateRecord[] {
  if (isGuestRole(actor.role)) return [];
  const rows = db.select().from(savedTemplates).where(or(eq(savedTemplates.ownerPersonId, actor.id), eq(savedTemplates.sharedWith, "household"))).all().filter((row) => !kind || row.kind === kind);
  return visibleRows(actor, rows).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(recordOf).filter((record): record is MediaTemplateRecord => record !== null);
}
export function getSavedTemplate(actor: PersonRow, id: string): MediaTemplateRecord | null {
  if (!id.startsWith("mtpl-") || isGuestRole(actor.role)) return null;
  const row = db.select().from(savedTemplates).where(eq(savedTemplates.id, id)).get();
  const seen = row ? visibleRows(actor, [row])[0] : undefined;
  return seen ? recordOf(seen) : null;
}
/** The video sidecar of a saved template (seconds, look, camera, orientation, level), or null for a bundled id. */
export function savedTemplateSettings(id: string): VideoTemplateSettingsRow | null {
  const row = db.select({ settings: savedTemplates.settings }).from(savedTemplates).where(eq(savedTemplates.id, id)).get();
  if (!row?.settings) return null;
  try { return JSON.parse(row.settings) as VideoTemplateSettingsRow; } catch { return null; }
}

