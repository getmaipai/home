import { getSettingValueForPerson } from "@/lib/settings";
import { decryptVoicePrintEmbeddingsForPerson } from "@/lib/biometricPrints";
import { getStackClient } from "@/lib/stackEngine";
import { encodeWav } from "@/lib/sttSession";

type Person = { id: string; role: string };
type Verdict = "agree" | "disagree" | null;

export async function computeVoiceVerdict(
  input: { person: Person; clip: Float32Array; sampleRate: number },
  deps: {
    settingOn(personId: string): boolean;
    loadPrints(personId: string): readonly (readonly number[])[];
    embed(wav: Uint8Array): Promise<{ model_id: string; dim: number; embedding: number[] }>;
    threshold?: number;
  } = {
    settingOn: (personId) => getSettingValueForPerson(personId, "person.voice.match") === true,
    loadPrints: decryptVoicePrintEmbeddingsForPerson,
    embed: async (wav) => {
      const form = new FormData();
      form.append("file", new File([wav], "speech.wav", { type: "audio/wav" }));
      return (await getStackClient().speakerEmbedding(form, { timeoutMs: 10_000 })).data;
    },
  },
): Promise<Verdict> {
  if (input.person.role === "child" || input.person.role === "guest") return null;
  try {
    if (!deps.settingOn(input.person.id)) return null;
    const prints = deps.loadPrints(input.person.id);
    if (!prints.length) return null;
    const result = await deps.embed(encodeWav(input.clip, input.sampleRate));
    if (result.model_id !== "nemo-titanet-small-v1" || result.dim !== 192 || result.embedding.length !== 192) return null;
    const cosine = (a: readonly number[], b: readonly number[]) => {
      if (a.length !== b.length || !a.length) return -1;
      let dot = 0, aa = 0, bb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! * a[i]!; bb += b[i]! * b[i]!; }
      return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
    };
    return prints.some((sample) => cosine(result.embedding, sample) >= (deps.threshold ?? 0.55)) ? "agree" : "disagree";
  } catch { return null; }
}
