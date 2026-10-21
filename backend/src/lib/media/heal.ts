// MEDIA-SOURCE-HEAL-01: boot-time repair of the private "Created by you" source that an early build saved with an id and a folder the spec
// refuses (`msrc-made-<person>`, no folder). Such a row made every media query fail. It is rewritten under the valid id with a fixed folder
// name and paused, and the songs saved under it move across. Idempotent: a hub with nothing to repair does nothing.
import { eq, like } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { LEGACY_MADE_SOURCE_PREFIX, madeSourceId } from "./model";

export function healMadeSources(): number {
  const legacy = db.select().from(mediaSources).where(like(mediaSources.id, `${LEGACY_MADE_SOURCE_PREFIX}%`)).all();
  for (const row of legacy) {
    const newId = madeSourceId(row.ownerPersonId ?? row.id.slice(LEGACY_MADE_SOURCE_PREFIX.length));
    db.transaction((tx) => {
      if (!tx.select().from(mediaSources).where(eq(mediaSources.id, newId)).get()) {
        tx.insert(mediaSources).values({ ...row, id: newId, rootPath: "made-at-home", rootKinds: JSON.stringify(["track"]), paused: true }).run();
      }
      tx.update(mediaItems).set({ sourceId: newId }).where(eq(mediaItems.sourceId, row.id)).run();
      tx.delete(mediaSources).where(eq(mediaSources.id, row.id)).run();
    });
  }
  return legacy.length;
}
