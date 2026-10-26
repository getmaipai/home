// Music's item view carries lyrics only after the same band check used for the rest of the item.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaSources } from "@/db/schema";
import { getHouseholdSettingValue } from "@/lib/settings";
import { mediaBandOf, bandAllows } from "./band";
import { registerItemView } from "./appHost";

registerItemView("music", (person, item, view) => {
  const allowed = bandAllows(person, item);
  const lyrics = allowed ? item.lyrics : null;
  const scanned = item.provenance !== "music:generated-library" && item.source_id && !item.source_id.startsWith("msrc-made")
    && db.select({ id: mediaSources.id }).from(mediaSources).where(eq(mediaSources.id, item.source_id)).get();
  const lookup = !lyrics && !!scanned && item.kind === "track" && !!item.artist && !!item.title
    && getHouseholdSettingValue("music.lyrics_online") !== false && mediaBandOf(person) !== "child";
  return {
    ...view,
    ...(lyrics ? { lyrics: lyrics.text, ...(lyrics.timed ? { timed_lyrics: lyrics.timed } : {}) } : {}),
    lyrics_lookup: lookup ? "available" : "none",
  };
});
