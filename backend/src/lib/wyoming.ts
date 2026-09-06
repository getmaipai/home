// Wyoming protocol wire framing (session-c-brain-and-voice.md step 8).
// Hand-written rather than the `wyoming` npm package: that package is
// real (ISC, AGPL-3.0-compatible) but a 0.1.0 "work in progress" per its
// own README, with no documented stable API surface to build a
// child-safety-adjacent, always-on TCP listener against - the plan's own
// fallback ("the small JSONL framing hand-written and tested") is the
// safer choice here, and the protocol itself is small enough to hand-roll
// correctly: a JSON header line, optionally followed by more JSON bytes
// merged into `data`, optionally followed by a raw binary payload.
//
// Deliberately pure and side-effect free (no socket, no I/O) - lib/
// wyomingServer.ts owns the actual TCP listener and per-connection state
// machine; this file is just "how one message is shaped on the wire,"
// testable without a real socket at all.
export interface WyomingMessage {
  type: string;
  data?: Record<string, unknown>;
  payload?: Uint8Array;
}

interface WyomingHeader {
  type: string;
  data?: Record<string, unknown>;
  data_length?: number;
  payload_length?: number;
}

/** Encodes one message: the header line (JSON + "\n"), then the raw
 * payload bytes if any. `data` always goes in the header line itself
 * (never the optional "additional data" section) - this implementation
 * never needs to split a huge data object across the header vs. a
 * separate data_length section the way the reference implementation's
 * own size-limited transports might; anything this hub sends fits in one
 * header line. */
export function encodeWyomingMessage(msg: WyomingMessage): Uint8Array {
  const header: WyomingHeader = { type: msg.type };
  if (msg.data) header.data = msg.data;
  if (msg.payload) header.payload_length = msg.payload.length;
  const headerLine = `${JSON.stringify(header)}\n`;
  const headerBytes = new TextEncoder().encode(headerLine);
  if (!msg.payload) return headerBytes;
  const out = new Uint8Array(headerBytes.length + msg.payload.length);
  out.set(headerBytes, 0);
  out.set(msg.payload, headerBytes.length);
  return out;
}

/** Incremental parser for one TCP connection's byte stream: feed it
 * whatever arrived (`push()`), drain zero or more complete messages
 * (`next()` returns null once the buffer has no complete message yet).
 * A real socket delivers bytes in arbitrary chunks with no relationship
 * to message boundaries, so this has to buffer across calls rather than
 * assume one push() is one message - the exact shape sttSession.ts's own
 * SileroVadStream buffers partial 512-sample chunks for, applied to
 * bytes instead of audio samples. */
export class WyomingFramer {
  private buffer: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
  }

  /** Returns the next complete message, or null if the buffer doesn't
   * hold one yet. Call repeatedly after each push() until it returns
   * null - a single push() can deliver several messages at once (e.g. a
   * batch of audio-chunk events), and this must drain all of them before
   * the caller waits for more bytes. */
  next(): WyomingMessage | null {
    const newlineIndex = this.buffer.indexOf(10); // '\n'
    if (newlineIndex === -1) return null;

    const headerText = new TextDecoder().decode(this.buffer.subarray(0, newlineIndex));
    let header: WyomingHeader;
    try {
      header = JSON.parse(headerText) as WyomingHeader;
    } catch {
      // A malformed header line is unrecoverable for this connection -
      // there's no way to know where the NEXT message starts once one
      // header fails to parse. The caller (wyomingServer.ts) closes the
      // connection on a thrown error rather than silently resyncing on
      // a byte offset that might not be a real message boundary at all.
      throw new Error("malformed Wyoming header line");
    }

    const dataLength = header.data_length ?? 0;
    const payloadLength = header.payload_length ?? 0;
    const totalNeeded = newlineIndex + 1 + dataLength + payloadLength;
    if (this.buffer.length < totalNeeded) return null; // not all bytes have arrived yet

    let data = header.data;
    let cursor = newlineIndex + 1;
    if (dataLength > 0) {
      const extra = JSON.parse(new TextDecoder().decode(this.buffer.subarray(cursor, cursor + dataLength))) as Record<string, unknown>;
      data = { ...data, ...extra };
      cursor += dataLength;
    }
    let payload: Uint8Array | undefined;
    if (payloadLength > 0) {
      payload = this.buffer.slice(cursor, cursor + payloadLength);
      cursor += payloadLength;
    }

    this.buffer = this.buffer.slice(cursor);
    return { type: header.type, data, payload };
  }
}

// ── A minimal WAV reader for the "synthesize" flow ──────────────────────
// TTS (lib/tts.ts) returns a WAV container (audio/wav); Wyoming's
// audio-chunk wants raw PCM bytes with rate/width/channels declared
// separately, no container. sttSession.ts's own decodeWav() exists but
// converts to a normalized Float32Array for VAD/ASR's own purposes - a
// real, unnecessary round trip here, where the WAV's own 16-bit PCM data
// bytes are exactly what audio-chunk wants verbatim. This reads just the
// header fields needed and returns the raw data slice untouched.
export interface WavPcm {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcm: Uint8Array;
}

export function readWavPcm(bytes: Uint8Array): WavPcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x52494646 /* "RIFF" */ || view.getUint32(8, false) !== 0x57415645 /* "WAVE" */) {
    throw new Error("not a WAV file");
  }
  // A standard 44-byte PCM WAV header (the exact shape encodeWav()
  // writes, and the shape a real TTS engine's own WAV output uses) -
  // walking chunk-by-chunk to handle an arbitrary chunk order/extra
  // chunks is real, unbuilt robustness this pass doesn't need for audio
  // this hub generated or fetched itself.
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataChunkSize = view.getUint32(40, true);
  const pcm = bytes.subarray(44, 44 + dataChunkSize);
  return { sampleRate, channels, bitsPerSample, pcm };
}
