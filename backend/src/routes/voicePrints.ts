import { Hono } from "hono";
import type { AppEnv } from "@/types";
import { requireAuth } from "@/middleware/auth";
import { decodeWav, encodeWav } from "@/lib/sttSession";
import { getStackClient } from "@/lib/stackEngine";
import { canEnrollVoiceSample, enrollVoiceSample, listBiometricPrints, deleteVoiceBiometricPrint, deleteVoicePrintsForPerson } from "@/lib/biometricPrints";

export const voicePrintsRoutes = new Hono<AppEnv>();
voicePrintsRoutes.use("*", requireAuth);

voicePrintsRoutes.get("/", (c) => {
  const personId = c.req.query("person_id") ?? "";
  const result = listBiometricPrints(c.get("person"), personId);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value.filter((print) => print.modality === "voice"), 200);
});

voicePrintsRoutes.post("/enroll", async (c) => {
  let form: FormData;
  try { form = await c.req.formData(); } catch { return c.json({ error: "A WAV voice sample is required" }, 400); }
  const personId = form.get("person_id");
  const audio = form.get("audio");
  if (typeof personId !== "string" || !(audio instanceof File)) return c.json({ error: "person_id and audio are required" }, 400);
  const consent = canEnrollVoiceSample(c.get("person"), personId);
  if (!consent.ok) return c.json({ error: consent.error }, consent.status);
  let decoded: { samples: Float32Array; sampleRate: number };
  try { decoded = decodeWav(new Uint8Array(await audio.arrayBuffer())); } catch { return c.json({ error: "Use a mono 16 kHz WAV voice sample" }, 400); }
  if (decoded.sampleRate !== 16_000 || decoded.samples.length < 16_000 || decoded.samples.length > 15 * 16_000) return c.json({ error: "Voice samples must be 1 to 15 seconds at 16 kHz" }, 400);
  try {
    const embedding = await getStackClient().speakerEmbedding(formDataWithAudio(decoded.samples)).then((reply) => {
      if (reply.data.model_id !== "nemo-titanet-small-v1" || reply.data.dim !== 192 || reply.data.embedding.length !== 192) throw new Error("unavailable");
      return reply.data.embedding;
    });
    const result = enrollVoiceSample(c.get("person"), personId, embedding);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.value, 201);
  } catch { return c.json({ error: "Voice matching is not available right now" }, 503); }
});

voicePrintsRoutes.delete("/:id", (c) => {
  const result = deleteVoiceBiometricPrint(c.get("person"), c.req.param("id"));
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});
voicePrintsRoutes.delete("/", (c) => {
  const personId = c.req.query("person_id") ?? "";
  const result = deleteVoicePrintsForPerson(c.get("person"), personId);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});

function formDataWithAudio(samples: Float32Array): FormData {
  // Enrollment input is already normalized by the browser card to WAV16k;
  // build the same canonical WAV bytes with the shared encoder.
  const form = new FormData();
  form.append("file", new File([encodeWav(samples, 16_000)], "sample.wav", { type: "audio/wav" }));
  return form;
}
