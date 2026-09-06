// Silero VAD v5 (neural voice-activity detection), ported near-verbatim
// from the archived legacy hub's lib/voice/sileroVad.ts (hard-won logic:
// exact model I/O shapes, state carry, WASM-under-Bun workaround) -
// repointed at this repo's own sttAssets.ts instead of legacy's
// download.ts, otherwise unchanged. Runs via onnxruntime-web under Bun
// for the same reason legacy's own comment gives: ort-node's native
// addon segfaults under Bun, while the WASM execution provider runs fine
// (one 32ms chunk is about 1ms on CPU) - verified again this session
// with a live smoke test before porting, not just trusted from the old
// comment.
//
// Model I/O (v5): input float32 [1, 576] = 64 context samples carried
// from the previous chunk, 512 new samples @ 16kHz; state float32
// [2,1,128] (RNN state, carried across chunks); sr int64 scalar. Outputs:
// output [1,1] speech probability, stateN [2,1,128].
// @ts-ignore - no resolvable .d.ts for the ort-web ESM bundle under Bun
import * as ort from "onnxruntime-web";
import type { InferenceSession } from "onnxruntime-web";
import { existsSync, readFileSync } from "node:fs";
import { sileroVadPath } from "@/lib/sttAssets";

const CHUNK = 512; // model chunk @ 16kHz (32ms)
const CONTEXT = 64; // samples the model wants carried over from the previous chunk

let ortInit = false;
function initOrt(): void {
  if (ortInit) return;
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "fatal";
  ortInit = true;
}

// One session process-wide (streams hold per-utterance state, the
// session is stateless). A missing model file is NOT cached as
// failure: a stream created after the background download completes
// picks it up without a restart. A corrupt/unloadable file IS sticky
// until process restart.
let sessionPromise: Promise<InferenceSession> | null = null;
let loadFailed = false;

export async function getSileroStream(): Promise<SileroVadStream | null> {
  if (loadFailed) return null;
  let p = sessionPromise;
  if (!p) {
    // A missing model is a real, expected state (fresh install, still
    // downloading) - sttSession.ts's own RMS fallback exists exactly
    // for this, matching legacy's "falls back... when the model isn't
    // installed yet" posture, not a startup requirement this throws on.
    if (!existsSync(sileroVadPath())) return null;
    initOrt();
    const created: Promise<InferenceSession> = ort.InferenceSession.create(new Uint8Array(readFileSync(sileroVadPath())), { executionProviders: ["wasm"] });
    p = created;
    sessionPromise = created;
  }
  try {
    return new SileroVadStream(await p);
  } catch (err) {
    loadFailed = true;
    console.warn(`[stt] silero vad failed to load (${(err as Error).message}) - falling back to RMS VAD`);
    return null;
  }
}

/** Test-only: clears the cached session so the next getSileroStream()
 * call re-resolves from scratch - the model path may point at a
 * different (or now-missing) file between test cases. */
export function __resetSileroVadForTests(): void {
  sessionPromise = null;
  loadFailed = false;
}

export class SileroVadStream {
  private session: InferenceSession;
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  private context = new Float32Array(CONTEXT);
  private state = new Float32Array(2 * 1 * 128);
  private chain: Promise<unknown> = Promise.resolve();
  private failedFlag = false;

  constructor(session: InferenceSession) {
    this.session = session;
  }

  /** True once inference has errored - permanent for this stream;
   * callers should drop to their energy-only fallback. */
  get failed(): boolean {
    return this.failedFlag;
  }

  /** Feed arbitrary-length 16kHz mono f32 samples. Resolves with the
   * probabilities of all 512-sample chunks completed by this call
   * (possibly empty - mic frames are typically smaller than one chunk,
   * so most calls just accumulate). Serialized internally so
   * overlapping calls can't interleave RNN state. Never rejects; on
   * inference error sets `failed` and returns what it has. */
  push(samples: Float32Array): Promise<number[]> {
    const result = this.chain.then(() => this.process(samples));
    this.chain = result.catch(() => {});
    return result;
  }

  /** Zero the RNN state, carried context, and pending buffer. Call when
   * a new logical audio stream starts. */
  reset(): void {
    this.pending = [];
    this.pendingLen = 0;
    this.context.fill(0);
    this.state.fill(0);
  }

  private async process(samples: Float32Array): Promise<number[]> {
    if (this.failedFlag) return [];
    this.pending.push(samples);
    this.pendingLen += samples.length;
    if (this.pendingLen < CHUNK) return [];

    const flat = new Float32Array(this.pendingLen);
    let off = 0;
    for (const part of this.pending) {
      flat.set(part, off);
      off += part.length;
    }

    const probs: number[] = [];
    let consumed = 0;
    try {
      while (this.pendingLen - consumed >= CHUNK) {
        probs.push(await this.runChunk(flat.subarray(consumed, consumed + CHUNK)));
        consumed += CHUNK;
      }
    } catch (err) {
      this.failedFlag = true;
      console.warn(`[stt] silero vad inference failed (${(err as Error).message}) - falling back to RMS VAD`);
      return probs;
    }
    const rest = flat.subarray(consumed);
    this.pending = rest.length ? [new Float32Array(rest)] : [];
    this.pendingLen = rest.length;
    return probs;
  }

  private async runChunk(chunk: Float32Array): Promise<number> {
    const input = new Float32Array(CONTEXT + CHUNK);
    input.set(this.context, 0);
    input.set(chunk, CONTEXT);
    const out = await this.session.run({
      input: new ort.Tensor("float32", input, [1, CONTEXT + CHUNK]),
      state: new ort.Tensor("float32", this.state, [2, 1, 128]),
      sr: new ort.Tensor("int64", BigInt64Array.from([16000n]), []),
    });
    this.state.set(out.stateN!.data as Float32Array);
    this.context.set(chunk.subarray(CHUNK - CONTEXT));
    return Number((out.output!.data as Float32Array)[0]);
  }
}
