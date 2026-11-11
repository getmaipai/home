import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";
import { storeFile } from "@/lib/attachments";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { listMediaSubjects } from "@/lib/mediaSubjects";
import { __setRolesVisionForTests, kindOfRole, parseReading, readPictureRoles } from "@/lib/pictures/roles";
import { pickStarter, prepareFilmPictures } from "@/lib/films/pictures";

const SAFE = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() } as never;
let actor: Awaited<ReturnType<typeof owner>>["row"];
const png = (color: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer().then((b) => new Uint8Array(b));
afterEach(() => __setRolesVisionForTests(null));
beforeEach(async () => { resetDb(); actor = (await owner()).row; });

describe("what each attached picture is for", () => {
  test("parses a reading and rejects a bad role or an empty name", () => {
    expect(parseReading('{"role":"product","name":"espresso machine","look":"white body, chrome handle"}')).toEqual({ role: "product", name: "espresso machine", look: "white body, chrome handle" });
    expect(parseReading('{"role":"hero","name":"x","look":"y"}')).toBeNull();
    expect(parseReading('{"role":"set","name":"","look":"y"}')).toBeNull();
    expect(parseReading("no json")).toBeNull();
  });
  test("a person or animal is a character, a product or object a prop, a set or building a place", () => {
    expect([kindOfRole("actor"), kindOfRole("product"), kindOfRole("prop"), kindOfRole("set"), kindOfRole("end_shot"), kindOfRole("other")]).toEqual(["character", "prop", "prop", "place", "place", "prop"]);
  });
  test("a model that cannot be read gives a plain line", async () => {
    __setRolesVisionForTests(async () => "not json");
    const result = await readPictureRoles([await png("#888")]);
    expect(result.ok).toBe(false);
  });
  test("a still starts from the picture of what the shot is mostly about", () => {
    const candidates = [{ name: "Man in a grey robe" }, { name: "Espresso machine" }, { name: "Apartment building" }];
    expect(pickStarter("Espresso machine close-up, the man in a grey robe behind", candidates)?.name).toBe("Espresso machine");
    expect(pickStarter("Wide retreat from the Apartment building at dawn", candidates)?.name).toBe("Apartment building");
    expect(pickStarter("A quiet street", candidates)?.name).toBe("Man in a grey robe");
    expect(pickStarter("anything", [])).toBeUndefined();
  });
  test("four pictures become an actor, a product, a set and a closing shot, saved as the right kinds", async () => {
    const resolved = resolveOrCreateConversation(actor, "chat"); if (!resolved.ok) throw new Error(resolved.error);
    const conversationId = resolved.value.id;
    logTurn(actor, "chat", "make an ad", { reply: { text: "ok" }, source: "plugin", plugin_id: "film", safety: SAFE, conversation_id: conversationId, turn_id: "turn-pics123" });
    const colors = ["#111111", "#eeeeee", "#aa8855", "#334455"];
    const ids: string[] = [];
    for (const [i, c] of colors.entries()) {
      const saved = storeFile(actor, { conversationId, turnId: "turn-pics123", mediaType: "image/png", bytes: await png(c), provenance: "upload", retention: "kept", name: `p${i}.png`, deduplicate: false });
      if (!saved.ok) throw new Error(saved.error); ids.push(saved.value.id);
    }
    const answers = [
      { role: "actor", name: "man in a grey robe", look: "tired man, grey robe, messy hair" },
      { role: "product", name: "espresso machine", look: "white body, chrome portafilter" },
      { role: "set", name: "small kitchen", look: "narrow kitchen, wooden counter" },
      { role: "end_shot", name: "apartment building", look: "red brick, six floors" },
    ];
    let n = 0; __setRolesVisionForTests(async () => JSON.stringify(answers[n++]));
    const result = await prepareFilmPictures(actor, { images: ids.map((id) => ({ id })), conversationId });
    if (!result.ok) throw new Error(result.line);
    expect(result.names).toEqual(["Man in a grey robe", "Espresso machine", "Small kitchen", "Apartment building"]);
    expect(result.hints[1]).toContain("Espresso machine (product");
    expect(result.hints[3]).toContain("closing wide shot");
    const kinds = Object.fromEntries(listMediaSubjects(actor).map((s) => [s.name, s.kind]));
    expect(kinds).toEqual({ "Man in a grey robe": "character", "Espresso machine": "prop", "Small kitchen": "place", "Apartment building": "place" });
  });
  test("two pictures of the same thing become one subject with two pictures", async () => {
    const resolved = resolveOrCreateConversation(actor, "chat"); if (!resolved.ok) throw new Error(resolved.error);
    const conversationId = resolved.value.id;
    logTurn(actor, "chat", "ad", { reply: { text: "ok" }, source: "plugin", plugin_id: "film", safety: SAFE, conversation_id: conversationId, turn_id: "turn-two123" });
    const ids: string[] = [];
    for (const c of ["#eeeeee", "#dddddd"]) { const s = storeFile(actor, { conversationId, turnId: "turn-two123", mediaType: "image/png", bytes: await png(c), provenance: "upload", retention: "kept", name: "m.png", deduplicate: false }); if (!s.ok) throw new Error(s.error); ids.push(s.value.id); }
    __setRolesVisionForTests(async () => JSON.stringify({ role: "product", name: "espresso machine", look: "white body" }));
    const result = await prepareFilmPictures(actor, { images: ids.map((id) => ({ id })), conversationId });
    if (!result.ok) throw new Error(result.line);
    expect(result.names).toEqual(["Espresso machine"]);
    expect(listMediaSubjects(actor).find((s) => s.name === "Espresso machine")?.reference_ids.length).toBe(2);
  });
});
