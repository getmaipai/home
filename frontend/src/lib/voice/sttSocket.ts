import type { SttServerMessageWithTiming } from "@/lib/voice/sttContract";

export interface SttSocketHandlers {
  onMessage: (message: SttServerMessageWithTiming) => void;
  /** A connection-level failure (never opened, or dropped mid-stream) -
   * distinct from a normal `close()` the caller itself requested. */
  onError?: (error: unknown) => void;
}

export interface SttSocket {
  /** A 16 kHz mono Float32 PCM frame (mic-capture.ts's own output shape),
   * sent as binary f32le per the contract - never JSON-wrapped, since
   * every audio frame at 16 kHz would make that a real overhead. */
  sendAudio: (frame: Float32Array) => void;
  /** Full-duplex: tells the server how much of the current reply has played, about every 250 ms while it plays (the server
   * treats a report under 700 ms old as "a reply is playing"). A no-op when the socket is not open. */
  sendPlayed?: (replyId: string, ms: number) => void;
  sendTiming?: (turnId: string, sttMs: number, firstPlaybackMs?: number, firstSentenceMs?: number) => void;
  close: () => void;
}

// The real socket to `WS /api/stt/stream`, built against the frozen contract (sttContract.ts).
export function createSttSocket(handlers: SttSocketHandlers): SttSocket {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${window.location.host}/api/stt/stream`);
  socket.binaryType = "arraybuffer";
  // Set by our own close() below, so the "close" listener (added for a
  // code review, 2026-09-06 - see its own comment) can tell a requested
  // shutdown apart from the server hanging up on its own.
  let closedByUs = false;

  // DICT-01: no client-to-server "hello" - the real contract
  // (SttWireEvent, sttContract.ts's own header) names no such message,
  // and the server starts a session and sends "ready" the moment the
  // socket opens (routes/stt.ts's onOpen), never waiting on one.
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return; // audio never flows server -> client
    try {
      handlers.onMessage(JSON.parse(event.data) as SttServerMessageWithTiming);
    } catch (e) {
      handlers.onError?.(e);
    }
  });
  socket.addEventListener("error", (e) => handlers.onError?.(e));
  // A clean server-side close (idle timeout, session cap, the normal
  // code 1000) fires no preceding "error" event at all - that's
  // spec-compliant, not abnormal, so without this listener the adapter
  // never learned the connection died: `sendAudio` would keep silently
  // no-op'ing forever and the UI would sit in "listening" with nothing
  // happening (a code review, 2026-09-06).
  socket.addEventListener("close", () => {
    if (!closedByUs) handlers.onError?.(new Error("stt socket closed unexpectedly"));
  });

  return {
    sendAudio(frame) {
      // `hello` may not have reached the server yet on the very first
      // frame or two (mic capture can start before the socket finishes
      // its handshake) - dropping a frame here is the right failure
      // mode (a lost few milliseconds of audio), never throwing and
      // tearing down the whole session over a startup race.
      if (socket.readyState !== WebSocket.OPEN) return;
      // `frame.buffer` alone would ship the WHOLE underlying
      // ArrayBuffer, not just this view's own range - correct only by
      // coincidence for mic-capture.ts's always-offset-0 frames, wrong
      // the moment any caller passes a subarray view (a code review,
      // 2026-09-06 - nothing in the type enforces offset 0).
      socket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
    },
    sendPlayed(replyId, ms) {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ t: "played_ms", reply_id: replyId, ms: Math.max(0, Math.round(ms)) }));
    },
    sendTiming(turnId, sttMs, firstPlaybackMs, firstSentenceMs) {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ t: "timing", turn_id: turnId, stt_ms: sttMs, ...(firstPlaybackMs === undefined ? {} : { first_playback_ms: firstPlaybackMs }), ...(firstSentenceMs === undefined ? {} : { first_sentence_ms: firstSentenceMs }) }));
    },
    close() {
      closedByUs = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    },
  };
}

export interface SttFixtureStep {
  /** Milliseconds after the PREVIOUS step (or after `hello`, for the
   * first) before this message is delivered - a mock socket that
   * replays instantly would never exercise a UI state (a "listening..."
   * spinner, say) that only shows up for a real socket's real latency. */
  delayMs: number;
  message: SttServerMessageWithTiming;
}

// Test helper: a socket that replays a fixture. Same shape as createSttSocket (sendAudio/close, one onMessage callback),
// so the code under test never knows which one it got. No production file calls it.
export function createMockSttSocket(fixture: readonly SttFixtureStep[], handlers: SttSocketHandlers): SttSocket {
  let closed = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  let elapsed = 0;
  for (const step of fixture) {
    elapsed += step.delayMs;
    timers.push(
      setTimeout(() => {
        if (!closed) handlers.onMessage(step.message);
      }, elapsed),
    );
  }

  return {
    // The fixture doesn't care what audio it "received" - a mock stands
    // in for the network hop, not for VAD/STT itself, which is real
    // server-side work this repo has nothing to run locally.
    sendAudio() {},
    close() {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
    },
  };
}
