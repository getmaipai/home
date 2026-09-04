// The `tts` role port (platform plan 4.11), the same shape llm.ts's
// complete() already set for `chat`: validate, resolve a backend, turn a
// client failure into a typed result a route can translate straight into
// an HTTP response, instead of a thrown error a caller has to guess the
// right status code for.
import { getTtsClient } from "@/lib/ttsSupervisor";
import { TtsClientError } from "@maipai/spec/voice/ts/client.js";

// A very long chat reply synthesized in one call would tie up the one
// spawned Pocket TTS process for a long time - bounded generously above
// any real chat reply's length rather than tuned to a measured worst
// case, since nothing here has one yet.
const MAX_TEXT_LENGTH = 4_000;

export interface TtsSynthesizeValue {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
}

export type TtsOpResult =
  | { ok: true; value: TtsSynthesizeValue }
  | { ok: false; status: 400 | 503; code: "invalid_input" | "unavailable"; error: string };

export async function synthesizeSpeech(text: string): Promise<TtsOpResult> {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "text must be a non-empty string" };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, status: 400, code: "invalid_input", error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` };
  }

  let client;
  try {
    client = await getTtsClient();
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `voice unavailable: ${(err as Error).message}` };
  }

  try {
    const result = await client.synthesizeStream(text);
    return { ok: true, value: { stream: result.body, contentType: result.contentType } };
  } catch (err) {
    const message = err instanceof TtsClientError ? err.message : (err as Error).message;
    return { ok: false, status: 503, code: "unavailable", error: `voice unavailable: ${message}` };
  }
}
