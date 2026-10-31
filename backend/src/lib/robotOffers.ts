// INITIATIVE-01: the robot offer policy and queue (Reachy design v2 sections 6.1 and 6.2).
//
// A tier 2 or 3 background turn writes a `robot_offers` row (the spec's RobotOffer plus the plain line the
// robot may say aloud). The model writes the content and never decides whether to interrupt: whether an offer
// is sent is plain code, every gate below, in order. The outbound `offer` command carries the id, the person,
// the tier and the non-personal line, never the prepared text. The text is spoken only after the person says
// yes in words (never a gesture or a touch), through the turn engine's own output gate.
import { and, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { RobotOffer } from "@maipai/spec/gen/ts/robot-offer.js";
import { db } from "@/db";
import { people, robotOffers } from "@/db/schema";
import type { PersonRow } from "@/types";
import { nextHlc } from "@/lib/hlc";
import { issueDeviceCommand, listRobotsPairedUnderPerson } from "@/lib/deviceCommands";
import { quietHours, trigger } from "@/lib/notifications";
import { AFFIRMATIVE_RE, NEGATIVE_RE } from "@/lib/consentVocab";
import { evaluateSafety } from "@/lib/safety";
import { speakerAgeBand } from "@/lib/ageBand";
import { ROBOT_MAY_ADDRESS_KEY, getDeviceSettingValue, getHouseholdSettingValue, getPersonSettingSource, getSettingValueForPerson } from "@/lib/settings";

export const OFFER_SNOOZE_MS = 30 * 60_000;
export const OFFER_BACKOFF_MS = 60 * 60_000;
export const OFFER_BACKOFF_AFTER_IGNORED = 2;
export const DEFAULT_OFFER_TTL_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;

export type OfferState = "queued" | "sent" | "snoozed" | "accepted" | "declined" | "expired";
export type OfferRow = typeof robotOffers.$inferSelect;

export type OfferHold =
  | "disabled" | "tier_not_allowed" | "may_address" | "quiet_hours" | "no_robot" | "not_allowed_here" | "rate_limit" | "backoff" | "outstanding" | "snoozed";

export interface CreateOfferInput {
  personId: string;
  tier: 1 | 2 | 3;
  text: string;
  nonPersonalLine: string;
  provenance: string;
  expiresAt?: Date;
  now?: Date;
}

/** Writes one queued offer. The spec's RobotOffer shape is the validator, so a bad id, tier or length is
 * refused here and not by a robot later. */
export function createRobotOffer(input: CreateOfferInput): OfferRow {
  const now = input.now ?? new Date();
  const id = `offer-${crypto.randomUUID()}`;
  const hlc = nextHlc();
  const expiresAt = (input.expiresAt ?? new Date(now.getTime() + DEFAULT_OFFER_TTL_MS)).toISOString();
  RobotOffer.parse({ id, person_id: input.personId, tier: input.tier, text: input.text, expires_at: expiresAt, provenance: input.provenance, hlc });
  if (!input.nonPersonalLine.trim() || input.nonPersonalLine.length > 200) throw new Error("a robot offer needs a non-personal line of 1 to 200 characters");
  // The robot says this line aloud before any consent, to whoever is in the room: it passes the output floor at the child band.
  if (evaluateSafety(input.nonPersonalLine, "child").flagged) throw new Error("the non-personal line of a robot offer failed the safety check; write a plainer line");
  db.insert(robotOffers).values({
    id, personId: input.personId, tier: input.tier, text: input.text, nonPersonalLine: input.nonPersonalLine, provenance: input.provenance,
    hlc, expiresAt, state: "queued", createdAt: now.toISOString(),
  }).run();
  return db.select().from(robotOffers).where(eq(robotOffers.id, id)).get()!;
}

function personRow(personId: string): PersonRow | undefined {
  return db.select().from(people).where(eq(people.id, personId)).get();
}

/** May the robot speak first to this person at all? Adults and teens follow `person.robot.may_address`
 * (default on). A child needs it saved as true by someone else: settings.ts refuses a child's own write,
 * and a missing row (a default or a reset) is off. */
export function personMayBeAddressed(person: PersonRow, now: Date): boolean {
  const value = getSettingValueForPerson(person.id, ROBOT_MAY_ADDRESS_KEY);
  if (value !== true) return false;
  if (speakerAgeBand(person, now) === "child") return getPersonSettingSource(person.id, ROBOT_MAY_ADDRESS_KEY) === "user";
  return true;
}

/** `robot.initiative.tiers_spoken`: tier_1 (default) speaks only tier 1 first; tier_1_2 adds tier 2; all adds tier 3. */
function tierSpoken(tier: number): boolean {
  const setting = String(getHouseholdSettingValue("robot.initiative.tiers_spoken") ?? "tier_1");
  const top = setting === "all" ? 3 : setting === "tier_1_2" ? 2 : 1;
  return tier <= top;
}

function sentSince(deviceId: string, sinceMs: number): OfferRow[] {
  return db.select().from(robotOffers)
    .where(and(eq(robotOffers.deviceId, deviceId), isNotNull(robotOffers.sentAt)))
    .orderBy(desc(robotOffers.sentAt)).all()
    .filter((row) => Date.parse(row.sentAt!) >= sinceMs);
}

/** The deterministic gates for sending one offer to one robot. Returns the first gate that holds it, or null. */
export function offerHold(offer: OfferRow, deviceId: string, now: Date): OfferHold | null {
  if (offer.snoozedUntil && Date.parse(offer.snoozedUntil) > now.getTime()) return "snoozed";
  if (getHouseholdSettingValue("robot.initiative.enabled") === false) return "disabled";
  if (!tierSpoken(offer.tier)) return "tier_not_allowed";
  const person = personRow(offer.personId);
  if (!person || !personMayBeAddressed(person, now)) return "may_address";
  if (quietHours(person, now).active) return "quiet_hours";
  if (getDeviceSettingValue(deviceId, "robot.initiative.allowed_here") !== true) return "not_allowed_here";
  const open = db.select().from(robotOffers).where(and(eq(robotOffers.deviceId, deviceId), eq(robotOffers.state, "sent"))).all()
    .some((row) => Date.parse(row.expiresAt) > now.getTime());
  if (open) return "outstanding";
  const max = Number(getHouseholdSettingValue("robot.initiative.max_offers_per_hour") ?? 3);
  if (sentSince(deviceId, now.getTime() - HOUR_MS).length >= max) return "rate_limit";
  const recent = sentSince(deviceId, 0).slice(0, OFFER_BACKOFF_AFTER_IGNORED);
  if (recent.length === OFFER_BACKOFF_AFTER_IGNORED && recent.every((row) => row.state === "expired")
    && Date.parse(recent[0]!.closedAt ?? recent[0]!.expiresAt) + OFFER_BACKOFF_MS > now.getTime()) return "backoff";
  return null;
}

/** Sends every queued offer whose gates pass. Returns what was sent and what each held offer is waiting on. */
export function dispatchRobotOffers(now: Date = new Date()): { sent: string[]; held: Array<{ id: string; hold: OfferHold }> } {
  const sent: string[] = [];
  const held: Array<{ id: string; hold: OfferHold }> = [];
  const queued = db.select().from(robotOffers).where(inArray(robotOffers.state, ["queued", "snoozed"])).orderBy(robotOffers.createdAt).all();
  for (const offer of queued) {
    if (Date.parse(offer.expiresAt) <= now.getTime()) continue; // the sweep closes it
    const robots = listRobotsPairedUnderPerson(offer.personId);
    if (robots.length === 0) { held.push({ id: offer.id, hold: "no_robot" }); continue; }
    let firstHold: OfferHold | null = null;
    let target: string | null = null;
    for (const deviceId of robots) {
      const hold = offerHold(offer, deviceId, now);
      if (!hold) { target = deviceId; break; }
      firstHold ??= hold;
    }
    if (!target) { held.push({ id: offer.id, hold: firstHold ?? "no_robot" }); continue; }
    issueDeviceCommand(target, "offer", { offer_id: offer.id, person_id: offer.personId, tier: offer.tier, non_personal_line: offer.nonPersonalLine });
    db.update(robotOffers).set({ state: "sent", deviceId: target, sentAt: now.toISOString(), snoozedUntil: null }).where(eq(robotOffers.id, offer.id)).run();
    sent.push(offer.id);
  }
  return { sent, held };
}

/** Closes every offer past its expiry and puts each one in the notification centre exactly once. */
export async function sweepRobotOffers(now: Date = new Date()): Promise<string[]> {
  const due = db.select().from(robotOffers)
    .where(and(inArray(robotOffers.state, ["queued", "sent", "snoozed"]), lte(robotOffers.expiresAt, now.toISOString()))).all();
  const closed: string[] = [];
  for (const offer of due) {
    const claimed = db.update(robotOffers).set({ state: "expired", closedAt: now.toISOString() })
      .where(and(eq(robotOffers.id, offer.id), inArray(robotOffers.state, ["queued", "sent", "snoozed"]))).returning().get();
    if (!claimed) continue;
    closed.push(offer.id);
    await notifyExpired(offer.id, now);
  }
  return closed;
}

async function notifyExpired(offerId: string, now: Date): Promise<void> {
  const claimed = db.update(robotOffers).set({ centreNotifiedAt: now.toISOString() })
    .where(and(eq(robotOffers.id, offerId), eq(robotOffers.state, "expired"), isNull(robotOffers.centreNotifiedAt))).returning().get();
  if (!claimed) return;
  const offer = db.select().from(robotOffers).where(eq(robotOffers.id, offerId)).get()!;
  await trigger("robot.offer_missed", { line: offer.nonPersonalLine }, { personId: offer.personId });
}

export const SNOOZE_RE = /\b(not now|not right now|later|maybe later|in a bit|not just now)\b/i;

export type OfferAnswer =
  | { kind: "accepted"; offer: OfferRow }
  | { kind: "declined"; offer: OfferRow }
  | { kind: "snoozed"; offer: OfferRow }
  | { kind: "not_consent" }
  | { kind: "stale" };

export interface AnswerInput {
  /** The signed-in person on the turn. */
  actor: PersonRow;
  offerId: string;
  /** What the person said, from the speech-to-text of this turn. */
  text: string;
  /** What the robot reported as the button or the intent. Never enough on its own to accept. */
  approved: boolean;
  /** The body named the speaker as this actor with some confidence (speaker_evidence). */
  identified: boolean;
  turnId: string;
  now?: Date;
}

/** Applies a spoken answer to an offer. Acceptance needs consent words in the transcript, an identified
 * speaker who is the offer's person, an offer still open, and the gates still passing; `approved: true`
 * alone, or any other text, is not consent. */
export function answerRobotOffer(input: AnswerInput): OfferAnswer {
  const now = input.now ?? new Date();
  const offer = db.select().from(robotOffers).where(eq(robotOffers.id, input.offerId)).get();
  if (!offer || offer.personId !== input.actor.id || offer.state !== "sent") return { kind: "stale" };
  if (Date.parse(offer.expiresAt) <= now.getTime()) return { kind: "stale" };
  const text = input.text.trim();
  if (SNOOZE_RE.test(text) && !AFFIRMATIVE_RE.test(text)) return { kind: "snoozed", offer: snoozeOffer(offer, now) };
  if (NEGATIVE_RE.test(text) || (!input.approved && text.length > 0)) return { kind: "declined", offer: closeOffer(offer, "declined", input.turnId, now) };
  if (!input.approved || !AFFIRMATIVE_RE.test(text)) return { kind: "not_consent" };
  if (!input.identified || !personMayBeAddressed(input.actor, now)) return { kind: "not_consent" };
  return { kind: "accepted", offer: closeOffer(offer, "accepted", input.turnId, now) };
}

function closeOffer(offer: OfferRow, state: "accepted" | "declined", turnId: string, now: Date): OfferRow {
  db.update(robotOffers).set({ state, turnId, closedAt: now.toISOString() }).where(eq(robotOffers.id, offer.id)).run();
  return { ...offer, state, turnId, closedAt: now.toISOString() };
}

function snoozeOffer(offer: OfferRow, now: Date): OfferRow {
  const snoozedUntil = new Date(now.getTime() + OFFER_SNOOZE_MS).toISOString();
  // The snooze outlasts the offer's own ttl, so "not now" is a later re-offer and never a "missed" notice.
  const expiresAt = new Date(Math.max(Date.parse(offer.expiresAt), Date.parse(snoozedUntil) + DEFAULT_OFFER_TTL_MS)).toISOString();
  db.update(robotOffers).set({ state: "snoozed", snoozedUntil, expiresAt }).where(eq(robotOffers.id, offer.id)).run();
  return { ...offer, state: "snoozed", snoozedUntil, expiresAt };
}

/** A channel `offer_snooze` frame (voice only): snoozes an offer the robot was sent, for 30 minutes. */
export function snoozeRobotOffer(deviceId: string, offerId: string, now: Date = new Date()): boolean {
  const offer = db.select().from(robotOffers).where(eq(robotOffers.id, offerId)).get();
  if (!offer || offer.deviceId !== deviceId || offer.state !== "sent" || Date.parse(offer.expiresAt) <= now.getTime()) return false;
  snoozeOffer(offer, now);
  return true;
}

/** A channel `offer_answer` frame that declines. Accepting happens only in a turn, where the words are checked. */
export function declineRobotOfferFromChannel(deviceId: string, offerId: string, now: Date = new Date()): boolean {
  const offer = db.select().from(robotOffers).where(eq(robotOffers.id, offerId)).get();
  if (!offer || offer.deviceId !== deviceId || offer.state !== "sent" || Date.parse(offer.expiresAt) <= now.getTime()) return false;
  closeOffer(offer, "declined", "", now);
  return true;
}
