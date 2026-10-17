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
/** A client may tick as rarely as once a minute (a background tab); forward movement that fits the clock counts up to this much. */
export const FORWARD_CAP_S = 120;
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
 * Metered from the server clock between two writes of one cursor: min(wall-clock elapsed, forward position advance, interval plus
 * slack). Client flags (`playing`, `seeking`, events) and the client stamp are never trusted. A jump larger than elapsed plus
 * slack is a seek and only the wall-clock part counts, capped at the 10-second cadence plus slack; no forward movement counts nothing.
 */
export function meterProgress(person: PersonRow, item: Pick<MediaItem, "id" | "kind">, write: ProgressWrite, now: Date, meterKey = "-"): MediaBudget {
  db.transaction(() => {
    const sessionKey = JSON.stringify([meterKey, item.id]);
    const previous = db.select().from(mediaWatchSessions).where(and(eq(mediaWatchSessions.personId, person.id), eq(mediaWatchSessions.sessionKey, sessionKey))).get();
    // Server wall-clock only: neither the client stamp nor the `playing`, `seeking` or `events` flags are trusted.
    const sampled = now.getTime();
    const last = previous ? Date.parse(previous.sampledAt) : null;
    if (last !== null && sampled <= last) return;
    const position = "seconds" in write.position ? write.position.seconds : null;
    const elapsed = last === null ? 0 : (sampled - last) / 1000;
    const seekCap = Math.min(elapsed, WRITE_INTERVAL_S + WRITE_SLACK_S);
    const forwardCap = Math.min(elapsed, FORWARD_CAP_S);
    let seconds = 0;
    if (previous) {
      if (position !== null && previous.positionS !== null) {
        const delta = position - previous.positionS;
        // Forward movement counts the least of wall-clock time, position advance and the cap. A jump larger than the
        // wall-clock time plus slack is a seek: only the wall-clock part counts. No forward movement counts nothing.
        if (delta > 0) seconds = delta > elapsed + WRITE_SLACK_S ? seekCap : Math.min(delta, forwardCap);
      } else if (position === null && previous.positionS === null) {
        // Reader ticks have no seconds locator and nothing to cross-check the clock against: the tight 12-second cap.
        seconds = seekCap;
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
    const values = { mediaId: item.id, deviceId: write.device_id ?? null, positionS: position, sampledAt: new Date(sampled).toISOString(), playing: true };
    db.insert(mediaWatchSessions).values({ personId: person.id, sessionKey, ...values }).onConflictDoUpdate({ target: [mediaWatchSessions.personId, mediaWatchSessions.sessionKey], set: values }).run();
  });
  const budget = mediaBudget(person.id, now);
  if (mediaBandOf(person) !== "adult" && budget.exhausted) {
    const day = mediaDay(now);
    // Persist the dedupe before dispatch. The notice names the child (their guardians are the admins, rule 6a); no title, URL or
    // activity detail reaches an admin.
    db.insert(mediaWatchDays).values({ personId: person.id, day }).onConflictDoNothing().run();
    const claimed = db.update(mediaWatchDays).set({ notified: true }).where(and(eq(mediaWatchDays.personId, person.id), eq(mediaWatchDays.day, day), eq(mediaWatchDays.notified, false))).returning().all();
    if (claimed.length) void trigger("media_time_up", { name: person.displayName }, { subjectPersonId: person.id }).catch(() => { /* A notification failure never loses a saved place. */ });
  }
  return budget;
}

/** The refusal for content bytes. Budget exhaustion is otherwise only reported in progress responses, so a child could open the
 * file URL and watch with no progress writes. Returns null when the person may read bytes now. Minors only (child, teen, guest);
 * an adult's budget is advisory. Exhaustion already leaves out exempt audio seconds, so an exhausted minor is blocked for every kind. */
export function mediaTimeUpRefusal(person: PersonRow, now = new Date()): { error: string; code: "media_time_up" } | null {
  if (mediaBandOf(person) === "adult") return null;
  if (!mediaBudget(person.id, now).exhausted) return null;
  return { error: `${MEDIA_KID_COPY.timeUp} ${MEDIA_KID_COPY.askForMore}`, code: "media_time_up" };
}

/** MEDIA-KID-01 item 4: offline copies play without the hub, so no server clock meters them. A minor with a daily media budget
 * therefore cannot keep media offline. OFFLINE-01's keep path (the device and browser keep routes, and the offline file route) must
 * call this and refuse with the kid line when it returns false; the integrator wires it when OFFLINE lands. */
export function minorMayKeepOffline(person: PersonRow): boolean {
  if (mediaBandOf(person) === "adult") return true;
  return dailyMinutesAllowed(person.id, "Media") <= 0;
}
