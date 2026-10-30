// NEWS-02 (news note section 17): the actions behind `POST /api/plugins/news/actions/<action>`: follow, save, read, feedback and
// reset_mix. Each acts on the asking person's own records and nobody else's, and only on an item or channel their band is
// released (a guessed id is a refusal, not data). The role gate and the owning page's floor run before this (the route), then
// the band rules here: a child never gets feedback ("Less like this"), reset_mix or My Mix, and nothing a child does writes an
// inferred row. `summarize` is optional and never prevents reading.
import { visibleFeedIds } from "@/lib/shelf/shelfRead";
import { sharedShelfStore } from "@/lib/shelf/shelfStore";
import type { PersonRow } from "@/types";
import { loadContent } from "./article";
import { releasedItem, storyIdOf, type Viewer } from "./cards";
import { ensureAndPinNewsPicture, newsPictureCached, pinNewsPicture } from "./pictures";
import { addSave, clearRecents, itemIsSaved, recordRecent, recordRead, removeSave, resetMix, recomputeMix, setFollow } from "./records";
import { topicOfferedTo } from "./topics";
import { viewerOf } from "./data";

import { summarizeStory } from "./summary";

export type ActionResult = { ok: true; status: 200; value: Record<string, unknown> } | { ok: false; status: 400 | 403 | 404 | 503; error: string };

export const NEWS_ACTIONS = ["follow", "save", "read", "feedback", "reset_mix", "summarize", "search_recent", "search_recent_clear"] as const;
export type NewsActionName = (typeof NEWS_ACTIONS)[number];

const MAX_SAVE_BATCH = 20;
const MAX_READ_S = 86_400;
const bad = (error: string): ActionResult => ({ ok: false, status: 400, error });
const gone = (): ActionResult => ({ ok: false, status: 404, error: "That story is not available." });
const ok = (value: Record<string, unknown> = {}): ActionResult => ({ ok: true, status: 200, value: { ok: true, ...value } });
const on = (body: Record<string, unknown>): boolean => body.on !== false && body.on !== "false";

function follow(person: PersonRow, viewer: Viewer, body: Record<string, unknown>): ActionResult {
  const kind = body.kind === "topic" || body.kind === "source" ? body.kind : null;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!kind || !key) return bad("Choose a topic or a source to follow.");
  // A channel a band is not shown does not exist for it: a child can follow kid topics and Kids' sources only.
  if (kind === "topic" ? !topicOfferedTo(key, viewer.band) : !visibleFeedIds(viewer.band).includes(key)) return { ok: false, status: 404, error: "That channel is not available." };
  setFollow(person.id, viewer.band, kind, key, on(body));
  return ok({ followed: on(body) });
}

async function save(person: PersonRow, viewer: Viewer, body: Record<string, unknown>): Promise<ActionResult> {
  if (Array.isArray(body.item_ids) && body.item_ids.length > MAX_SAVE_BATCH) return bad(`Choose at most ${MAX_SAVE_BATCH} stories at a time.`);
  const items = Array.isArray(body.item_ids) ? body.item_ids : [body.item_id ?? body.story_id ?? body.id];
  const wantOn = on(body);
  const results: string[] = [];
  for (const raw of items) {
    const item = releasedItem(viewer, raw);
    if (!item) {
      // Removing a save of something no longer released is allowed (the person may clear it); adding it is not.
      if (!wantOn && typeof raw === "string" && /^news-[a-z0-9]{6,}$/.test(raw)) { removeSave(person.id, raw); unpinIfUnsaved(raw); continue; }
      return gone();
    }
    if (!wantOn) {
      removeSave(person.id, item.id);
      unpinIfUnsaved(item.id);
      results.push(item.id);
      continue;
    }
    // Saving keeps the story's text and picture on this hub: the text is fetched once if needed and pinned out of the prune; the
    // picture is fetched the same once (the person's screen showed the story) and pinned.
    const content = await loadContent(item, viewer.band);
    const store = sharedShelfStore();
    const textKept = content.stored && content.source !== "teaser";
    if (textKept) store?.pinContent(item.id, true);
    else if (store && content.blocks.length > 0) {
      // Only the feed's summary could be fetched: keep it, pinned, so the saved story's row is not pruned away with the shelf and its
      // row never opens on "not available". The stored teaser is never served as the article (loadContent ignores it and fetches again).
      try {
        store.putContent(item.id, viewer.band, { blocks: content.blocks, source: "teaser", reading_s: content.reading_s, fetched_at: new Date().toISOString() });
        store.pinContent(item.id, true);
      } catch { /* the pin is a keep-alive: a failed write never fails the save */ }
    }
    const hasPicture = item.image_url || store?.getEnrichment(item.id, viewer.band)?.image_url || newsPictureCached(item.id);
    const pictureKept = hasPicture ? await ensureAndPinNewsPicture(item, viewer.band) : true;
    addSave(person.id, { itemId: item.id, storyId: storyIdOf(item), canonicalUrl: item.canonical_url, title: item.title, publisher: item.publisher, offline: textKept && pictureKept });
    results.push(item.id);
  }
  recomputeMix(person.id);
  return ok({ saved: wantOn, count: results.length });
}

function unpinIfUnsaved(itemId: string): void {
  if (itemIsSaved(itemId)) return;
  sharedShelfStore()?.pinContent(itemId, false);
  if (newsPictureCached(itemId)) pinNewsPicture(itemId, false);
}

function read(person: PersonRow, viewer: Viewer, body: Record<string, unknown>): ActionResult {
  const item = releasedItem(viewer, body.item_id ?? body.story_id ?? body.id);
  if (!item) return gone();
  // Reading seconds are a whole number from 0 to a day, whatever was sent.
  const sent = Number(body.read_s);
  const readS = Number.isFinite(sent) ? Math.min(MAX_READ_S, Math.max(0, Math.floor(sent))) : sent === Infinity ? MAX_READ_S : 0;
  recordRead(person.id, { itemId: item.id, storyId: storyIdOf(item), readS, finished: body.finished === true });
  return ok();
}

function feedback(person: PersonRow, viewer: Viewer, body: Record<string, unknown>): ActionResult {
  // "Less like this" is for teens and adults; a child's News infers nothing about them.
  if (person.role === "guest" || viewer.band === "child") return { ok: false, status: 403, error: "My Mix is not available for this profile. Open Today to read news." };
  const item = releasedItem(viewer, body.item_id ?? body.story_id ?? body.id);
  if (!item) return gone();
  const kind = body.kind === "more" || body.kind === "less" ? body.kind : body.kind === "none" ? null : undefined;
  if (kind === undefined) return bad("Choose More like this or Less like this.");
  recordRead(person.id, { itemId: item.id, storyId: storyIdOf(item), feedback: kind });
  return ok();
}

function resetMixAction(person: PersonRow, viewer: Viewer): ActionResult {
  if (person.role === "guest" || viewer.band === "child") return { ok: false, status: 403, error: "My Mix is not available for this profile. Open Today to read news." };
  return ok({ removed: resetMix(person.id).removed });
}

/** Keeps one search of the person's own, for the Search page to offer again. A child, a guest and an empty query keep nothing, and the answer is the same either way. */
function searchRecent(person: PersonRow, viewer: Viewer, body: Record<string, unknown>): ActionResult {
  if (person.role !== "guest" && typeof body.q === "string") recordRecent(person.id, viewer.band, body.q);
  return ok();
}

function searchRecentClear(person: PersonRow): ActionResult {
  return ok({ removed: person.role === "guest" ? 0 : clearRecents(person.id) });
}

export async function runNewsAction(person: PersonRow, action: NewsActionName, body: Record<string, unknown>, now = new Date()): Promise<ActionResult> {
  const viewer = viewerOf(person, now);
  switch (action) {
    case "summarize": {
      const item = releasedItem(viewer, body.id);
      if (!item) return gone();
      const summary = await summarizeStory(storyIdOf(item), viewer.band);
      // Not ready is not an error: the reader keeps showing progress and asks again, so the answer is a plain 200 with no summary.
      return ok({ summary });
    }
    case "follow": return follow(person, viewer, body);
    case "save": return save(person, viewer, body);
    case "read": return read(person, viewer, body);
    case "feedback": return feedback(person, viewer, body);
    case "reset_mix": return resetMixAction(person, viewer);
    case "search_recent": return searchRecent(person, viewer, body);
    case "search_recent_clear": return searchRecentClear(person);
  }
}
