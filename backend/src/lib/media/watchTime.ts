// MEDIA-KID-01: the one daily media budget, private to the asking person. Totals and sample cursors survive restarts.
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaWatchDays, mediaWatchSessions } from "@/db/schema";
import { dailyMinutesAllowed } from "@/lib/allowance";
import { getHouseholdSettingValue } from "@/lib/settings";
import { trigger } from "@/lib/notifications";
import { MEDIA_AUDIO_EXEMPT_KEY } from "@/settings/mediaKeys";
import { mediaBandOf } from "./band";
import type { PersonRow } from "@/types";
import type { MediaItem } from "./model";
import type { ProgressWrite } from "./progress";

/** Placeholders until the kid-mode catalog owns these rows. */
export const MEDIA_KID_COPY = {
  timeUp: "Screen time is done for today.",
  askForMore: "Ask a grown-up for more.",
  notAllowed: "Not for you yet. Tap to ask a grown-up.",
} as const;

export interface MediaBudget { limit_min: number; used_min: number; left_min: number; exhausted: boolean }
export const WRITE_INTERVAL_S = 10;
export const WRITE_SLACK_S = 2;
/** Per-person cursor rows: dropped after two days of silence, and never more than this many. */
export const SESSION_ROW_TTL_MS = 2 * 86_400_000;
export const SESSION_ROW_CAP = 200;

/** Household host local midnight, as in statusHistory/stackSelfHeal's daily limits. Calendar dates handle DST. */
export function mediaDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function dayRow(personId: string, day: string) {
  return db.select().from(mediaWatchDays).where(and(eq(mediaWatchDays.personId, personId), eq(mediaWatchDays.day, day))).get();
}

export function mediaBudget(personId: string, now = new Date()): MediaBudget {
  const row = dayRow(personId, mediaDay(now));
  const base = Math.max(0, dailyMinutesAllowed(personId, "Media"));
  const limit = base === 0 ? 0 : base + (row?.extendedMin ?? 0);
  const exempt = getHouseholdSettingValue(MEDIA_AUDIO_EXEMPT_KEY) === true;
  const used = Math.max(0, (row?.usedS ?? 0) - (exempt ? row?.audioS ?? 0 : 0)) / 60;
  return { limit_min: limit, used_min: used, left_min: limit === 0 ? 0 : Math.max(0, limit - used), exhausted: limit > 0 && used >= limit };
}

/** Caller has required owner/admin and a live target. Extending an unlimited budget leaves it unlimited. */
export function extendMediaBudget(personId: string, minutes: number, now = new Date()): MediaBudget {
  const day = mediaDay(now);
  db.insert(mediaWatchDays).values({ personId, day, extendedMin: minutes }).onConflictDoUpdate({
    target: [mediaWatchDays.personId, mediaWatchDays.day], set: { extendedMin: sql`${mediaWatchDays.extendedMin} + ${minutes}` },
  }).run();
  return mediaBudget(personId, now);
}

/** Called when a new cursor row is about to be added: old rows go, then the oldest beyond the cap. */
function pruneCursors(personId: string, now: Date): void {
  db.delete(mediaWatchSessions).where(and(eq(mediaWatchSessions.personId, personId), lt(mediaWatchSessions.sampledAt, new Date(now.getTime() - SESSION_ROW_TTL_MS).toISOString()))).run();
  const rows = db.select({ key: mediaWatchSessions.sessionKey }).from(mediaWatchSessions).where(eq(mediaWatchSessions.personId, personId)).orderBy(asc(mediaWatchSessions.sampledAt)).all();
  for (const row of rows.slice(0, Math.max(0, rows.length - (SESSION_ROW_CAP - 1)))) {
    db.delete(mediaWatchSessions).where(and(eq(mediaWatchSessions.personId, personId), eq(mediaWatchSessions.sessionKey, row.key))).run();
  }
}

function addSeconds(personId: string, day: string, seconds: number, audio: boolean): void {
  if (seconds <= 0) return;
  db.insert(mediaWatchDays).values({ personId, day, usedS: seconds, audioS: audio ? seconds : 0 }).onConflictDoUpdate({
    target: [mediaWatchDays.personId, mediaWatchDays.day],
    set: { usedS: sql`${mediaWatchDays.usedS} + ${seconds}`, audioS: sql`${mediaWatchDays.audioS} + ${audio ? seconds : 0}` },
  }).run();
}

/** Called only after the progress device/shape guards, before coalescing can discard a tick.
 * `meterKey` is derived by the server from the authenticated session or device token, never from a request field, so a client
 * cannot start a fresh baseline by rotating anything it sends. The cursor is per (key, media item).
 * A new play, item/device change, pause, seek, replayed or older stamp establishes a baseline, never extra time.
 * Position jumps beyond the actual write interval plus slack are seeks; only elapsed playing time is counted.
 */
export function meterProgress(person: PersonRow, item: Pick<MediaItem, "id" | "kind">, write: ProgressWrite, now: Date, meterKey = "-"): MediaBudget {
  db.transaction(() => {
    const sessionKey = JSON.stringify([meterKey, item.id]);
    const previous = db.select().from(mediaWatchSessions).where(and(eq(mediaWatchSessions.personId, person.id), eq(mediaWatchSessions.sessionKey, sessionKey))).get();
    const sampled = Math.min(Date.parse(write.stamp), now.getTime());
    if (!Number.isFinite(sampled)) return;
    const last = previous ? Date.parse(previous.sampledAt) : null;
    // Duplicate/offline replay cannot reset the baseline or add time twice.
    if (last !== null && sampled <= last) return;
    const position = "seconds" in write.position ? write.position.seconds : null;
    const elapsed = last === null ? 0 : (sampled - last) / 1000;
    const cap = Math.min(elapsed, WRITE_INTERVAL_S + WRITE_SLACK_S);
    let seconds = 0;
    if (previous?.mediaId === item.id && previous.playing && !write.events?.play && !write.events?.skip && !write.seeking) {
      if (position !== null && previous.positionS !== null) {
        const delta = position - previous.positionS;
        if (delta > 0 && delta <= cap + WRITE_SLACK_S) seconds = Math.min(delta, cap);
      } else if (position === null && previous.positionS === null) {
        // Reader playing ticks: no seconds locator, but the same bounded elapsed interval.
        seconds = cap;
      }
    }
    const audio = item.kind === "track" || item.kind === "audiobook" || item.kind === "chapter";
    if (seconds > 0) {
      // Attribute the bounded interval to the local calendar day(s) it actually occupied, including midnight/DST.
      let start = sampled - seconds * 1000;
      while (start < sampled) {
        const date = new Date(start);
        const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
        const end = Math.min(sampled, midnight);
        addSeconds(person.id, mediaDay(date), (end - start) / 1000, audio);
        start = end;
      }
    }
    if (!previous) pruneCursors(person.id, now);
    const values = { mediaId: item.id, deviceId: write.device_id ?? null, positionS: position, sampledAt: new Date(sampled).toISOString(), playing: write.playing !== false };
    db.insert(mediaWatchSessions).values({ personId: person.id, sessionKey, ...values }).onConflictDoUpdate({ target: [mediaWatchSessions.personId, mediaWatchSessions.sessionKey], set: values }).run();
  });
  const budget = mediaBudget(person.id, now);
  if (mediaBandOf(person) === "child" && budget.exhausted) {
    const day = mediaDay(now);
    // Persist the dedupe before dispatch. No subject id, title, URL or activity details reach an admin.
    db.insert(mediaWatchDays).values({ personId: person.id, day }).onConflictDoNothing().run();
    const claimed = db.update(mediaWatchDays).set({ notified: true }).where(and(eq(mediaWatchDays.personId, person.id), eq(mediaWatchDays.day, day), eq(mediaWatchDays.notified, false))).returning().all();
    if (claimed.length) void trigger("media_time_up").catch(() => { /* A notification failure never loses a saved place. */ });
  }
  return budget;
}
