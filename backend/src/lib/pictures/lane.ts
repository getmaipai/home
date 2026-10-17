// PEOPLE-PROMPTS-01 and KIDS-CREATE-01 (owner rulings, 2026-10-17): who makes what, and how much Home says about it.
//
// Three lanes, decided by the stricter of the turn's band and the person's own band (never the looser):
//   - adult: pictures and videos with no filter beyond the absolute lines (policy.ts, minorLine.ts);
//   - teen:  pictures, videos and edits too, with nothing adult or sexual: the prompt gate and the finished-picture check refuse it
//            in ONE short plain line, adult-only styles are never offered, a real person's likeness needs that person's recorded consent;
//   - child: a strict lane of cartoon pictures and videos of safe things: a child-safe topic gate on the words, the cartoon look forced,
//            Quick only, no photos, no references, no real people, edits only of their own generated cartoons, a daily limit, and a
//            child-safety check on every finished picture or clip that fails closed.
// None of these lanes makes the absolute lines optional, and no setting reaches them. The one friction setting
// (`generation.people_prompts`) touches only the adult lane: a teen or a child never gets hedging, lecturing, a clarifying question with a
// safe default or an extra confirmation.
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { pictureJobs, videoJobs } from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { hasWord, mentionsSexualWord, normalise, UNCLOTHED_PHRASES } from "./minorLine";
import type { PictureAudience } from "./policy";
import type { PersonRow } from "@/types";

export type Lane = "adult" | "teen" | "child";

const STRICT: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };

/** The lane: the stricter of the band the turn presents and the person's own band (role and birthdate). */
export function laneOf(input: Pick<PictureAudience, "actor" | "band">): Lane {
  const own = speakerAgeBand(input.actor, new Date());
  return STRICT[input.band] <= STRICT[own] ? input.band : own;
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

/** Whole words and phrases a child's request may not contain: violence and weapons, gore, scary or horror, romance, drugs and alcohol, hate, self-harm, and a few famous brands and characters (a real person or a brand is also checked on the finished picture). A list is a floor, not the judge: the finished picture is checked too and a doubt withholds it. */
export const CHILD_UNSAFE_TERMS: readonly string[] = [
  // violence and weapons
  "kill", "kills", "killing", "killed", "murder", "murders", "murdered", "stab", "stabbing", "shoot", "shooting", "shot", "gun", "guns", "rifle", "pistol", "weapon", "weapons", "knife", "knives", "sword fight", "bomb", "bombs", "explosion", "blood", "bloody", "gore", "gory", "corpse", "dead body", "violence", "violent", "war", "battle", "fight", "fighting", "punch", "punching", "strangle", "torture", "execution", "hanging",
  // scary
  "horror", "scary", "creepy", "zombie", "zombies", "demon", "demons", "devil", "satan", "ghost", "haunted", "nightmare", "slasher", "skull", "skeleton", "monster attack", "vampire bite",
  // romance and sexual
  "romantic", "romance", "kissing", "making out", "boyfriend", "girlfriend", "lover", "seductive", "flirt", "flirting", "date night",
  // drugs, alcohol, gambling
  "drug", "drugs", "cocaine", "heroin", "weed", "marijuana", "cannabis", "meth", "vape", "vaping", "cigarette", "cigarettes", "smoking", "beer", "wine", "vodka", "whiskey", "alcohol", "drunk", "cocktail", "gambling", "casino",
  // hate and self-harm
  "nazi", "swastika", "racist", "racism", "slur", "terrorist", "suicide", "self harm", "self-harm", "cutting myself", "hang myself",
  // brands, characters and celebrities that are somebody's likeness or trademark
  "disney", "marvel", "pokemon", "nintendo", "mickey mouse", "spider-man", "spiderman", "batman", "superman", "taylor swift", "elon musk", "donald trump", "joe biden", "kardashian", "beyonce", "coca cola", "mcdonalds", "nike", "lego",
];

/** Whether a child's words stay inside the child-safe lane. Sexual and nudity words and minor-with-sexual wording are refused too (the absolute line runs separately and first). */
export function childPromptUnsafe(text: string): boolean {
  if (mentionsSexualWord(text)) return true;
  const words = normalise(text);
  if (UNCLOTHED_PHRASES.some((phrase) => hasWord(words, phrase))) return true;
  return CHILD_UNSAFE_TERMS.some((term) => hasWord(words, term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
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
export const CHILD_NEGATIVE_PROMPT = "photograph, photorealistic, realistic, real person, real face, celebrity, logo, brand, text, watermark, nude, naked, nsfw, sexual, violence, blood, gore, weapon, scary, horror, drugs, alcohol, cigarette";

export function forceCartoon(prompt: string): string {
  return `${CHILD_PROMPT_PREFIX}${prompt.trim()}`;
}

// ---------------------------------------------------------------- the daily limit

/** Every day is the local day of this computer. */
function startOfToday(now = new Date()): string {
  const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString();
}

/** Pictures this person asked for today. Stored jobs plus a memory ledger, so deleting a chat does not give the limit back while Home is running. */
const ledger = new Map<string, { day: string; pictures: number; videos: number }>();
export function __resetKidLedgerForTests(): void { ledger.clear(); }

function entry(personId: string, now = new Date()) {
  const day = startOfToday(now);
  const found = ledger.get(personId);
  if (found && found.day === day) return found;
  const fresh = { day, pictures: 0, videos: 0 };
  ledger.set(personId, fresh);
  return fresh;
}

export function picturesMadeToday(actor: PersonRow, now = new Date()): number {
  const stored = db.select({ request: pictureJobs.request, kind: pictureJobs.kind, state: pictureJobs.state }).from(pictureJobs)
    .where(and(eq(pictureJobs.personId, actor.id), gte(pictureJobs.createdAt, startOfToday(now)))).all();
  let count = 0;
  for (const row of stored) {
    if (row.state === "failed" || row.state === "cancelled") continue;
    try { count += Math.max(1, Number((JSON.parse(row.request) as { n?: number }).n ?? 1)); } catch { count += 1; }
  }
  return Math.max(count, entry(actor.id, now).pictures);
}
export function noteKidPictures(actor: PersonRow, n: number, now = new Date()): void { entry(actor.id, now).pictures += n; }
export function noteKidVideo(actor: PersonRow, now = new Date()): void { entry(actor.id, now).videos += 1; }
export function videosMadeToday(actor: PersonRow, now = new Date()): number {
  const stored = db.select({ state: videoJobs.state }).from(videoJobs).where(and(eq(videoJobs.personId, actor.id), gte(videoJobs.createdAt, startOfToday(now)))).all()
    .filter((row) => row.state !== "failed" && row.state !== "cancelled").length;
  return Math.max(stored, entry(actor.id, now).videos);
}
