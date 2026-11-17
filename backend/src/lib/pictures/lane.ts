// KIDS-CREATE-01 (owner ruling, 2026-10-17): who makes what.
//
// Three lanes, decided by the stricter of the turn's band and the person's own band (never the looser):
//   - adult: content is decided by the model, with Home's CSAM prevention checks;
//   - teen:  pictures, videos and edits too, with age-based content filtering and the finished-picture check; adult-only styles are never offered;
//   - child: a strict lane of cartoon pictures and videos of safe things: a child-safe topic gate on the words, the cartoon look forced,
//            Quick only, no photos, no references, edits only of their own generated cartoons, a daily limit, and a
//            child-safety check on every finished picture or clip that fails closed.
// CSAM prevention applies across lanes.
import { CHILD_UNSAFE_TERMS, CHILD_IP_NAMES, CHILD_UNSAFE_CLASSES } from "@/lib/contentPolicy";
export { CHILD_UNSAFE_TERMS, CHILD_IP_NAMES } from "@/lib/contentPolicy";
import type { AgeBand } from "@/lib/ageBand";
import { audienceBand, stricterBand } from "@/lib/audience";
import { ceilingOf } from "@/lib/filter/ceiling";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { kidUsage } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hasWord, mentionsSexualWord, normalise, UNCLOTHED_PHRASES } from "./minorLine";
import type { PictureAudience } from "./policy";
import type { PersonRow } from "@/types";

export type Lane = "adult" | "teen" | "child";

/** The lane of a ceiling for made content: G is the child lane, PG to R the teen lane, X the adult lane (RULES.md C8: the level decides the treatment). */
const LANE_OF_CEILING: readonly Lane[] = ["child", "teen", "teen", "teen", "adult"];

/**
 * The one lane for a picture or clip (and every other made item): the stricter of the band the turn presents, the person's own band (role and birthdate) and the lane of the
 * person's ceiling for made content (`ceilingOf`, CONTENT-POLICY-03). A lowered ceiling (an admin's or the person's own) tightens the lane; a raised one never loosens it, so a
 * child stays in the child lane and a teen in the teen lane. A pass that cannot be read leaves the band's lane as it was.
 */
export function laneOf(input: Pick<PictureAudience, "actor" | "band">): Lane {
  const band = stricterBand(input.band, audienceBand(input.actor));
  try { return stricterBand(band, LANE_OF_CEILING[ceilingOf({ actor: input.actor, band }, "picture")]!); } catch { return band; }
}

// ---------------------------------------------------------------- the settings

export const KIDS_KEY = "generation.kids";
export const KID_ENABLED_KEY = "generation.kid_enabled";
export const KIDS_DAILY_PICTURES_KEY = "generation.kids_daily_pictures";
export const KIDS_DAILY_VIDEOS_KEY = "generation.kids_daily_videos";
export const DEFAULT_KIDS_DAILY_PICTURES = 20;
export const DEFAULT_KIDS_DAILY_VIDEOS = 5;

/** Whether the household switch for children is on (default on). A read failure reads as off. */
export function kidsHomeOn(): boolean {
  try { return getHouseholdSettingValue(KIDS_KEY) !== false; } catch { return false; }
}

/** The household switch for children (default on) and this child's own switch (default on): both must be on. A read failure reads as off, never as a way in. */
export function kidLaneOn(actor: PersonRow): boolean {
  try {
    if (getHouseholdSettingValue(KIDS_KEY) === false) return false;
    return getPersonSettingValue(actor, KID_ENABLED_KEY) !== false;
  } catch { return false; }
}

function whole(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
export function kidsDailyPictures(): number { try { return whole(getHouseholdSettingValue(KIDS_DAILY_PICTURES_KEY), DEFAULT_KIDS_DAILY_PICTURES); } catch { return DEFAULT_KIDS_DAILY_PICTURES; } }
export function kidsDailyVideos(): number { try { return whole(getHouseholdSettingValue(KIDS_DAILY_VIDEOS_KEY), DEFAULT_KIDS_DAILY_VIDEOS); } catch { return DEFAULT_KIDS_DAILY_VIDEOS; } }

// ---------------------------------------------------------------- the one short line each lane gets

export const TEEN_CONTENT_LINE = "I can't make that one. Want to try something different?";
export const CHILD_CONTENT_LINE = "Let's make something else: how about a friendly dragon?";
export const CHILD_LIMIT_LINE = "That's all the pictures for today. Let's make more tomorrow!";
export const CHILD_VIDEO_LIMIT_LINE = "That's all the videos for today. Let's make more tomorrow!";
export const CHILD_NO_PHOTOS_LINE = "I can make cartoons for you, but not from photos. How about a friendly dragon?";

// ---------------------------------------------------------------- the child-safe topic gate

/** CONTENT-POLICY-03: how a child's unsafe words class. `hard` is any sexual or nudity word, any brand or character name, or any unsafe word that is not tagged
 * `scary` or `pretend_fight` in lanes.v1.json (it keeps the fixed line, never a rewrite). When every hit is tagged, the class is `scary` if any hit is, else
 * `pretend_fight`. `null` is no hit. One hard hit makes the whole request hard, so a mixed request ("a pirate sword fight where someone is stabbed") is hard. */
export type ChildPromptClass = "scary" | "pretend_fight" | "hard";
export function childPromptClass(text: string): ChildPromptClass | null {
  if (mentionsSexualWord(text)) return "hard";
  const words = normalise(text);
  if (UNCLOTHED_PHRASES.some((phrase) => hasWord(words, phrase))) return "hard";
  const plain = (term: string) => term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (CHILD_IP_NAMES.some((name) => hasWord(words, plain(name)))) return "hard";
  const hits = CHILD_UNSAFE_TERMS.filter((term) => hasWord(words, plain(term)));
  // A few inflections of hard words that the list lacks ("stabbed"): held for a child, and they make the request hard.
  if (CHILD_UNSAFE_CLASSES.hard.some((term) => hasWord(words, plain(term)))) return "hard";
  if (hits.length === 0) return null;
  const scary = new Set(CHILD_UNSAFE_CLASSES.scary.map(plain));
  const fight = new Set(CHILD_UNSAFE_CLASSES.pretend_fight.map(plain));
  const classes = hits.map((term) => scary.has(plain(term)) ? "scary" as const : fight.has(plain(term)) ? "pretend_fight" as const : "hard" as const);
  if (classes.includes("hard")) return "hard";
  return classes.includes("scary") ? "scary" : "pretend_fight";
}

/** Whether a child's words stay inside the child-safe lane. Sexual and nudity words and minor-with-sexual wording are refused too (the absolute line runs separately and first). */
export function childPromptUnsafe(text: string): boolean {
  return childPromptClass(text) !== null;
}

/** A teen's words: nothing adult or sexual. The absolute line runs separately and first. */
export function teenPromptUnsafe(text: string): boolean {
  if (mentionsSexualWord(text)) return true;
  const words = normalise(text);
  return UNCLOTHED_PHRASES.some((phrase) => hasWord(words, phrase));
}

// ---------------------------------------------------------------- the child's cartoon look

/** Put in front of every child prompt (a child never sees it): the look is forced, not asked for. */
export const CHILD_PROMPT_PREFIX = "A friendly, colourful children's cartoon illustration, flat shapes and soft outlines, clearly drawn and not a photograph, safe for young children: ";
/** What the child lane steers the engine away from, whatever the words say. */
export const CHILD_NEGATIVE_PROMPT = "photograph, photorealistic, realistic, logo, brand, text, watermark, nude, naked, nsfw, sexual, violence, blood, gore, weapon, scary, horror, drugs, alcohol, cigarette";

export function forceCartoon(prompt: string): string {
  return `${CHILD_PROMPT_PREFIX}${prompt.trim()}`;
}

// ---------------------------------------------------------------- which video model a young person gets

/** The Quick video model (Wan 2.2, silent). A child and a teen get this one and nothing else until the owner allows more for their lane. */
export const WAN_QUICK_VIDEO_MODEL = "wan2.2-ti2v-5b-fastwan-mlx";
/** Models a teen or a child may be sent to. LTX (with sound) is not here: adding it is a decision for the owner, per lane (lane review, 2026-10-17). */
export const YOUNG_VIDEO_MODELS: readonly string[] = [WAN_QUICK_VIDEO_MODEL];
/** What goes in the video request's `model` for this lane: the adult's choice stands (undefined is the engine's default); a teen or a child is always on an allowed model. */
export function videoModelForLane(lane: Lane, requested?: string | null): string | undefined {
  if (lane === "adult") return requested ?? undefined;
  return requested && YOUNG_VIDEO_MODELS.includes(requested) ? requested : WAN_QUICK_VIDEO_MODEL;
}

// ---------------------------------------------------------------- the daily limit

/** Every day is the local day of this computer, written YYYY-MM-DD. */
function dayOf(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export type KidKind = "picture" | "video" | "edit" | "photo";
/** What a child asked for today, from the stored ledger (`kid_usage`): every ask counts, failed and held-back ones too, and a deleted chat or a restart gives nothing back. */
function usedToday(personId: string, kinds: readonly KidKind[], now: Date): number {
  const rows = db.select({ units: kidUsage.units, kind: kidUsage.kind }).from(kidUsage).where(and(eq(kidUsage.personId, personId), eq(kidUsage.day, dayOf(now)))).all();
  return rows.filter((row) => (kinds as readonly string[]).includes(row.kind)).reduce((sum, row) => sum + row.units, 0);
}
export function picturesMadeToday(actor: PersonRow, now = new Date()): number { return usedToday(actor.id, ["picture", "edit"], now); }
export function videosMadeToday(actor: PersonRow, now = new Date()): number { return usedToday(actor.id, ["video"], now); }

/**
 * Takes `units` of today's allowance, or nothing. The check and the write are one synchronous step (SQLite in this process), so two requests
 * that arrive together cannot both pass. Pictures and edits share one allowance; videos have their own. Returns the ledger row's id, or null
 * when the day's allowance is used up. Call `releaseKid` when the work did not start after all.
 */
export function reserveKid(actor: PersonRow, kind: KidKind, units: number, prompt: string, now = new Date()): string | null {
  return db.transaction((tx) => {
    const limit = kind === "video" ? kidsDailyVideos() : kidsDailyPictures();
    const used = tx.select({ units: kidUsage.units, kind: kidUsage.kind }).from(kidUsage).where(and(eq(kidUsage.personId, actor.id), eq(kidUsage.day, dayOf(now)))).all()
      .filter((row) => (kind === "video" ? row.kind === "video" : row.kind !== "video")).reduce((sum, row) => sum + row.units, 0);
    if (used + units > limit) return null;
    const id = `ku-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    tx.insert(kidUsage).values({ id, personId: actor.id, day: dayOf(now), kind, units, prompt: prompt.slice(0, 500), outcome: "asked", createdAt: now.toISOString() }).run();
    return id;
  });
}
export function releaseKid(id: string | null): void { if (id) db.delete(kidUsage).where(eq(kidUsage.id, id)).run(); }
/** A teen's edit of a photo they say is of themselves goes in the admins' activity list, allowed or refused (it takes nothing from any allowance: zero units). */
export function noteTeenPhotoEdit(actor: PersonRow, prompt: string, outcome: "asked" | "withheld", now = new Date()): void {
  try {
    db.insert(kidUsage).values({ id: `ku-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, personId: actor.id, day: dayOf(now), kind: "photo", units: 0, prompt: prompt.slice(0, 500), outcome, createdAt: now.toISOString() }).run();
  } catch (error) { console.error("[lane] could not log a teen's photo edit", error instanceof Error ? error.name : "error"); }
}
/** Remembers which job a ledger row became. */
export function attachKid(id: string | null, ref: string): void { if (id) db.update(kidUsage).set({ ref }).where(eq(kidUsage.id, id)).run(); }
/** Marks the ledger row of a job whose finished item was held back (the admins' activity list reads it). */
export function markKidWithheld(ref: string): void { db.update(kidUsage).set({ outcome: "withheld" }).where(eq(kidUsage.ref, ref)).run(); }
