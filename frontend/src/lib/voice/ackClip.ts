// TALK-OVER-01 (docs/design/talk-over-2026-11-12.md section 2 item 2): the acknowledgement clips. The pool comes from the hub's
// `ready.talk_over.clips` (one constant there, ACKNOWLEDGEMENT_CLIPS), is rendered once per session and voice through the same
// speech route the reply uses (so the hub resolves voice, engine and companion as for any sentence: rule 14), decoded, and kept in
// memory for the session. A clip plays from memory the moment the hub's edge partial reads as a finished sentence, through the shared
// playback context, and is cut with a hard stop (ANTI_CLICK_RAMP_MS) when the overlap window decides the person went on.
import { api } from "@/lib/api";
import { ANTI_CLICK_RAMP_MS } from "@/lib/sentenceSpeechScheduler";
import { sharedPlaybackContext } from "@/lib/voice/playbackContext";

/** Below the reply's level (section 2 item 2 supersedes 3b's 0.6 with 0.8): an acknowledgement, not an answer. */
export const ACK_CLIP_GAIN = 0.8;

export interface AckClipHandle {
  readonly durationMs: number;
  readonly startedAt: number;
  /** A hard stop: gain to zero in ANTI_CLICK_RAMP_MS, then the source stops. Resolves with the latency from the call to silence (ms). */
  stop(): number;
  /** True once the clip ended on its own or was stopped. */
  readonly ended: boolean;
}

export interface AckClipPool {
  /** How many clips are ready to play. */
  readonly size: number;
  /** Play one clip (never the same twice in a row). Null when none is ready or the context cannot play. */
  play(now?: number): AckClipHandle | null;
  /** Stop whatever plays. */
  stopAll(): void;
}

async function renderOne(text: string, voice: string | undefined, context: AudioContext, signal: AbortSignal): Promise<AudioBuffer> {
  const response = await api.streamSpeech(text, signal, voice ? { turnId: "", generation: 0, voice } : undefined);
  if (!response.ok || !response.body) throw new Error(`acknowledgement clip: speech ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A streamed WAV may carry no length in its header: fix both size fields to the real byte count before decoding.
  if (bytes.length >= 44) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645) { view.setUint32(4, bytes.length - 8, true); view.setUint32(40, bytes.length - 44, true); }
  }
  return context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** Render the pool in the given voice. Resolves when every clip that could be rendered is ready; a clip that fails is left out
 * (counts only, no text in the console). */
export async function renderAckClips(clips: readonly string[], voice: string | undefined, options: { context?: AudioContext; signal?: AbortSignal; now?: () => number } = {}): Promise<AckClipPool> {
  const context = options.context ?? sharedPlaybackContext();
  const now = options.now ?? (() => performance.now());
  const signal = options.signal ?? new AbortController().signal;
  const buffers: AudioBuffer[] = [];
  let failed = 0;
  for (const text of clips) {
    if (signal.aborted) break;
    try { buffers.push(await renderOne(text, voice, context, signal)); } catch { failed += 1; }
  }
  if (failed > 0) console.info(`[talk-over] acknowledgement clips ready=${buffers.length} failed=${failed}`);
  let last = -1;
  const playing = new Set<AckClipHandle>();
  return {
    get size() { return buffers.length; },
    play(at = now()) {
      if (buffers.length === 0) return null;
      let index = Math.floor(Math.random() * buffers.length);
      if (buffers.length > 1 && index === last) index = (index + 1) % buffers.length;
      last = index;
      const buffer = buffers[index]!;
      let source: AudioBufferSourceNode; let gain: GainNode;
      try {
        if (context.state === "suspended") void context.resume?.().catch(() => {});
        source = context.createBufferSource(); source.buffer = buffer;
        gain = context.createGain(); gain.gain.value = ACK_CLIP_GAIN;
        source.connect(gain); gain.connect(context.destination);
        source.start();
      } catch { return null; }
      const durationMs = Math.round(buffer.duration * 1000);
      const handle: AckClipHandle = {
        durationMs, startedAt: at, ended: false,
        stop() {
          if (handle.ended) return 0;
          (handle as { ended: boolean }).ended = true;
          const began = now();
          const cut = () => { try { source.stop(); } catch { /* already ended */ } try { source.disconnect(); gain.disconnect(); } catch { /* already disconnected */ } };
          const g = gain.gain;
          if (g.setValueAtTime && g.linearRampToValueAtTime && typeof context.currentTime === "number") {
            const t = context.currentTime;
            try { g.cancelScheduledValues?.(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + ANTI_CLICK_RAMP_MS / 1000); } catch { /* cut at once */ }
            setTimeout(cut, ANTI_CLICK_RAMP_MS);
          } else cut();
          playing.delete(handle);
          return Math.max(ANTI_CLICK_RAMP_MS, Math.round(now() - began + ANTI_CLICK_RAMP_MS));
        },
      };
      source.onended = () => { (handle as { ended: boolean }).ended = true; playing.delete(handle); try { source.disconnect(); gain.disconnect(); } catch { /* fine */ } };
      playing.add(handle);
      return handle;
    },
    stopAll() { for (const handle of [...playing]) handle.stop(); },
  };
}
