import { beforeEach, describe, expect, test } from "bun:test";
import { computeVoiceVerdict } from "@/lib/voiceMatch";
import { consumeVoiceMatchVerdict, clearVoiceMatchVerdictsForTests, setVoiceMatchVerdict } from "@/lib/voiceMatchVerdict";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, biometricPrints } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { encryptSecret } from "@/lib/secrets";
import { decryptVoicePrintEmbeddingsForPerson } from "@/lib/biometricPrints";

const speaker = { id: "speaker-1", role: "adult" };
const unit = Array.from({ length: 192 }, (_, i) => i === 0 ? 1 : 0);
const right = (embedding = unit, model_id = "nemo-titanet-small-v1", dim = 192) => ({ model_id, dim, embedding });
function deps(overrides: Partial<Parameters<typeof computeVoiceVerdict>[1]> = {}) {
  return { settingOn: () => true, loadPrints: () => [unit], embed: async () => right(), ...overrides };
}
const call = (d: Parameters<typeof computeVoiceVerdict>[1]) => computeVoiceVerdict({ person: speaker, clip: new Float32Array([0, 0.2]), sampleRate: 16_000 }, d);

beforeEach(() => { resetDb(); clearVoiceMatchVerdictsForTests(); });

describe("computeVoiceVerdict", () => {
  test("agrees for identical embeddings and disagrees for orthogonal ones", async () => {
    expect(await call(deps())).toBe("agree");
    expect(await call(deps({ embed: async () => right(Array.from({ length: 192 }, (_, i) => i === 1 ? 1 : 0)) }))).toBe("disagree");
  });
  test("honors the inclusive cosine threshold", async () => {
    const vectorAt = (cos: number) => [cos, Math.sqrt(1 - cos * cos), ...Array(190).fill(0)];
    expect(await call(deps({ embed: async () => right(vectorAt(0.55)) }))).toBe("agree");
    expect(await call(deps({ embed: async () => right(vectorAt(0.54)) }))).toBe("disagree");
  });
  test("errors, component-not-ready rejections, wrong model and wrong dimensions fail closed", async () => {
    expect(await call(deps({ embed: async () => { throw new Error("offline"); } }))).toBeNull();
    expect(await call(deps({ embed: async () => { throw new Error("component_not_ready"); } }))).toBeNull();
    expect(await call(deps({ embed: async () => right(unit, "wrong") }))).toBeNull();
    expect(await call(deps({ embed: async () => right(unit, "nemo-titanet-small-v1", 191) }))).toBeNull();
    expect(await call(deps({ embed: async () => right(unit.slice(0, 191)) }))).toBeNull();
  });
  test("setting off, empty prints, child and guest make no embed call", async () => {
    let embeds = 0;
    const embed = async () => { embeds++; return right(); };
    expect(await call(deps({ settingOn: () => false, embed }))).toBeNull();
    expect(await call(deps({ loadPrints: () => [], embed }))).toBeNull();
    for (const role of ["child", "guest"]) expect(await computeVoiceVerdict({ person: { ...speaker, role }, clip: new Float32Array(), sampleRate: 16_000 }, deps({ embed }))).toBeNull();
    expect(embeds).toBe(0);
  });
  test("loads once and only for the speaker, including with another person's DB print", async () => {
    const at = new Date().toISOString();
    for (const [id, name, vector] of [["speaker-db", "Speaker", unit], ["other-db", "Other", Array.from({ length: 192 }, (_, i) => i === 1 ? 1 : 0)]] as const) {
      db.insert(people).values({ id, displayName: name, role: "adult", avatarSeed: id, source: "hub", createdAt: at, updatedAt: at, hlc: nextHlc() }).run();
      db.insert(biometricPrints).values({ id: `print-${id}`, personId: id, modality: "voice", modelId: "nemo-titanet-small-v1", modelSha256: "a".repeat(64), dim: 192, embeddingEncrypted: encryptSecret(JSON.stringify(vector)), capturedBy: null, consentAt: at, consentedByPersonId: id, createdAt: at, updatedAt: at, deletedAt: null, hlc: nextHlc() }).run();
    }
    const seen: string[] = [];
    const result = await computeVoiceVerdict({ person: { id: "speaker-db", role: "adult" }, clip: new Float32Array([0]), sampleRate: 16_000 }, {
      settingOn: () => true,
      loadPrints: (id) => { seen.push(id); return decryptVoicePrintEmbeddingsForPerson(id); },
      embed: async () => right(),
    });
    expect(result).toBe("agree"); expect(seen).toEqual(["speaker-db"]);
    expect(decryptVoicePrintEmbeddingsForPerson("speaker-db")).toEqual([unit]);
  });
  test("a stalled embed is bounded by the verdict consumer's 500 ms wait", async () => {
    setVoiceMatchVerdict(`session:${speaker.id}`, call(deps({ embed: () => new Promise(() => {}) })));
    expect(await consumeVoiceMatchVerdict(`session:${speaker.id}`, 500)).toBeNull();
  });
});
