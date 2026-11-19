// The lab's own engines. It does not call the household's Stack: that one takes requests from Home only.
// Chat: a llama-server on LAB_LLM_URL. Voice: the mlx voice server on LAB_TTS_URL. Speech to text and the
// end-of-turn check run inside this process (Parakeet through sherpa-onnx, Smart Turn through onnxruntime-web).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { encodeWav } from "./wav";
import { smartTurnProbability, loadSmartTurn } from "./smartTurn";

const LLM = (Bun.env.LAB_LLM_URL ?? "http://127.0.0.1:9921").replace(/\/$/, "");
const TTS = (Bun.env.LAB_TTS_URL ?? "http://127.0.0.1:9922").replace(/\/$/, "");
const PARAKEET = Bun.env.LAB_PARAKEET ?? "/usr/local/maipai-home/stack/data/models/parakeet-tdt-0.6b-v2-int8/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";
const SMART_TURN = Bun.env.LAB_SMART_TURN ?? "/usr/local/maipai-home/stack/data/models/smart-turn-v3.2/smart-turn-v3.2-cpu.onnx";

export type ChatEvent = { type: "text"; text: string } | { type: "tool_calls"; calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> };
export async function* chat(messages: unknown[], signal: AbortSignal, temperature = config.temperature, tools?: unknown[]): AsyncGenerator<ChatEvent> {
  const r = await fetch(`${LLM}/v1/chat/completions`, { method: "POST", signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({ stream: true, cache_prompt: true, messages, max_tokens: 220, temperature, ...(tools ? { tools, tool_choice: "auto" } : {}) }) });
  if (!r.ok || !r.body) throw new Error(`chat ${r.status}`);
  const reader = r.body.getReader(), decoder = new TextDecoder(); let buf = "";
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  while (true) {
    const x = await reader.read(); if (x.done) break;
    buf += decoder.decode(x.value, { stream: true }); let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim(); if (data === "[DONE]") {
        if (calls.size) yield { type: "tool_calls", calls: [...calls.values()].map((call) => ({ id: call.id, name: call.name, arguments: JSON.parse(call.arguments || "{}") })) };
        return;
      }
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content) yield { type: "text", text: delta.content };
        for (const part of delta?.tool_calls ?? []) {
          const old = calls.get(part.index) ?? { id: "", name: "", arguments: "" };
          old.id += part.id ?? ""; old.name += part.function?.name ?? ""; old.arguments += part.function?.arguments ?? ""; calls.set(part.index, old);
        }
      } catch {}
    }
  }
}

/** 16-bit mono WAV bytes (any header length up to "data") to Float32 samples. */
function wavSamples(wav: Uint8Array): Float32Array {
  let off = 44;
  for (let i = 12; i + 8 <= Math.min(wav.length, 4096); ) {
    const id = String.fromCharCode(wav[i]!, wav[i + 1]!, wav[i + 2]!, wav[i + 3]!);
    const size = wav[i + 4]! | (wav[i + 5]! << 8) | (wav[i + 6]! << 16) | (wav[i + 7]! << 24);
    if (id === "data") { off = i + 8; break; }
    i += 8 + size + (size & 1);
  }
  const n = Math.floor((wav.length - off) / 2), out = new Float32Array(n), dv = new DataView(wav.buffer, wav.byteOffset + off, n * 2);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 32768;
  return out;
}

type Recognizer = { createStream(): any; decodeAsync(s: any): Promise<void>; getResult(s: any): { text: string } };
let recognizer: Recognizer | null = null;
let queue: Promise<unknown> = Promise.resolve();
function loadRecognizer(): Recognizer {
  if (recognizer) return recognizer;
  if (!existsSync(join(PARAKEET, "encoder.int8.onnx"))) throw new Error(`The speech recognizer files are missing at ${PARAKEET}. Set LAB_PARAKEET to the model folder.`);
  const sherpa = require("sherpa-onnx-node");
  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { transducer: { encoder: join(PARAKEET, "encoder.int8.onnx"), decoder: join(PARAKEET, "decoder.int8.onnx"), joiner: join(PARAKEET, "joiner.int8.onnx") },
      tokens: join(PARAKEET, "tokens.txt"), modelType: "nemo_transducer", numThreads: 4, provider: "cpu", debug: 0 },
  }) as Recognizer;
  return recognizer;
}

export async function transcribe(wav: Uint8Array, _signal?: AbortSignal): Promise<string> {
  const samples = wavSamples(wav); const rec = loadRecognizer();
  const run = queue.then(async () => { const s = rec.createStream(); s.acceptWaveform({ samples, sampleRate: 16000 }); await rec.decodeAsync(s); return rec.getResult(s).text.trim(); });
  queue = run.catch(() => {});
  return run;
}

export async function turnCheck(wav: Uint8Array, _signal?: AbortSignal): Promise<{ probability: number; complete: boolean }> {
  const all = wavSamples(wav); const window = 8 * 16000;
  // The model reads exactly the last 8 seconds; shorter audio is padded with silence at the front.
  const audio = new Float32Array(window);
  if (all.length >= window) audio.set(all.subarray(all.length - window)); else audio.set(all, window - all.length);
  const probability = await smartTurnProbability(SMART_TURN, audio);
  return { probability, complete: true };
}

export async function speech(text: string, signal?: AbortSignal): Promise<Response> {
  const f = new FormData(); f.append("text", text);
  const r = await fetch(`${TTS}/tts`, { method: "POST", body: f, signal });
  if (!r.ok || !r.body) throw new Error(`speech ${r.status}`);
  return r;
}

/** Loads the recognizer and the turn model before the first person speaks, so the first turn is not slow. */
export async function warm(): Promise<string[]> {
  const notes: string[] = [];
  try { await transcribe(encodeWav(new Float32Array(16000))); notes.push("recognizer ready"); } catch (e) { notes.push(`recognizer failed: ${(e as Error).message}`); }
  try { await loadSmartTurn(SMART_TURN); await turnCheck(encodeWav(new Float32Array(16000))); notes.push("turn model ready"); } catch (e) { notes.push(`turn model failed: ${(e as Error).message}`); }
  return notes;
}
export { encodeWav };
