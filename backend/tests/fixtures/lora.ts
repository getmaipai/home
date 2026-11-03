// VIDEO-LORA-03: a valid `Lora` record for tests, with the unusual strings the leak tests look for.
import { saveLora, type Lora } from "@/lib/loras/store";

export const SECRET_NAME = "Zebraquill Cabaret Lace";
export const SECRET_TRIGGER = "zqlacewear";
export const SECRET_ADDIN = "velvet cabaret pose";
export const SECRET_SHA = "c".repeat(64);
export const SECRET_PREVIEW = "file-zqpreview01";
export const SECRET_STRINGS = [SECRET_NAME, SECRET_TRIGGER, SECRET_ADDIN, SECRET_SHA, SECRET_PREVIEW, "Zebraquill", "zqlacewear"] as const;

let counter = 0;
export function loraRecord(by: string, over: Partial<Lora> = {}): Lora {
  counter += 1;
  const n = String(counter).padStart(6, "0");
  const base: Lora = {
    id: `lora-t${n}aaaaaa`, name: `Style ${n}`, kind: "style", description: "A plain style.", media: "video",
    source: { site: "file", url: null, remote_id: null, version_id: null, token_ref: null },
    file: { sha256: n.padStart(64, "a"), bytes: 1000, rank: 16, modules: [], format: "safetensors" },
    base_model: "wan2.2-ti2v-5b", compatible_with: ["wan2.2-ti2v-5b"], trigger_words: [], trigger_position: "start",
    positive_addins: [], negative_addins: [], avoid_as_positive: [], strength: { default: 1, min: 0, max: 1.5 },
    audience: "all-ages", audience_set_by: by, audience_set_at: "2026-11-02T00:00:00.000Z",
    availability: { who: "admins", people: [] }, added_by: by, added_at: "2026-11-02T00:00:00.000Z",
    licence: { id: "Apache-2.0", text: null, commercial_use: "yes", acknowledged_by: by, acknowledged_at: "2026-11-02T00:00:00.000Z" },
    preview: null, removed_at: null, trash_until: null, last_check: null, provenance: { origin: "file", job_id: null },
    created_at: "2026-11-02T00:00:00.000Z", updated_at: "2026-11-02T00:00:00.000Z", hlc: "0:0:testaa",
  };
  return { ...base, ...over };
}

/** Save one into the store as `by`. */
export function putLora(by: string, over: Partial<Lora> = {}): Lora {
  return saveLora(loraRecord(by, over), by);
}

/** An adult-only record carrying the strings that must never appear while it is locked. */
export function secretLora(by: string, over: Partial<Lora> = {}): Lora {
  return putLora(by, {
    name: SECRET_NAME, trigger_words: [SECRET_TRIGGER], positive_addins: [SECRET_ADDIN], preview: { file_id: SECRET_PREVIEW },
    file: { sha256: SECRET_SHA, bytes: 1000, rank: 16, modules: [], format: "safetensors" }, audience: "adult-only", audience_set_by: null, audience_set_at: null,
    availability: { who: "adults", people: [] }, ...over,
  });
}
