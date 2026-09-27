#!/usr/bin/env bun
// PEOPLE-PROFILE-02: scripts/screenshot.ts's own real-content seed for
// the profile page's shared-media grid. createAttachment() has no HTTP
// caller anywhere in this codebase yet (STORE-PAGE-01's own done note:
// "a freshly seeded household cannot have a real file in it today" -
// checked again here, still true) - the same direct-database pattern
// scripts/set-setting.ts already uses for a not-yet-started server
// extends here to one already running: `backend/src/db/index.ts` turns
// on WAL mode specifically so more than one connection can use the
// database at once, and this script only ever opens one, writes two
// rows (one attachment, one share), and exits - a real file `readAttachment`
// can actually serve bytes for is the only way MediaGrid's `thumbnailUrl`
// has anything real to point at for a screenshot.
//
//   bun run backend/scripts/seed-profile-share.ts <ownerDisplayName> <shareToDisplayNameOrHousehold>
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { people, conversationTurns } from "../src/db/schema";
import { createAttachment } from "../src/lib/attachments";
import { createShare } from "../src/lib/shares";
import { resolveOrCreateConversation } from "../src/lib/conversationHistory";
import { newConversationTurnId } from "../src/lib/id";
import { nextHlc } from "../src/lib/hlc";

const [ownerName, shareTo] = process.argv.slice(2);
if (!ownerName || !shareTo) {
  console.error("usage: bun run backend/scripts/seed-profile-share.ts <ownerDisplayName> <shareToDisplayNameOrHousehold>");
  process.exit(1);
}

function personByName(displayName: string) {
  const row = db.select().from(people).where(eq(people.displayName, displayName)).get();
  if (!row) {
    console.error(`no such person: ${displayName}`);
    process.exit(1);
  }
  return row;
}

const ownerPerson = personByName(ownerName);

const conversation = resolveOrCreateConversation(ownerPerson, "chat");
if (!conversation.ok) {
  console.error(`could not open a conversation for ${ownerName}: ${conversation.error}`);
  process.exit(1);
}
const turnId = newConversationTurnId();
db.insert(conversationTurns)
  .values({
    id: turnId,
    personId: ownerPerson.id,
    surface: "chat",
    conversationId: conversation.value.id,
    userText: "a shared photo",
    replyText: "saved",
    source: "model",
    safetyAction: "allow",
    createdAt: new Date().toISOString(),
    hlc: nextHlc(),
  })
  .run();

// A real, tiny, valid PNG (a 4x4 solid red-orange square, 8-bit RGB,
// verified by decoding it back and reading its own pixels before this
// was committed - a first cut here used a 1-bit grayscale pixel that
// happened to be black, which rendered as a suspicious black square in
// the screenshot rather than a recognizable photo). MediaGrid renders
// this as a real <img>, and the real browser this screenshot uses needs
// real, colored image bytes to paint, not just a byte count.
const RED_PIXEL_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVQI12N8EOTFAANMDEgANwcAS9IBhP9AT3kAAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

const created = createAttachment(ownerPerson, {
  conversationId: conversation.value.id,
  turnId,
  mediaType: "image/png",
  bytes: RED_PIXEL_PNG,
});
if (!created.ok) {
  console.error(`could not create the seed attachment: ${created.error}`);
  process.exit(1);
}

const to = shareTo === "household" ? "household" : personByName(shareTo).id;
const shared = createShare(ownerPerson, { fileId: created.value.id, to, provenance: "screenshot-seed" });
if (!shared.ok) {
  console.error(`could not share the seed attachment: ${shared.error}`);
  process.exit(1);
}

console.log(`seeded file ${created.value.id} owned by ${ownerName}, shared to ${shareTo}`);
