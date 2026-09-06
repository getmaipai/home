// Real end-to-end proof, not just the framer's own unit tests: a real
// TCP socket, a real Bun.listen() server, real bytes exchanged - the
// acceptance bar session-c-brain-and-voice.md step 8 sets for when no
// real Home Assistant instance is reachable ("the scripted client is the
// acceptance").
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { startWyomingServer, type WyomingServerHandle } from "@/lib/wyomingServer";
import { WyomingFramer, encodeWyomingMessage, type WyomingMessage } from "@/lib/wyoming";
import { issueApiToken } from "@/lib/apiToken";
import { __setSttBackendForTests, __resetSttForTests } from "@/lib/stt";
import { __resetTtsSupervisorForTests } from "@/lib/ttsSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { PERSON_TURN_BUDGET } from "@/lib/llm";
import { sqlite } from "@/db";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";

let server: WyomingServerHandle;

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetSttForTests();
  __resetTtsSupervisorForTests();
  server?.stop();
});

function makePerson(): string {
  const id = newPersonId();
  const now = new Date().toISOString();
  sqlite
    .query(
      "INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Sprout', 'owner', ?, 'test', 0, ?, ?, ?)",
    )
    .run(id, randomSuffix(12), now, now, nextHlc());
  return id;
}

/** A minimal scripted Wyoming client over a real TCP socket: sends
 * messages, collects every response until the connection closes or a
 * deadline passes. */
class ScriptedWyomingClient {
  private framer = new WyomingFramer();
  private received: WyomingMessage[] = [];
  private socket!: Bun.Socket;
  private closed = false;

  async connect(port: number): Promise<void> {
    this.socket = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data: (_socket, chunk) => {
          this.framer.push(chunk);
          let msg = this.framer.next();
          while (msg) {
            this.received.push(msg);
            msg = this.framer.next();
          }
        },
        close: () => {
          this.closed = true;
        },
        error: () => {
          this.closed = true;
        },
      },
    });
  }

  send(msg: WyomingMessage): void {
    this.socket.write(encodeWyomingMessage(msg));
  }

  isClosed(): boolean {
    return this.closed;
  }

  /** Polls until at least `count` messages have arrived or `ms` elapses. */
  async waitForMessages(count: number, ms = 2000): Promise<WyomingMessage[]> {
    const deadline = Date.now() + ms;
    while (this.received.length < count && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.received;
  }

  async waitForClose(ms = 2000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (!this.closed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.closed;
  }

  end(): void {
    this.socket.end();
  }
}

describe("the Wyoming satellite server", () => {
  test("closes the connection outright if the first message isn't a valid authenticate", async () => {
    server = startWyomingServer(0);
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    client.send({ type: "describe" });
    expect(await client.waitForClose()).toBe(true);
  });

  test("closes the connection on a valid-shaped but wrong token", async () => {
    server = startWyomingServer(0);
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    client.send({ type: "authenticate", data: { token: "maipai_not-a-real-token" } });
    client.send({ type: "describe" });
    expect(await client.waitForClose()).toBe(true);
  });

  test("a real token authenticates, then describe/handle/transcribe all answer for real", async () => {
    const personId = makePerson();
    const token = issueApiToken(personId);

    __setSttBackendForTests(async (samples) => (samples.length > 0 ? "the scripted utterance" : ""));

    server = startWyomingServer(0);
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);

    client.send({ type: "authenticate", data: { token } });
    client.send({ type: "describe" });
    const [info] = await client.waitForMessages(1);
    expect(info!.type).toBe("info");
    expect((info!.data as { handle: unknown[] }).handle.length).toBeGreaterThan(0);

    // "handle" through the real turn engine: a client-sent transcript is
    // a request to answer it.
    client.send({ type: "transcript", data: { text: "good morning" } });
    const afterHandle = await client.waitForMessages(2);
    const handled = afterHandle[1]!;
    expect(handled.type).toBe("handled");
    expect((handled.data as { text: string }).text).toContain("good morning");

    // "transcribe" through step 5's real STT session, scripted to a
    // known reply via __setSttBackendForTests above - real audio framing
    // (audio-start/audio-chunk/audio-stop) exercised end to end over the
    // real socket, only the model call itself stubbed (no real speech
    // model installed in this test environment).
    client.send({ type: "audio-start", data: { rate: 16000, width: 2, channels: 1 } });
    client.send({ type: "audio-chunk", data: {}, payload: new Uint8Array(320) }); // 10ms of silence @16kHz/16-bit
    client.send({ type: "audio-stop", data: {} });
    const afterTranscribe = await client.waitForMessages(3);
    const transcript = afterTranscribe[2]!;
    expect(transcript.type).toBe("transcript");
    expect((transcript.data as { text: string }).text).toBe("the scripted utterance");

    client.end();
  });

  test("synthesize returns real framed audio-start/audio-chunk/audio-stop, decoded from the real (stub-backed) TTS WAV output", async () => {
    const personId = makePerson();
    const token = issueApiToken(personId);
    server = startWyomingServer(0);
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    client.send({ type: "authenticate", data: { token } });
    client.send({ type: "synthesize", data: { text: "hello there" } });

    const messages = await client.waitForMessages(3);
    expect(messages[0]!.type).toBe("audio-start");
    const start = messages[0]!.data as { rate: number; width: number; channels: number };
    expect(start.rate).toBeGreaterThan(0);
    expect(start.width).toBeGreaterThan(0);
    const chunkMessages = messages.slice(1, -1);
    expect(chunkMessages.length).toBeGreaterThan(0);
    for (const chunk of chunkMessages) {
      expect(chunk.type).toBe("audio-chunk");
      expect(chunk.payload).toBeDefined();
      expect(chunk.payload!.length).toBeGreaterThan(0);
    }
    expect(messages.at(-1)!.type).toBe("audio-stop");
    client.end();
  });

  test("an unrecognized message type is ignored, not treated as a protocol error", async () => {
    const personId = makePerson();
    const token = issueApiToken(personId);
    server = startWyomingServer(0);
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    client.send({ type: "authenticate", data: { token } });
    client.send({ type: "some-future-event-type-this-server-does-not-know", data: {} });
    client.send({ type: "describe" });
    const messages = await client.waitForMessages(1);
    expect(messages[0]!.type).toBe("info");
    expect(client.isClosed()).toBe(false);
    client.end();
  });

  test("closes a connection that never authenticates within the handshake timeout", async () => {
    server = startWyomingServer(0, { handshakeTimeoutMs: 50 });
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    // Sends nothing at all - the timeout, not a rejected message, has to
    // be what closes this connection.
    expect(await client.waitForClose(2000)).toBe(true);
  });

  test("a real token still works once authenticated before the handshake timeout fires", async () => {
    const personId = makePerson();
    const token = issueApiToken(personId);
    server = startWyomingServer(0, { handshakeTimeoutMs: 50 });
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    client.send({ type: "authenticate", data: { token } });
    // Long past the 50ms handshake timeout - proves authenticating clears
    // it rather than the connection getting cut out from under a slow
    // but legitimate client.
    await new Promise((r) => setTimeout(r, 200));
    client.send({ type: "describe" });
    const messages = await client.waitForMessages(1);
    expect(messages[0]!.type).toBe("info");
    expect(client.isClosed()).toBe(false);
    client.end();
  });

  test("audio-stop rejects a declared format this server can't decode, instead of silently mis-decoding it", async () => {
    const personId = makePerson();
    const token = issueApiToken(personId);
    __setSttBackendForTests(async () => "should never be called");
    server = startWyomingServer(0);
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    client.send({ type: "authenticate", data: { token } });
    // A satellite honestly declaring 8-bit stereo audio - this server
    // only knows how to decode 16-bit mono.
    client.send({ type: "audio-start", data: { rate: 16000, width: 1, channels: 2 } });
    client.send({ type: "audio-chunk", data: {}, payload: new Uint8Array(320) });
    client.send({ type: "audio-stop", data: {} });
    const [reply] = await client.waitForMessages(1);
    expect(reply!.type).toBe("error");
    expect((reply!.data as { text: string }).text).toContain("unsupported audio format");
    client.end();
  });

  test("the transcript/handle path shares the same per-person turn rate limit as every other turn-engine entry point", async () => {
    const personId = makePerson();
    const token = issueApiToken(personId);
    server = startWyomingServer(0);
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    client.send({ type: "authenticate", data: { token } });

    for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) {
      client.send({ type: "transcript", data: { text: `turn ${i}` } });
    }
    const handled = await client.waitForMessages(PERSON_TURN_BUDGET.capacity);
    expect(handled.every((m) => m.type === "handled")).toBe(true);

    client.send({ type: "transcript", data: { text: "one too many" } });
    const all = await client.waitForMessages(PERSON_TURN_BUDGET.capacity + 1);
    expect(all[PERSON_TURN_BUDGET.capacity]!.type).toBe("not-handled");
    client.end();
  });

  test("messages from back-to-back data events are handled strictly in order, never interleaved", async () => {
    const personId = makePerson();
    const token = issueApiToken(personId);
    // A deliberately slow STT backend, scripted to resolve well after the
    // second request below has definitely landed as its own separate
    // socket `data` event (a plain setTimeout gap between the two sends
    // is enough for that on loopback). Before message processing was
    // serialized per connection, each `data` event spawned its own
    // independent async run, so this "describe" - synchronous, no
    // await - could answer while the slow transcribe call was still
    // in flight, arriving out of order on the wire.
    __setSttBackendForTests(async (samples) => {
      await new Promise((r) => setTimeout(r, 300));
      return samples.length > 0 ? "slow transcript" : "";
    });
    server = startWyomingServer(0);
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    client.send({ type: "authenticate", data: { token } });

    client.send({ type: "audio-start", data: { rate: 16000, width: 2, channels: 1 } });
    client.send({ type: "audio-chunk", data: {}, payload: new Uint8Array(320) });
    client.send({ type: "audio-stop", data: {} });
    await new Promise((r) => setTimeout(r, 20));
    client.send({ type: "describe" });

    const messages = await client.waitForMessages(2, 3000);
    expect(messages[0]!.type).toBe("transcript");
    expect(messages[1]!.type).toBe("info");
    client.end();
  });
});
