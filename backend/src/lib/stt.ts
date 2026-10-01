// Home sends complete utterances to the configured Stack for speech to
// text. Home keeps only the small Silero model for cutting live audio
// into utterances until the Stack provides a streaming transcription
// session.
import { encodeWav } from "@/lib/sttSession";
import { getStackClient, resolveStackOffline, reportStackFailure } from "@/lib/stackEngine";

async function transcribeViaStack(samples: Float32Array, sampleRate: number): Promise<string> {
  const wav = encodeWav(samples, sampleRate);
  const form = new FormData();
  form.append("file", new File([wav], "utterance.wav", { type: "audio/wav" }));
  form.append("model", "stt");
  try {
    const result = await getStackClient().transcribe(form);
    resolveStackOffline("stt");
    return result.data.text;
  } catch (err) {
    reportStackFailure(err, "stt");
    throw err;
  }
}

export function transcribeUtterance(samples: Float32Array, sampleRate: number): Promise<string> {
  return transcribeViaStack(samples, sampleRate);
}
