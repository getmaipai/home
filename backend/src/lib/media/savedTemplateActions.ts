// TEMPLATE-02: the actions behind "Save as a template", rename, delete and Share with home (the readers are in savedTemplates.ts). See that file's header for the rules.
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { MediaTemplate as MediaTemplateRecord } from "@maipai/spec/gen/ts/media-template.js";
import { ContentRating, rankOf, type RatingLevel } from "@maipai/spec/ratings/ts/contentRating";
import { db } from "@/db";
import { attachments, contentRatings, savedTemplates } from "@/db/schema";
import { lockItemOfProvenance, lockState, type LockItem } from "@/lib/adultLock";
import { rateStoredItem } from "@/lib/filter/rateStored";
import { getStamp, putStamp } from "@/lib/filter/stamps";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@/lib/id";
import { listMediaSubjects } from "@/lib/mediaSubjects";
import { clipMarkOf } from "@/lib/videos/editGate";
import { getVideoJobByFileFor, getVideoJobFor } from "@/lib/videos/jobs";
import { videoJobLockItem } from "@/lib/videos/lock";
import { videoLookFor, videoRecipeFor } from "@/lib/videos/recipes";
import type { PersonRow } from "@/types";
import { templateNameFromWords } from "./templateName";
import { recordOf, visibleRows, type Row, type SavedKind, type VideoTemplateSettingsRow } from "./savedTemplates";

export type SaveSource = { kind: "clip" | "picture"; id: string };
export type SaveResult = { ok: true; template: MediaTemplateRecord } | { ok: false; status: 400 | 403 | 404 | 422; code: string; line: string };
const fail = (status: 400 | 403 | 404 | 422, code: string, line: string): { ok: false; status: 400 | 403 | 404 | 422; code: string; line: string } => ({ ok: false, status, code, line });
const CATEGORIES = ["portrait", "character", "place", "product", "story", "art", "social", "other"];
const BLANK_NAME = /\{\{([a-z][a-z0-9_]*)\|([^|}]+)\|([^}]*)\}\}/g;
export const SAVED_NOT_FOUND_LINE = "That template isn't available any more.";
export const SAVED_CHILD_SHARE_LINE = "Sharing is for grown-ups. Your template stays yours.";
export const SAVED_LOCKED_SHARE_LINE = "A locked template can't be shared. Unlock it first.";
const RANK = (level: RatingLevel): number => rankOf(level) ?? 99;   // Unrated is stricter than every level (C4)
/** The stricter of two ratings, by rank; Unrated outranks everything. */
function stricter(a: ContentRating, b: ContentRating): ContentRating { return RANK(b.level) > RANK(a.level) ? b : a; }
/** What a source's own mark says about its rating: adult-only is X, all-ages is G, no mark is Unrated. */
function sourceRating(audience: "all-ages" | "adult-only" | null): ContentRating | null { return rateStoredItem({ kind: "creation", audience }); }
/** A title never carries a cast member's name: the name becomes "someone" (the household sees titles when a template is shared). */
function scrubTitle(actor: PersonRow, title: string): string {
  let text = title;
  const names = [...new Set(listMediaSubjects(actor).map((subject) => subject.name.trim()).filter((name) => name.length > 1))].sort((a, b) => b.length - a.length);
  for (const name of names) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(name)}(?![\\p{L}\\p{N}_])`, "giu"), "someone");
  return text;
}
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The words with the person's cast members' names turned into `cast_*` blanks, and a check that every `{{` the person typed is a whole, well-formed blank. */
function blankWords(actor: PersonRow, words: string): { ok: true; words: string } | { ok: false; line: string } {
  let text = words.trim();
  const names = [...new Set(listMediaSubjects(actor).map((subject) => subject.name.trim()).filter((name) => name.length > 1))].sort((a, b) => b.length - a.length);
  let n = 0;
  for (const name of names) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_{|])${escapeRegex(name)}(?![\\p{L}\\p{N}_}|])`, "giu"), () => { n += 1; return `{{cast_${n}|Person|a person from your cast}}`; });
  const blanks = [...text.matchAll(BLANK_NAME)];
  if ((text.match(/\{\{/g) ?? []).length !== blanks.length) return { ok: false, line: "A blank in the words isn't complete. Write it as {{name|Label|example}} or take it out." };
  if (blanks.some((blank) => blank[1]!.startsWith("photo_"))) return { ok: false, line: "A template can't hold a photo. Take the photo blank out." };
  return { ok: true, words: text };
}

/** Save a template from a finished clip or picture of the actor's own. Failing closed: if a check cannot run, nothing is saved. */
export async function saveTemplate(actor: PersonRow, input: { source: SaveSource; title: string; words?: string; category?: string }): Promise<SaveResult> {
  if (actor.role === "guest") return fail(403, "guest", "Saved templates aren't available to guest profiles.");
  const title = scrubTitle(actor, input.title.trim()).slice(0, 120);
  if (!title) return fail(400, "title", "Give the template a name.");
  const category = input.category && CATEGORIES.includes(input.category) ? input.category : "other";
  let words = (input.words ?? "").trim();
  let kind: SavedKind, settings: VideoTemplateSettingsRow | null = null;
  let sourceAudience: "all-ages" | "adult-only" | null, sourceLock: "on" | "off";
  if (input.source.kind === "clip") {
    const job = getVideoJobFor(actor, input.source.id) ?? getVideoJobByFileFor(actor, input.source.id);
    if (!job || job.state !== "done") return fail(404, "gone", SAVED_NOT_FOUND_LINE);
    const item: LockItem | null = videoJobLockItem(job);
    if (lockState(item, actor) !== "open") return fail(404, "gone", SAVED_NOT_FOUND_LINE);
    const mark = await clipMarkOf(job);
    kind = "video"; sourceAudience = mark.madeAudience; sourceLock = mark.lock;
    if (!words) words = job.prompt;
    const [w, h] = (job.request.size ?? "").split("x").map(Number);
    const tier = (job.request as { tier?: unknown }).tier;
    settings = {
      seconds: Math.max(1, Math.min(30, Math.round(job.files[0]?.seconds ?? job.request.seconds ?? 5))),
      ...(videoLookFor(job.request.create?.look) ? { look: videoLookFor(job.request.create?.look)!.id } : {}),
      ...(videoRecipeFor(job.request.create?.recipe) ? { camera: videoRecipeFor(job.request.create?.recipe)!.id } : {}),
      ...(w && h ? { orientation: h > w ? "portrait" as const : "landscape" as const } : {}),
      ...(tier === "boost" || tier === "max" ? { tier } : {}),
    };
  } else {
    const file = db.select().from(attachments).where(eq(attachments.id, input.source.id)).get();
    if (!file || file.deletedAt !== null || file.ownerPersonId !== actor.id || !file.mediaType.startsWith("image/")) return fail(404, "gone", SAVED_NOT_FOUND_LINE);
    const item = lockItemOfProvenance(file.ownerPersonId, file.provenance);
    if (lockState(item, actor) !== "open") return fail(404, "gone", SAVED_NOT_FOUND_LINE);
    kind = "picture"; sourceAudience = item?.madeAudience ?? null; sourceLock = item?.lock ?? "off";
    if (!words) return fail(400, "words", "Add the words for the template.");
  }
  if (!words) return fail(400, "words", "Add the words for the template.");
  const blanked = blankWords(actor, words);
  if (!blanked.ok) return fail(422, "blanks", blanked.line);
  if (blanked.words.length > 10000) return fail(422, "long", "Those words are too long for a template.");
  // Rating (C9): the words, then the stricter of that and the source's own stamp; a check that fails writes nothing.
  const wordsRating = rateStoredItem({ kind: "template", title, text: blanked.words });
  const fromSource = sourceRating(sourceAudience);
  if (!wordsRating || !fromSource) return fail(422, "unchecked", "I couldn't check that template, so I didn't save it. Try again in a minute.");
  const rating = stricter(wordsRating, fromSource);
  const adultOnly = rating.level === "X";
  const now = new Date().toISOString(), id = `mtpl-${randomSuffix(10).toLowerCase()}`;
  const lock = adultOnly && sourceAudience === "adult-only" && sourceLock === "on" ? "on" : null;   // carried over from the source, never made by an unchecked source (C11)
  db.insert(savedTemplates).values({
    id, ownerPersonId: actor.id, kind, title, summary: "", category, audience: adultOnly ? "adult-only" : "all-ages", prompt: blanked.words, settings: settings ? JSON.stringify(settings) : null,
    aspect: null, sharedWith: null, lock, createdAt: now, updatedAt: now, hlc: nextHlc(), provenance: `${actor.id} (saved template)`,
  }).run();
  putStamp({ kind: "template", id }, rating, templateFingerprint(title, blanked.words));
  const saved = db.select().from(savedTemplates).where(eq(savedTemplates.id, id)).get()!;
  const record = recordOf(saved);
  if (!record) { db.delete(savedTemplates).where(eq(savedTemplates.id, id)).run(); return fail(422, "invalid", "I couldn't save that template. Try different words."); }
  return { ok: true, template: record };
}

const templateFingerprint = (title: string, words: string): string => createHash("sha256").update(`${title}\n${words}`).digest("hex");
const ownRow = (actor: PersonRow, id: string): Row | null => { const row = db.select().from(savedTemplates).where(and(eq(savedTemplates.id, id), eq(savedTemplates.ownerPersonId, actor.id))).get(); return row ?? null; };
/** The owner's row only while the owner may still see it (a closed lock, a ceiling an admin lowered, a restricted home): otherwise it answers as a missing one and no words are returned (C10). */
const ownVisibleRow = (actor: PersonRow, id: string): Row | null => { const row = ownRow(actor, id); return row && visibleRows(actor, [row]).length > 0 ? row : null; };

/** Rename (the name is rated with the words again, still no looser than the source's own mark). */
export function renameSavedTemplate(actor: PersonRow, id: string, title: string): SaveResult {
  const row = ownVisibleRow(actor, id);
  if (!row || actor.role === "guest") return fail(404, "gone", SAVED_NOT_FOUND_LINE);
  const name = scrubTitle(actor, title.trim()).slice(0, 120);
  if (!name) return fail(400, "title", "Give the template a name.");
  const words = rateStoredItem({ kind: "template", title: name, text: row.prompt });
  const previous = getStamp("template", id);
  if (!words) return fail(422, "unchecked", "I couldn't check that name, so I didn't change it. Try again in a minute.");
  if (!previous) { db.update(savedTemplates).set({ title: name, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(savedTemplates.id, id)).run(); const kept = recordOf(db.select().from(savedTemplates).where(eq(savedTemplates.id, id)).get()!); return kept ? { ok: true, template: kept } : fail(422, "invalid", "I couldn't change that template."); }
  const rating = RANK(previous.level) > RANK(words.level) ? ContentRating.parse({ level: previous.level, source: previous.source, rater: previous.rater, rater_version: previous.rater_version, rated_at: previous.rated_at, ...(previous.reasons ? { reasons: previous.reasons } : {}), ...(previous.label ? { label: previous.label } : {}) }) : words;
  db.update(savedTemplates).set({ title: name, audience: rating.level === "X" ? "adult-only" : "all-ages", updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(savedTemplates.id, id)).run();
  putStamp({ kind: "template", id }, rating, templateFingerprint(name, row.prompt));
  const record = recordOf(db.select().from(savedTemplates).where(eq(savedTemplates.id, id)).get()!);
  return record ? { ok: true, template: record } : fail(422, "invalid", "I couldn't change that template.");
}

export function deleteSavedTemplate(actor: PersonRow, id: string): boolean {
  if (!ownRow(actor, id)) return false;
  db.delete(savedTemplates).where(eq(savedTemplates.id, id)).run();
  db.delete(contentRatings).where(and(eq(contentRatings.subjectKind, "template"), eq(contentRatings.subjectId, id))).run();
  return true;
}

/** Share with home (`shared_with: "household"`) or stop sharing. A child cannot share and a locked template cannot be shared (the same two rules `createShare` holds for files). */
export function shareSavedTemplate(actor: PersonRow, id: string, shared: boolean): SaveResult {
  const row = ownVisibleRow(actor, id);
  if (!row || actor.role === "guest") return fail(404, "gone", SAVED_NOT_FOUND_LINE);
  if (shared) {
    if (actor.role === "child") return fail(403, "share_children_off", SAVED_CHILD_SHARE_LINE);
    if (row.lock === "on") return fail(403, "share_locked", SAVED_LOCKED_SHARE_LINE);
  }
  db.update(savedTemplates).set({ sharedWith: shared ? "household" : null, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(savedTemplates.id, id)).run();
  const record = recordOf(db.select().from(savedTemplates).where(eq(savedTemplates.id, id)).get()!);
  return record ? { ok: true, template: record } : fail(422, "invalid", "I couldn't change that template.");
}
