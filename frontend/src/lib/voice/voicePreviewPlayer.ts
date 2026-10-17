import { api } from "@/lib/api";
import { StreamingWavPlayer } from "@/lib/streamingWavPlayer";

export interface VoicePreviewState { voiceId: string | null; busy: boolean; error: string | null }
type Listener = (state: VoicePreviewState) => void;
interface Player { onEnded?: () => void; addChunk(chunk: Uint8Array): void; finish(): void; stop(): void }
type PreviewRequest = (id: string, signal?: AbortSignal) => Promise<Response>;

/** One playback lane shared by every mounted browser section. */
export class VoicePreviewController {
  private state: VoicePreviewState = { voiceId: null, busy: false, error: null };
  private readonly listeners = new Set<Listener>();
  private player: Player | null = null;
  private abort: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private generation = 0;

  constructor(private readonly makePlayer: () => Player = () => new StreamingWavPlayer({ rate: false }), private readonly requestPreview: PreviewRequest = (id, signal) => api.previewVoice(id, signal)) {}

  getState = () => this.state;
  subscribe = (listener: Listener) => { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); };
  private update(state: VoicePreviewState) { this.state = state; for (const listener of this.listeners) listener(state); }

  stop() {
    this.generation++;
    this.abort?.abort(); this.abort = null;
    void this.reader?.cancel().catch(() => {}); this.reader = null;
    this.player?.stop(); this.player = null;
    this.update({ voiceId: null, busy: false, error: null });
  }

  async start(id: string, onResponse?: () => void) {
    this.stop();
    const generation = this.generation;
    const abort = new AbortController(); this.abort = abort;
    const player = this.makePlayer(); this.player = player;
    this.update({ voiceId: id, busy: true, error: null });
    player.onEnded = () => { if (this.generation === generation) this.stop(); };
    try {
      const response = await this.requestPreview(id, abort.signal);
      if (generation !== this.generation) return;
      onResponse?.();
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The voice preview had no audio.");
      this.reader = reader;
      this.update({ voiceId: id, busy: false, error: null });
      while (true) {
        const { done, value } = await reader.read();
        if (generation !== this.generation) return;
        if (done) break;
        player.addChunk(value);
      }
      player.finish();
    } catch (error) {
      if (generation !== this.generation) return;
      player.stop(); this.player = null; this.reader = null; this.abort = null;
      this.update({ voiceId: null, busy: false, error: error instanceof Error ? error.message : "Could not play this voice." });
    }
  }
}

export const voicePreviewPlayer = new VoicePreviewController();
