import { describe, expect, test, mock, afterEach } from "bun:test";
import { createSttSocket, createMockSttSocket, type SttFixtureStep } from "@/lib/voice/sttSocket";
import type { SttServerMessage } from "@/lib/voice/sttContract";

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// happy-dom's real WebSocket tries an actual network connection, which
// this test environment has nothing to answer - a fake, constructible
// class the test drives by hand instead (readyState, and firing its own
// listeners), the same technique WakeWordToggle.test.tsx already uses
// for the Web Audio API happy-dom also lacks.
class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  binaryType = "";
  sent: unknown[] = [];
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  constructor(public url: string) {}
  addEventListener(type: string, cb: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.fire("close", {});
  }
  fire(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
}

let lastSocket: FakeWebSocket | undefined;
const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  lastSocket = undefined;
});

function installFakeWebSocket(): void {
  globalThis.WebSocket = class extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- capturing the just-constructed fake for the test to drive, not a real alias-of-convenience.
      lastSocket = this;
    }
  } as unknown as typeof WebSocket;
}

describe("createSttSocket", () => {
  test("sends a typed hello once open, then parses server messages", () => {
    installFakeWebSocket();
    const received: SttServerMessage[] = [];
    createSttSocket({ onMessage: (m) => received.push(m) });
    lastSocket!.readyState = FakeWebSocket.OPEN;
    lastSocket!.fire("open", {});
    expect(lastSocket!.sent).toEqual([JSON.stringify({ type: "hello", sample_rate: 16_000 })]);

    lastSocket!.fire("message", { data: JSON.stringify({ type: "vad", speaking: true }) });
    expect(received).toEqual([{ type: "vad", speaking: true }]);
  });

  test("sendAudio ships only the frame's own byteOffset/byteLength range, not the whole underlying buffer", () => {
    installFakeWebSocket();
    const socket = createSttSocket({ onMessage: () => {} });
    lastSocket!.readyState = FakeWebSocket.OPEN;
    // mic-capture.ts's own frames are always offset-0, but the type
    // accepts any Float32Array - a subarray view (byteOffset 4, length
    // 2 here) is the case a code review, 2026-09-06, found `frame.buffer`
    // alone getting wrong (it ships the WHOLE 4-element backing buffer).
    const frame = new Float32Array([10, 20, 30, 40]).subarray(1, 3);
    socket.sendAudio(frame);
    const sentBuffer = lastSocket!.sent[0] as ArrayBuffer;
    expect(new Float32Array(sentBuffer)).toEqual(new Float32Array([20, 30]));
  });

  test("a server-initiated close reports onError; our own close() does not", () => {
    installFakeWebSocket();
    const onError = mock(() => {});
    const socket = createSttSocket({ onMessage: () => {}, onError });
    lastSocket!.readyState = FakeWebSocket.OPEN;

    socket.close();
    expect(onError).not.toHaveBeenCalled();

    installFakeWebSocket();
    const onError2 = mock(() => {});
    createSttSocket({ onMessage: () => {}, onError: onError2 });
    lastSocket!.readyState = FakeWebSocket.OPEN;
    lastSocket!.fire("close", {}); // the server hung up, not us
    expect(onError2).toHaveBeenCalledTimes(1);
  });
});

describe("createMockSttSocket", () => {
  test("replays each fixture step's message after its own delay, in order", async () => {
    const received: SttServerMessage[] = [];
    const fixture: SttFixtureStep[] = [
      { delayMs: 1, message: { type: "ready" } },
      { delayMs: 1, message: { type: "partial", text: "turn the" } },
      { delayMs: 1, message: { type: "final", text: "turn the lights on" } },
    ];
    createMockSttSocket(fixture, { onMessage: (m) => received.push(m) });
    await waitFor(20);
    expect(received).toEqual([
      { type: "ready" },
      { type: "partial", text: "turn the" },
      { type: "final", text: "turn the lights on" },
    ]);
  });

  test("close() cancels every not-yet-delivered step", async () => {
    const received: SttServerMessage[] = [];
    const fixture: SttFixtureStep[] = [
      { delayMs: 1, message: { type: "ready" } },
      { delayMs: 50, message: { type: "final", text: "should never arrive" } },
    ];
    const socket = createMockSttSocket(fixture, { onMessage: (m) => received.push(m) });
    await waitFor(10);
    socket.close();
    await waitFor(60);
    expect(received).toEqual([{ type: "ready" }]);
  });

  test("sendAudio is a no-op - the mock stands in for the network, not for real STT", () => {
    const socket = createMockSttSocket([], { onMessage: () => {} });
    expect(() => socket.sendAudio(new Float32Array([0.1, 0.2]))).not.toThrow();
  });
});
