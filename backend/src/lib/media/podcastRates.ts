// PODCAST-RATE-01: the listening speed a person chose for one show, remembered per person and show. Private to the person: read and written only for
// the signed-in actor, and only for a show they may see (the same `allowedSources` the Shows page uses), so one person's speed is never another's.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { podcastShowRates } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newPodcastShowRateId } from "@/lib/id";
import type { PersonRow } from "@/types";
import { allowedSources } from "./appHost";

export const RATE_MIN = 0.5;
export const RATE_MAX = 2;
export const RATE_LINE = "Pick a speed from 0.5 to 2, like 1.25, and try again.";

export type RateOutcome = { ok: true; value: { show_id: string; rate: number } } | { ok: false; status: 404 | 422; error: string; code: string };

/** The speed this person saved for a show, or null. */
export function showRateOf(person: PersonRow, sourceId: string): number | null {
  return db.select({ rate: podcastShowRates.rate }).from(podcastShowRates).where(and(eq(podcastShowRates.personId, person.id), eq(podcastShowRates.sourceId, sourceId))).get()?.rate ?? null;
}

/** A number from a JSON number or the text a form sends; anything else (null, text, NaN, a list) is not a speed. */
function asRate(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Save the person's speed for a show they can see. The range is 0.5 to 2; a speed outside it, or a show that is not theirs, changes nothing. */
export function setShowRate(person: PersonRow, sourceId: string, raw: unknown): RateOutcome {
  const source = allowedSources(person).find((candidate) => candidate.id === sourceId && (candidate.kind === "feed" || candidate.kind === "production"));
  if (!source) return { ok: false, status: 404, error: "That show is not in your podcasts. Open Shows and pick it again.", code: "no_such_show" };
  const rate = asRate(raw);
  if (rate === null || rate < RATE_MIN || rate > RATE_MAX) return { ok: false, status: 422, error: RATE_LINE, code: "bad_rate" };
  const rounded = Math.round(rate * 100) / 100;
  const now = new Date().toISOString();
  const had = db.select({ id: podcastShowRates.id }).from(podcastShowRates).where(and(eq(podcastShowRates.personId, person.id), eq(podcastShowRates.sourceId, source.id))).get();
  if (had) db.update(podcastShowRates).set({ rate: rounded, updatedAt: now, hlc: nextHlc() }).where(eq(podcastShowRates.id, had.id)).run();
  else db.insert(podcastShowRates).values({ id: newPodcastShowRateId(), personId: person.id, sourceId: source.id, rate: rounded, updatedAt: now, hlc: nextHlc(), provenance: `person:${person.id}` }).run();
  return { ok: true, value: { show_id: source.id, rate: rounded } };
}
