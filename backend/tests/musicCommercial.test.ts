import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { createAttachment } from "@/lib/attachments";
import { commercialUseOf } from "@/lib/music/commercial";
import { MUSIC_NOTE, type GenerationProvenance } from "@/lib/music/types";
import { installFakeMusicStack, musicState, testM4a } from "./musicFixture";
let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); });
afterEach(() => fake.restore());
function chain() {
  const state = musicState(people.owner);
  const make = (over: Partial<GenerationProvenance> = {}) => {
    const record: GenerationProvenance = { kind: "music", job_id: "mus-testone", task: "text2music", model: { id: "acestep-v15-turbo", revision: "pin", licence: "MIT" }, engine: { id: "music-gen", version: "pin" }, seed: 1, duration_s: 60, bpm: null, key: null, parent_file_id: null, source_kind: "none", commercial_use: "cleared", commercial_basis: "MIT weights", made_at: new Date().toISOString(), ...over };
    const file = createAttachment(people.owner, { conversationId: state.conversationId, turnId: state.turnId, mediaType: "audio/mp4", bytes: testM4a(), deduplicate: false, provenance: MUSIC_NOTE + JSON.stringify(record) });
    if (!file.ok) throw new Error("no file"); return file.value.id;
  };
  return { make };
}
describe("commercial provenance chains fail closed", () => {
  test("a cleared original and a fully cleared made-here chain are cleared", () => {
    const { make } = chain(); const original = make(); const second = make({ parent_file_id: original, source_kind: "made_here" });
    const third = make({ parent_file_id: second, source_kind: "made_here" });
    expect(commercialUseOf(original)).toBe("cleared"); expect(commercialUseOf(third)).toBe("cleared");
  });
  test("a personal-only parent carries through a cleared child", () => {
    const { make } = chain(); const parent = make({ commercial_use: "personal_only" });
    expect(commercialUseOf(make({ parent_file_id: parent, source_kind: "made_here" }))).toBe("personal_only");
  });
  test("unknown licence, missing parent, unmarked source and a made-here link without a parent all read unknown", () => {
    const { make } = chain(); const parent = make({ commercial_use: "unknown" });
    for (const id of [make({ parent_file_id: parent, source_kind: "made_here" }), make({ parent_file_id: "file-missingone", source_kind: "made_here" }), make({ source_kind: "made_here" })]) expect(commercialUseOf(id)).toBe("unknown");
    const uploaded = make(); db.update(attachments).set({ provenance: "composer:upload" }).where(eq(attachments.id, uploaded)).run();
    expect(commercialUseOf(make({ parent_file_id: uploaded, source_kind: "made_here" }))).toBe("unknown");
    expect(commercialUseOf("file-missingone")).toBe("unknown");
  });
  test("a reserved upload source or a cycle cannot clear", () => {
    const { make } = chain();
    expect(commercialUseOf(make({ source_kind: "upload" as GenerationProvenance["source_kind"] }))).toBe("unknown");
    const id = make(); const row = db.select().from(attachments).where(eq(attachments.id, id)).get()!;
    const note = JSON.parse(row.provenance.slice(MUSIC_NOTE.length)) as GenerationProvenance;
    db.update(attachments).set({ provenance: MUSIC_NOTE + JSON.stringify({ ...note, parent_file_id: id, source_kind: "made_here" }) }).where(eq(attachments.id, id)).run();
    expect(commercialUseOf(id)).toBe("unknown");
  });
});
