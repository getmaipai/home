// VOICES-04: voices a member makes from a reference clip (the hub's /api/voice/cloned routes).
import { i18n } from "@lingui/core";
import { requestJson } from "@/lib/api";

export interface HouseholdVoice {
  id: string;
  label: string;
  creatorId: string;
  creatorName: string;
  bytes: number;
  createdAt: string;
  /** Sampling temperature (0.1 to 2.0); absent means the engine default. */
  temperature?: number;
  /** Pitch offset in semitones (-12 to 12); absent means no shift. */
  pitchSemitones?: number;
  /** Set only on an Inspired voice (AUDIO-PARITY-01 V5), with how far it was moved from the recording it is based on. */
  kind?: "inspired";
  inspiredLevel?: InspiredLevel;
}

export type InspiredLevel = "different" | "very_different";
export const inspiredLevelLabel = (level: InspiredLevel): string => level === "different" ? i18n._({ id: "Different", message: "Different" }) : i18n._({ id: "Very different", message: "Very different" });


export const householdVoicesApi = {
  list: () => requestJson<{ voices: HouseholdVoice[] }>("/api/voice/cloned"),
  /** `temperature` and `pitchSemitones` are sent only when given (a blank field means the default). */
  make: (input: { name: string; clip: File; temperature?: number; pitchSemitones?: number; inspiredLevel?: InspiredLevel }) => {
    const form = new FormData();
    form.append("label", input.name);
    form.append("file", input.clip);
    if (input.temperature !== undefined) form.append("temperature", String(input.temperature));
    if (input.pitchSemitones !== undefined) form.append("pitch_semitones", String(input.pitchSemitones));
    if (input.inspiredLevel !== undefined) form.append("inspired_level", input.inspiredLevel);
    return requestJson<HouseholdVoice>("/api/voice/cloned", { method: "POST", body: form });
  },
  rename: (id: string, label: string) => requestJson<HouseholdVoice>(`/api/voice/cloned/${encodeURIComponent(id)}/rename`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) }),
  remove: (id: string) => requestJson<{ success: true }>(`/api/voice/cloned/${encodeURIComponent(id)}/delete`, { method: "POST" }),
};
