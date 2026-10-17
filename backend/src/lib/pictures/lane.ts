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
import { kidUsage } from "@/db/schema";
import { and, eq } from "drizzle-orm";
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
  // weapons, fire and destruction (siblings of the above)
  "sword", "swords", "dagger", "machete", "axe", "axes", "hatchet", "spear", "spears", "bayonet", "grenade", "grenades", "chainsaw", "bazooka", "missile", "missiles", "bullet", "bullets", "ammo", "firearm", "firearms", "handgun", "shotgun", "revolver", "machine gun", "gunfire", "gunman", "sniper", "dynamite", "tnt", "napalm", "nuke", "nukes", "bombing", "bomber", "explode", "exploding", "explosive", "explosives", "arson", "burning", "burn down", "burned down", "set fire", "slay", "slaying", "slayer", "slain", "slaughter", "massacre", "hostage", "kidnap", "kidnapping", "execution", "hanging", "noose",
  // clothes and body that are not for a child's request
  "bikini", "lingerie", "underwear", "panties", "bra", "topless", "cleavage", "stripper", "naked", "nude",
  // more drugs and alcohol
  "joint", "bong", "blunt", "spliff", "vapes", "e-cigarette", "cigar", "cigars", "tobacco", "opioid", "lsd", "ecstasy", "booze", "liquor", "tequila", "champagne", "hangover", "beers",
  // brands, characters and celebrities that are somebody's likeness or trademark
  "disney", "marvel", "pokemon", "nintendo", "mickey mouse", "spider-man", "spiderman", "batman", "superman", "taylor swift", "elon musk", "donald trump", "joe biden", "kardashian", "beyonce", "coca cola", "mcdonalds", "nike", "lego",
];

/** Famous characters and brands a child's request may not name: each is somebody's trademark, and a drawing of one is not a safe original cartoon. Small on purpose, and one place to add a name; the finished-picture check is the backstop for the rest. A teen is not held to this list. */
export const CHILD_IP_NAMES: readonly string[] = [
  "pikachu", "charizard", "pokemon", "mario", "luigi", "bowser", "zelda", "sonic", "minecraft", "roblox", "fortnite", "elsa", "olaf", "moana", "mulan", "simba", "winnie the pooh", "mickey", "minnie", "donald duck", "goofy",
  "peppa pig", "bluey", "paw patrol", "spongebob", "hello kitty", "barbie", "shrek", "minions", "bugs bunny", "tom and jerry", "scooby doo", "elmo", "sesame street", "dora the explorer", "thomas the tank engine",
  "star wars", "darth vader", "yoda", "harry potter", "hogwarts", "batman", "superman", "spider man", "spiderman", "iron man", "hulk", "thor", "captain america", "wonder woman", "joker", "avengers",
];

/** Whether a child's words stay inside the child-safe lane. Sexual and nudity words and minor-with-sexual wording are refused too (the absolute line runs separately and first). */
export function childPromptUnsafe(text: string): boolean {
  if (mentionsSexualWord(text)) return true;
  const words = normalise(text);
  if (UNCLOTHED_PHRASES.some((phrase) => hasWord(words, phrase))) return true;
  const plain = (term: string) => term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return CHILD_UNSAFE_TERMS.some((term) => hasWord(words, plain(term))) || CHILD_IP_NAMES.some((name) => hasWord(words, plain(name)));
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

export type KidKind = "picture" | "video" | "edit";
export type KidOutcome = "asked" | "made" | "withheld";

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
/** Remembers which job a ledger row became. */
export function attachKid(id: string | null, ref: string): void { if (id) db.update(kidUsage).set({ ref }).where(eq(kidUsage.id, id)).run(); }
/** Marks the ledger row of a job whose finished item was held back (the admins' activity list reads it). */
export function markKidWithheld(ref: string): void { db.update(kidUsage).set({ outcome: "withheld" }).where(eq(kidUsage.ref, ref)).run(); }
