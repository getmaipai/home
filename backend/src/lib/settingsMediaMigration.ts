// VIDEO-SETTINGS-04 (docs/design/settings-media-2026-11-02.md section 8): the revamped Pictures, videos and music keys are written from the
// old ones, once, at boot. Nothing is lost and nothing is deleted:
//   generation.adult_adapters, generation.video.adult_adapters  ->  generation.styles.adult_only   restricted if EITHER old value is restricted
//   generation.picture_quality, generation.video_quality        ->  generation.picture_tier, generation.video_tier   quick = standard, detailed = boost
// The old keys stay stored and readable until VIDEO-SETTINGS-09 drops them from the spec. Safe to run twice: a value a person already set under
// a new key always wins, the marker records that the step ran, and a failed write leaves the marker unset so the next boot tries again.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { getHouseholdSettingSource, getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";

const MARKER_KEY = "__migration.settings_media_04";

export const OLD_PICTURE_ADULT_KEY = "generation.adult_adapters";
export const OLD_VIDEO_ADULT_KEY = "generation.video.adult_adapters";
export const NEW_ADULT_STYLES_KEY = "generation.styles.adult_only";
export const OLD_PICTURE_QUALITY_KEY = "generation.picture_quality";
export const OLD_VIDEO_QUALITY_KEY = "generation.video_quality";
export const NEW_PICTURE_TIER_KEY = "generation.picture_tier";
export const NEW_VIDEO_TIER_KEY = "generation.video_tier";

const isSet = (key: string) => getHouseholdSettingSource(key) !== undefined;

/** What the new keys should hold for the old values, or nothing for a key that stays at its default. Pure: the migration table in one place. */
export function mappedMediaSettings(old: { pictureAdult: unknown; videoAdult: unknown; pictureQuality: unknown; videoQuality: unknown }): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  if (old.pictureAdult === "restricted" || old.videoAdult === "restricted") out.push({ key: NEW_ADULT_STYLES_KEY, value: "restricted" });
  if (old.pictureQuality === "detailed") out.push({ key: NEW_PICTURE_TIER_KEY, value: "boost" });
  if (old.videoQuality === "detailed") out.push({ key: NEW_VIDEO_TIER_KEY, value: "boost" });
  return out;
}

/** One time, at boot. `failed` leaves the marker unset (the next boot runs it again). */
export function migrateMediaSettings(): "already_ran" | "migrated" | "failed" {
  try { return runMigration(); } catch (error) { console.warn(`[settings-media] the media settings step failed and will run again at the next start: ${error instanceof Error ? error.message : String(error)}`); return "failed"; }
}

function runMigration(): "already_ran" | "migrated" | "failed" {
  const marker = db.select({ key: settingsValues.key }).from(settingsValues)
    .where(and(eq(settingsValues.scope, "system"), eq(settingsValues.key, MARKER_KEY))).get();
  if (marker) return "already_ran";
  // An old key counts only when a person set it (a default is not a choice to carry over).
  const stored = (key: string) => (isSet(key) ? getHouseholdSettingValue(key) : undefined);
  const wanted = mappedMediaSettings({ pictureAdult: stored(OLD_PICTURE_ADULT_KEY), videoAdult: stored(OLD_VIDEO_ADULT_KEY), pictureQuality: stored(OLD_PICTURE_QUALITY_KEY), videoQuality: stored(OLD_VIDEO_QUALITY_KEY) });
  for (const { key, value } of wanted) {
    if (isSet(key)) continue;
    const written = setHouseholdSettingValue(key, value);
    if (!written.ok) { console.warn(`[settings-media] could not carry over ${key}: ${written.error}`); return "failed"; }
  }
  db.insert(settingsValues).values({ scope: "system", key: MARKER_KEY, value: "true", hlc: nextHlc(), source: "migration", setBy: null, updatedAt: new Date().toISOString() }).run();
  return "migrated";
}
