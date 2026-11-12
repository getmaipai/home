import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";
import { storeFile } from "@/lib/attachments";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { listMediaSubjects } from "@/lib/mediaSubjects";
import { __setRolesVisionForTests, kindOfRole, parseReading, readPictureRoles } from "@/lib/pictures/roles";
import { pickStarter, prepareFilmPictures } from "@/lib/films/pictures";
import { __setStartFilmForTests, runMakeFilmTurn } from "@/lib/films/tool";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";

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

  test("file names the model puts in characters are ignored: the attached pictures are read instead", async () => {
    const resolved = resolveOrCreateConversation(actor, "chat"); if (!resolved.ok) throw new Error(resolved.error);
    const conversationId = resolved.value.id;
    logTurn(actor, "chat", "ad", { reply: { text: "ok" }, source: "plugin", plugin_id: "film", safety: SAFE, conversation_id: conversationId, turn_id: "turn-fn1234" });
    const ids: string[] = [];
    for (const c of ["#eeeeee", "#334455"]) { const s = storeFile(actor, { conversationId, turnId: "turn-fn1234", mediaType: "image/png", bytes: await png(c), provenance: "upload", retention: "kept", name: "x.png", deduplicate: false }); if (!s.ok) throw new Error(s.error); ids.push(s.value.id); }
    const answers = [{ role: "product", name: "coffee mug", look: "white ceramic mug" }, { role: "set", name: "factory floor", look: "bright factory with conveyor belts" }]; let n = 0;
    __setRolesVisionForTests(async () => JSON.stringify(answers[n++]));
    let received: Record<string, unknown> | undefined;
    __setStartFilmForTests((input) => { received = input as unknown as Record<string, unknown>; return { id: "run-9" }; });
    __setVideoStatusForTests(readyVideoStatusForTests());
    try {
      const outcome = await runMakeFilmTurn({ state: { actor, surface: "chat", planBasis: { surfaceClass: "written" }, temporary: false, conversationId, images: ids.map((id) => ({ id })) as never } as never, args: { idea: "A 30 second ad for the mug", seconds: 30, characters: ["mug.jpg", "factory.JPEG"] }, callId: "c1", spoken: false });
      expect(outcome.status).toBe("succeeded");
      const hints = (received as { castHints: string[] }).castHints;
      expect(hints.some((h) => /\.jpe?g/i.test(h) && !h.includes("("))).toBe(false);
      expect(hints.some((h) => h.startsWith("Coffee mug (product"))).toBe(true);
      expect(hints.some((h) => h.startsWith("Factory floor (set"))).toBe(true);
    } finally { __setStartFilmForTests(null); __setVideoStatusForTests(undefined); }
  });

  test("real uploads: a picture saved exactly as sent still becomes a character (the saved copy is its own kept file, never the upload)", async () => {
    const resolved = resolveOrCreateConversation(actor, "chat"); if (!resolved.ok) throw new Error(resolved.error);
    const conversationId = resolved.value.id;
    logTurn(actor, "chat", "ad", { reply: { text: "ok" }, source: "plugin", plugin_id: "film", safety: SAFE, conversation_id: conversationId, turn_id: "turn-real12" });
    const bytes = await png("#775533");
    // The composer stores an upload with retention "conversation" and the default de-duplication, exactly like this.
    const upload = storeFile(actor, { conversationId, turnId: "turn-real12", mediaType: "image/png", bytes, provenance: "composer:mug.png", retention: "conversation", name: "mug.png" });
    if (!upload.ok) throw new Error(upload.error);
    __setRolesVisionForTests(async () => JSON.stringify({ role: "product", name: "coffee mug", look: "white ceramic mug" }));
    const result = await prepareFilmPictures(actor, { images: [{ id: upload.value.id }], conversationId });
    if (!result.ok) throw new Error(result.line);
    const mug = listMediaSubjects(actor).find((s) => s.name === "Coffee mug")!;
    expect(mug.kind).toBe("prop");
    expect(mug.reference_ids).toHaveLength(1);
    expect(mug.reference_ids[0]).not.toBe(upload.value.id);
  });
  test("real uploads: two identical-bytes pictures of one thing add a second reference instead of failing", async () => {
    const resolved = resolveOrCreateConversation(actor, "chat"); if (!resolved.ok) throw new Error(resolved.error);
    const conversationId = resolved.value.id;
    logTurn(actor, "chat", "ad", { reply: { text: "ok" }, source: "plugin", plugin_id: "film", safety: SAFE, conversation_id: conversationId, turn_id: "turn-real34" });
    const a = storeFile(actor, { conversationId, turnId: "turn-real34", mediaType: "image/png", bytes: await png("#aa7733"), provenance: "composer:a.png", retention: "conversation", name: "a.png" });
    const b = storeFile(actor, { conversationId, turnId: "turn-real34", mediaType: "image/png", bytes: await png("#bb8844"), provenance: "composer:b.png", retention: "conversation", name: "b.png" });
    if (!a.ok || !b.ok) throw new Error("upload");
    __setRolesVisionForTests(async () => JSON.stringify({ role: "product", name: "coffee mug", look: "white ceramic mug" }));
    const result = await prepareFilmPictures(actor, { images: [{ id: a.value.id }, { id: b.value.id }], conversationId });
    if (!result.ok) throw new Error(result.line);
    expect(listMediaSubjects(actor).find((s) => s.name === "Coffee mug")!.reference_ids).toHaveLength(2);
  });
});
