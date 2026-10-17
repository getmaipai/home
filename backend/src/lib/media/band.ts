// MEDIA-LIB-01 (design section 11): which people may see a media item. `band_ok` is the lowest band that may see the title,
// description and artwork, computed at ingest: adult when the file is marked explicit, adult when its words trip the same
// deterministic minor floor KS-05's shelf uses (lib/retrieval/minorFloor.ts, called by lib/shelf), otherwise child. The floor runs
// again at every read for a minor, so a stored row is never trusted on its own word. Rule 0: age and surface gates outrank all.
import type { AgeBand } from "@/lib/ageBand";
import { speakerAgeBand } from "@/lib/ageBand";
import { mentionsSexualWord } from "@/lib/pictures/minorLine";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import { bandOkAllowedFor } from "@/lib/shelf/shelfPolicy";
import type { PersonRow } from "@/types";
import type { Band, MediaItem } from "./model";

export interface BandInput {
  explicit: boolean;
  title: string;
  description?: string | null;
  /** Other words shown with the item (artist, album, series, show) are held to the same floor. */
  also?: ReadonlyArray<string | null | undefined>;
}

export interface BandVerdict {
  band: Band;
  advisorySource: "tag" | "classifier";
}

function floorText(item: Pick<BandInput, "title" | "description" | "also">): string {
  return [item.title, ...(item.also ?? []), item.description].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(". ");
}

/** The floor KS-05 uses, plus the household's one list of sexual words (lib/pictures/minorLine.ts): a library file is not a news
 * headline, and the shelf's floor alone does not catch a title like "Hardcore porn". Stricter only: a false hit makes a title
 * adult-only until an adult marks it fine. */
export function trips(text: string): boolean {
  return tripsMinorFloor(text) || mentionsSexualWord(text);
}

export function bandOkAtIngest(input: BandInput): BandVerdict {
  if (input.explicit) return { band: "adult", advisorySource: "tag" };
  if (trips(floorText(input))) return { band: "adult", advisorySource: "classifier" };
  return { band: "child", advisorySource: "tag" };
}

/** The band a person reads media at. A guest is treated as a child: nothing the household has not cleared for everyone. */
export function mediaBandOf(actor: PersonRow): AgeBand {
  if (actor.role === "guest") return "child";
  return speakerAgeBand(actor, new Date());
}

/** The `band_ok` values a person may be shown. */
export function allowedBandsFor(actor: PersonRow): Band[] {
  return bandOkAllowedFor(mediaBandOf(actor));
}

/** Whether `actor` may see this item's band: the stored value, and for a minor the floor again on the words. */
export function bandAllows(actor: PersonRow, item: Pick<MediaItem, "band_ok" | "title" | "description" | "subtitle" | "advisory"> & Partial<Pick<MediaItem, "artist" | "album" | "album_artist" | "genre">>): boolean {
  const band = mediaBandOf(actor);
  if (!bandOkAllowedFor(band).includes(item.band_ok)) return false;
  if (band === "adult") return true;
  if (item.advisory.explicit) return false;
  return !trips(floorText({ title: item.title, description: item.description, also: [item.subtitle, item.artist, item.album, item.album_artist, item.genre] }));
}
