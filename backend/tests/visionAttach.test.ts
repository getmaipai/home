import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";
import { storeFile } from "@/lib/attachments";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { __setPictureDescriberForTests, __setVisionReaderForTests, describePictures, visionPicturesAllowed } from "@/lib/chatPictures";

const SAFE = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() } as never;
let actor: Awaited<ReturnType<typeof owner>>["row"];
const png = () => sharp({ create: { width: 32, height: 32, channels: 3, background: "#884422" } }).png().toBuffer().then((b) => new Uint8Array(b));
beforeEach(async () => { resetDb(); actor = (await owner()).row; });
afterEach(() => { __setVisionReaderForTests(null); __setPictureDescriberForTests(null); });

describe("pictures through the vision model when chat cannot read them", () => {
  test("only when the vision model is ready", async () => {
    __setVisionReaderForTests(true);
    expect(await visionPicturesAllowed(actor)).toBe(true);
    __setVisionReaderForTests(false);
    expect(await visionPicturesAllowed(actor)).toBe(false);
  });
  test("each stored picture is described, and one that cannot be described is reported unread", async () => {
    const resolved = resolveOrCreateConversation(actor, "chat"); if (!resolved.ok) throw new Error(resolved.error);
    const conversationId = resolved.value.id;
    logTurn(actor, "chat", "look", { reply: { text: "ok" }, source: "plugin", plugin_id: "film", safety: SAFE, conversation_id: conversationId, turn_id: "turn-vis123" });
    const ids: string[] = [];
    for (const name of ["a.png", "b.png"]) { const saved = storeFile(actor, { conversationId, turnId: "turn-vis123", mediaType: "image/png", bytes: await png(), provenance: "upload", retention: "kept", name, deduplicate: false }); if (!saved.ok) throw new Error(saved.error); ids.push(saved.value.id); }
    let n = 0; __setPictureDescriberForTests(async () => { if (++n === 2) throw new Error("slow"); return "A brown square."; });
    const images = ids.map((id, i) => ({ id, name: i === 0 ? "a.png" : "b.png", width: 32, height: 32, media_type: "image/png" })) as never;
    const read = await describePictures(actor, conversationId, false, images);
    expect(read.described).toEqual([{ name: "a.png", text: "A brown square." }]);
    expect(read.unread.map((u) => u.id)).toEqual([ids[1]!]);
  });
});
