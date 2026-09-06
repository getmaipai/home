import type { SttHelloMessage, SttServerMessage } from "@/lib/voice/sttContract";

export interface SttSocketHandlers {
  onMessage: (message: SttServerMessage) => void;
  /** A connection-level failure (never opened, or dropped mid-stream) -
   * distinct from a normal `close()` the caller itself requested. */
  onError?: (error: unknown) => void;
}

export interface SttSocket {
  /** A 16 kHz mono Float32 PCM frame (mic-capture.ts's own output shape),
   * sent as binary f32le per the contract - never JSON-wrapped, since
   * every audio frame at 16 kHz would make that a real overhead. */
  sendAudio: (frame: Float32Array) => void;
  close: () => void;
}

// GET /api/stt/stream doesn't exist yet (C's own step, confirmed not
// started 2026-09-06) - built against the frozen contract
// (docs/plans/wave-2.md's "C to E: speech to text") so swapping this in
// once the route lands is just calling createSttSocket instead of
// createMockSttSocket at the one call site (sttDictationAdapter.ts).
// Untestable against a real server today; the mock below is what every
// test and any interactive use before C ships actually exercises.
export function createSttSocket(handlers: SttSocketHandlers): SttSocket {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${window.location.host}/api/stt/stream`);
  socket.binaryType = "arraybuffer";
  // Set by our own close() below, so the "close" listener (added for a
  // code review, 2026-09-06 - see its own comment) can tell a requested
  // shutdown apart from the server hanging up on its own.
  let closedByUs = false;

  socket.addEventListener("open", () => {
    const hello: SttHelloMessage = { type: "hello", sample_rate: 16_000 };
    socket.send(JSON.stringify(hello));
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return; // audio never flows server -> client
    try {
      handlers.onMessage(JSON.parse(event.data) as SttServerMessage);
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
  message: SttServerMessage;
}

// "Until C's route lands, a mock socket that replays a fixture"
// (session-e-ui-and-docs.md step 4's own words) - the first WebSocket
// consumer anywhere in this frontend, so there was no existing
// mock-socket pattern to match; this is deliberately the same shape as
// createSttSocket (sendAudio/close, one onMessage callback) so
// sttDictationAdapter.ts's own code never has to know which one it got.
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
