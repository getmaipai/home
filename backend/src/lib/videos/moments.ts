// VIDEO-LD-05 (Home side): a viewer's saved moments in a video. A moment is a mark in the person's OWN media-progress row (the same writer the
// podcast bookmarks use, `writeProgress`), so the spec merge rule holds: marks union by `at_s`, and a child's row is written only by the child.
// A reserved label prefix tells a moment from any other mark; removing one writes a tombstone mark that `mergeProgress` lets replace it.
// Nothing here logs the person or the marks (RULES 6a), and nothing reads another person's row.
import type { PersonRow } from "@/types";
import { correctedStamp, getProgress, writeProgress, type Mark } from "@/lib/media/progress";
import { readableIn, registerItemView, type ActionResult } from "@/lib/media/appHost";

export const MOMENT_PREFIX = "video-moment:";
export const MOMENT_GONE_PREFIX = "video-moment:deleted:";
export const MOMENT_CAP = 200;

export type MomentResult = ActionResult<{ at_s: number; label: string }>;

const GONE: MomentResult = { ok: false, status: 404, error: "That video is not available. Go back to Videos and choose another." };
const BAD_TIME: MomentResult = { ok: false, status: 400, error: "That time is not inside this video. Play the video to the place you want, then tap Save moment again." };

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

const isLive = (mark: Mark): boolean => !!mark.label?.startsWith(MOMENT_PREFIX) && !mark.label.startsWith(MOMENT_GONE_PREFIX);

/** The viewer's own moments for one video, earliest first: `[{ at_s, label }]` with the label shown to people. Never another person's. */
export function momentsOf(person: PersonRow, mediaId: string): Array<{ at_s: number; label: string }> {
  const row = getProgress(person.id, mediaId);
  return (row?.marks ?? []).filter(isLive).map((mark) => ({ at_s: mark.at_s, label: mark.label!.slice(MOMENT_PREFIX.length) })).sort((a, b) => a.at_s - b.at_s);
}

function number(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Saves the current time as the caller's own moment. The item must pass the same read gate as the watch page. */
export function addMoment(person: PersonRow, body: Record<string, unknown>): MomentResult {
  const item = typeof body.media_id === "string" ? readableIn(person, "video", body.media_id) : null;
  if (!item) return GONE;
  const at = number(body.at_s);
  const duration = item.duration_s && item.duration_s > 0 ? item.duration_s : null;
  if (at === null || at < 0 || (duration !== null && at > duration)) return BAD_TIME;
  const whole = Math.floor(at);
  const current = getProgress(person.id, item.id);
  const live = (current?.marks ?? []).filter(isLive);
  if (live.length >= MOMENT_CAP && !live.some((mark) => mark.at_s === whole)) {
    return { ok: false, status: 422, error: `You can keep up to ${MOMENT_CAP} moments in one video. Remove one under the player, then save this one.` };
  }
  const label = clock(whole);
  const outcome = writeProgress(person, item, { position: current?.position ?? { seconds: at }, marks: [{ at_s: whole, label: `${MOMENT_PREFIX}${label}` }], stamp: correctedStamp({ serverNow: new Date() }) }, { immediate: true });
  return outcome.ok ? { ok: true, value: { at_s: whole, label } } : { ok: false, status: 422, error: "That moment could not be saved. Try again in a moment." };
}

/** Removes one of the caller's own moments (a tombstone mark; the merge rule lets it replace the moment at that time). */
export function removeMoment(person: PersonRow, body: Record<string, unknown>): MomentResult {
  const item = typeof body.media_id === "string" ? readableIn(person, "video", body.media_id) : null;
  if (!item) return GONE;
  const at = number(body.at_s);
  if (at === null) return BAD_TIME;
  const current = getProgress(person.id, item.id);
  const mark = current?.marks.find((candidate) => candidate.at_s === at && isLive(candidate));
  if (!current || !mark) return { ok: false, status: 404, error: "That moment is already gone. Pick another one under the player." };
  const outcome = writeProgress(person, item, { position: current.position, marks: [{ at_s: mark.at_s, label: `${MOMENT_GONE_PREFIX}${mark.label!.slice(MOMENT_PREFIX.length)}` }], stamp: correctedStamp({ serverNow: new Date() }) }, { immediate: true });
  return outcome.ok ? { ok: true, value: { at_s: mark.at_s, label: mark.label!.slice(MOMENT_PREFIX.length) } } : { ok: false, status: 422, error: "That moment could not be removed. Try again in a moment." };
}

// The watch item view carries the viewer's own moments (the kit player's `marks` reads the `marks` field). Hub-wide, never per person elsewhere.
registerItemView("video", (person, item, view) => ({ ...view, marks: momentsOf(person, item.id) }));
