// Real chunked playback for the tts role: decodes and schedules each PCM
// chunk as it streams in from POST /api/tts, instead of waiting for the
// whole reply to finish generating before any sound plays (Jesse,
// 2026-09-04: "make sure you are streaming responses as you get [them]
// instead of generating the entire wav and then just playing that" - the
// same real technique Pocket TTS's own demo page uses, confirmed live
// against the real server the same night: spec/voice/README.md).
//
// Deliberately never trusts the WAV header's declared data-chunk size:
// Pocket TTS's real /tts response ships a bogus ~2,000,000,000-byte
// placeholder there (spec/voice/README.md), written for exactly this
// kind of streaming consumer. Only sampleRate/numChannels/bitsPerSample
// come from the 44-byte header; playback simply ends when the stream
// itself ends (finish()).

const HEADER_BYTES = 44;
// Small enough that the first chunk of real speech starts playing almost
// immediately (the whole point of streaming), large enough to avoid
// scheduling hundreds of tiny AudioBufferSourceNodes for one reply.
const MIN_BUFFER_BYTES = 4_096;

export class StreamingWavPlayer {
  private readonly audioContext: AudioContext;
  private sampleRate = 0;
  private numChannels = 0;
  private bitsPerSample = 0;
  private headerParsed = false;
  private readonly headerBuffer = new Uint8Array(HEADER_BYTES);
  private headerBytesReceived = 0;
  private pcmData = new Uint8Array(0);
  private nextStartTime = 0;
  private scheduledCount = 0;
  private finishedCount = 0;
  private streamDone = false;
  private stopped = false;

  /** Fires once, the moment the first chunk is actually scheduled to
   * play - the real "time to first audio" signal, not just "the fetch
   * started" (exactly what Jesse asked to be able to measure: "I want to
   * see how quickly the llm and voice response come"). */
  onFirstAudio?: () => void;
  /** Fires once every scheduled chunk has finished playing AND the
   * source stream itself has ended (finish() was called) - the real
   * end-to-end signal a single <audio>'s `ended` event gave for free,
   * rebuilt here since there is no one element to listen to any more. */
  onEnded?: () => void;

  constructor() {
    // Created synchronously by the caller, in the same click handler
    // that triggered playback, never after an awaited fetch: an
    // AudioContext only counts as unlocked by a real user gesture if it
    // is created before that call stack returns. Waiting on the network
    // round trip first (an earlier, <audio>-element version of this
    // feature did exactly that) risks the browser no longer treating
    // playback as gesture-initiated by the time audio is ready -
    // WebKit/Safari enforce this strictly (a code review, 2026-09-04,
    // flagged the risk in the previous version).
    this.audioContext = new AudioContext({ latencyHint: "interactive" });
  }

  private parseWavHeader(header: Uint8Array): void {
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    this.numChannels = view.getUint16(22, true);
    this.sampleRate = view.getUint32(24, true);
    this.bitsPerSample = view.getUint16(34, true);
  }

  private appendPcmData(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.pcmData.length + chunk.length);
    merged.set(this.pcmData);
    merged.set(chunk, this.pcmData.length);
    this.pcmData = merged;
  }

  /** Schedules whatever whole samples are currently buffered.
   * `force: true` (finish()) flushes a final partial buffer that would
   * otherwise sit below MIN_BUFFER_BYTES forever. Only 16-bit PCM is
   * handled: Pocket TTS's real response is always 16-bit (confirmed
   * live), and there is no other producer yet to support. */
  private scheduleBuffered(force: boolean): void {
    if (this.stopped || !this.headerParsed || this.bitsPerSample !== 16 || this.numChannels < 1) return;
    if (!force && this.pcmData.length < MIN_BUFFER_BYTES) return;

    const bytesPerFrame = this.numChannels * 2;
    const samplesToPlay = Math.floor(this.pcmData.length / bytesPerFrame);
    if (samplesToPlay === 0) return;
    const bytesToPlay = samplesToPlay * bytesPerFrame;
    const dataToPlay = this.pcmData.slice(0, bytesToPlay);
    this.pcmData = this.pcmData.slice(bytesToPlay);

    const audioBuffer = this.audioContext.createBuffer(this.numChannels, samplesToPlay, this.sampleRate);
    const int16 = new Int16Array(dataToPlay.buffer, dataToPlay.byteOffset, samplesToPlay * this.numChannels);
    for (let channel = 0; channel < this.numChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let i = 0; i < samplesToPlay; i++) {
        channelData[i] = int16[i * this.numChannels + channel]! / 32768;
      }
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    const startTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
    source.start(startTime);
    this.scheduledCount++;
    if (this.scheduledCount === 1) this.onFirstAudio?.();
    source.onended = () => {
      this.finishedCount++;
      if (this.streamDone && this.finishedCount === this.scheduledCount) this.onEnded?.();
    };
    this.nextStartTime = startTime + audioBuffer.duration;
  }

  /** Feed one chunk from the response body's reader, in order, as it
   * arrives. Safe to call after stop() (a no-op) so a caller's read loop
   * doesn't need its own extra guard on every iteration. */
  addChunk(chunk: Uint8Array): void {
    if (this.stopped) return;
    if (!this.headerParsed) {
      const needed = HEADER_BYTES - this.headerBytesReceived;
      const take = Math.min(needed, chunk.length);
      this.headerBuffer.set(chunk.slice(0, take), this.headerBytesReceived);
      this.headerBytesReceived += take;
      if (this.headerBytesReceived >= HEADER_BYTES) {
        this.parseWavHeader(this.headerBuffer);
        this.headerParsed = true;
        if (chunk.length > take) this.appendPcmData(chunk.slice(take));
      }
    } else {
      this.appendPcmData(chunk);
    }
    this.scheduleBuffered(false);
  }

  /** Call once the source stream reader reports done: flushes any
   * partial final buffer and lets onEnded fire once every scheduled
   * chunk finishes playing (or immediately, if nothing was ever big
   * enough to schedule - an empty or near-silent reply). */
  finish(): void {
    if (this.stopped) return;
    this.streamDone = true;
    this.scheduleBuffered(true);
    if (this.scheduledCount === 0) this.onEnded?.();
  }

  /** Immediate stop: cuts every currently-scheduled chunk right away,
   * the real mechanism a future barge-in feature needs (Jesse,
   * 2026-09-04: "old project didn't allow for barge in... because of no
   * gaps" - per-chunk scheduling is exactly the gap a single monolithic
   * <audio> element never had). Also what a newer "Listen" click uses to
   * cut off whatever the previous one was still playing, replacing the
   * request-token-only guard an earlier, <audio>-element version of this
   * feature relied on. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.audioContext.close().catch(() => {});
  }
}
