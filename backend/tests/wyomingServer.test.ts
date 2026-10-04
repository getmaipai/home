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
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { PERSON_TURN_BUDGET } from "@/lib/llm";
import { sqlite } from "@/db";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, IDENTITY_HEADERS, type StackFixture } from "./stackFixture";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { createConversation, listTemporaryConversations } from "@/lib/conversationHistory";
import { eq } from "drizzle-orm";

let server: WyomingServerHandle;
let speechStack: StackFixture | undefined;

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  server?.stop();
  speechStack?.stop();
  speechStack = undefined;
});

function makePerson(role = "owner", name = "Sprout"): string {
  const id = newPersonId();
  const now = new Date().toISOString();
  sqlite
    .query(
      "INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, 'test', 0, ?, ?, ?)",
    )
    .run(id, name, role, randomSuffix(12), now, now, nextHlc());
  return id;
}

// The default path asks the Stack for the chat role's health before it
// takes a turn (turnNext.ts's beginTurn); a fixture that answers chat
// completions must answer that too.
const READY_ROLES: Record<string, () => Response> = {
  "GET /stack/v1/roles": () => Response.json({ roles: ["chat", "embed", "judge", "stt", "tts"].map((id) => ({ id, state: { state: "ready", since: "test" }, reason: null })) }),
  "GET /stack/v1/health": () => Response.json({ health: [] }),
};

/** A scripted chat completion: the default path asks the engine to
 * stream, so a streaming request gets the reply as SSE. */
async function scriptedChat(req: Request, content: string): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { stream?: boolean };
  if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content } }] }, { headers: IDENTITY_HEADERS });
  const sse = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
  return new Response(sse, { headers: { ...IDENTITY_HEADERS, "content-type": "text/event-stream" } });
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

    speechStack = startStackFixture({
      ...READY_ROLES,
      "POST /v1/audio/transcriptions": async () => Response.json({ text: "the scripted utterance" }, { headers: IDENTITY_HEADERS }),
      "POST /v1/chat/completions": (req) => scriptedChat(req, "Good morning."),
    });
    setHouseholdSettingValue("engines.stack.url", speechStack.url);
    __setStackClientForTests(speechStack.client);

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
    expect((handled.data as { text: string }).text).toBe("Good morning.");

    // "transcribe" through step 5's real STT session, scripted to a
    // known reply via a real Stack fixture - real audio framing
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

  test("synthesize returns Stack audio as framed audio-start/audio-chunk/audio-stop", async () => {
    const personId = makePerson();
    const token = issueApiToken(personId);
    const pcm = new Uint8Array(320);
    const wav = new Uint8Array(44 + pcm.length);
    const view = new DataView(wav.buffer);
    view.setUint32(0, 0x52494646, false); view.setUint32(4, wav.length - 8, true);
    view.setUint32(8, 0x57415645, false); view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false); view.setUint32(40, pcm.length, true); wav.set(pcm, 44);
    speechStack = startStackFixture({
      "POST /v1/audio/speech": async () => new Response(wav, { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } }),
    });
    setHouseholdSettingValue("engines.stack.url", speechStack.url);
    __setStackClientForTests(speechStack.client);
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

  // THIN-INC row 6: a satellite transcript names no conversation and carries no temporary flag, so
  // it can neither write into a person's Incognito chat nor make one.
  test("a transcript leaves the person's temporary chat and the Incognito list as they were", async () => {
    const personId = makePerson();
    const token = issueApiToken(personId);
    const actor = db.select().from(people).where(eq(people.id, personId)).get()!;
    const created = createConversation(actor, { surface: "chat", mode: "temporary" });
    if (!created.ok) throw new Error(created.error);
    speechStack = startStackFixture({
      ...READY_ROLES,
      "POST /v1/chat/completions": (req) => scriptedChat(req, "Good morning."),
    });
    setHouseholdSettingValue("engines.stack.url", speechStack.url);
    __setStackClientForTests(speechStack.client);
    server = startWyomingServer(0);
    const client = new ScriptedWyomingClient();
    await client.connect(server.port);
    client.send({ type: "authenticate", data: { token } });
    client.send({ type: "transcript", data: { text: "good morning", temporary: true, conversation_id: created.value.id } });
    const [handled] = await client.waitForMessages(1);
    expect(handled!.type).toBe("handled");
    const listed = listTemporaryConversations(actor);
    expect(listed.map((c) => [c.id, c.turn_count])).toEqual([[created.value.id, 0]]);
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
    speechStack = startStackFixture({ "POST /v1/audio/transcriptions": async () => Response.json({ text: "should never be called" }) });
    setHouseholdSettingValue("engines.stack.url", speechStack.url);
    __setStackClientForTests(speechStack.client);
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
    speechStack = startStackFixture({ ...READY_ROLES, "POST /v1/chat/completions": (req) => scriptedChat(req, "handled") });
    setHouseholdSettingValue("engines.stack.url", speechStack.url);
    __setStackClientForTests(speechStack.client);
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
    speechStack = startStackFixture({ "POST /v1/audio/transcriptions": async () => {
      await new Promise((r) => setTimeout(r, 300));
      return Response.json({ text: "slow transcript" }, { headers: IDENTITY_HEADERS });
    } });
    setHouseholdSettingValue("engines.stack.url", speechStack.url);
    __setStackClientForTests(speechStack.client);
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

  // The real incident (2026-09-06): `bun run --hot` re-runs index.ts's
  // boot call on every backend file change without ever releasing the
  // previous reload's listener, so every reload after the first hit an
  // uncaught EADDRINUSE right in the middle of boot. A unit test can't
  // literally trigger a `bun --hot` module reload, but the fix's actual
  // mechanism (wyomingServer.ts's `hotReloadBoundPorts`, a `globalThis`
  // set that survives a reload the way a module-level `let` can't) cares
  // only about "did THIS process already bind this exact port," which a
  // same-process double call exercises identically - a hot-reloaded
  // module instance hitting Bun.listen() on that port throws the exact
  // same EADDRINUSE Bun.listen() throws here.
  test("binding a port this process already bound (a hot reload) does not throw, and the original listener keeps serving", async () => {
    server = startWyomingServer(0);
    const port = server.port;

    const second = startWyomingServer(port);
    expect(second.port).toBe(port);
    second.stop();

    // The original listener - not silently replaced or broken - is still
    // the one answering: same auth-first rule as every other test here.
    const client = new ScriptedWyomingClient();
    await client.connect(port);
    client.send({ type: "describe" });
    expect(await client.waitForClose()).toBe(true);
  });

  // The other half of that fix (a code review, 2026-09-06, caught the
  // first cut missing this): a port EADDRINUSE for a reason that has
  // nothing to do with a hot reload - a stale process, a second hub
  // instance, anything genuinely squatting on it - must still throw.
  // Silently treating every EADDRINUSE as "just a reload" would turn a
  // real production collision into a fake "listening" log line with zero
  // connections ever actually served.
  test("binding a port a stranger process holds (never bound by this process) still throws", async () => {
    const stranger = Bun.listen({
      hostname: "0.0.0.0",
      port: 0,
      socket: { open() {}, data() {}, close() {}, error() {} },
    });
    try {
      let threw: unknown;
      try {
        startWyomingServer(stranger.port);
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeInstanceOf(Error);
      expect((threw as { code?: unknown }).code).toBe("EADDRINUSE");
    } finally {
      stranger.stop(true);
    }
  });

  // A non-EADDRINUSE failure (a bad port, a permission error, anything
  // else) must keep throwing unconditionally too - only the exact
  // EADDRINUSE-on-a-port-we-already-own case is ever swallowed.
  test("a non-EADDRINUSE bind failure still throws", () => {
    expect(() => startWyomingServer(999_999)).toThrow(/range/i);
  });
  // THIN-7A (rules 9 and 12): a satellite's turn is the robot's turn, a
  // spoken turn on the one path. The scripted engine is the stub LLM the
  // turnMachine suite uses; the stored row's trace nodes exist only on the
  // default path, so they prove which path ran.
  describe("THIN-7A: a satellite turn runs spoken on the default path", () => {
    async function handleAs(personId: string, utterance: string, reply: string, reasoning?: string): Promise<{ handled: WyomingMessage; turnRow: { replyText: string; stats: unknown } | undefined }> {
      __resetLlmSupervisorForTests();
      const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
      const stub = startStubLlmServer(0, { scriptedChatReply: () => reply, ...(reasoning ? { scriptedReasoning: () => reasoning } : {}) });
      process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
      try {
        server = startWyomingServer(0);
        const client = new ScriptedWyomingClient();
        await client.connect(server.port);
        client.send({ type: "authenticate", data: { token: issueApiToken(personId) } });
        client.send({ type: "transcript", data: { text: utterance } });
        const [handled] = await client.waitForMessages(1, 5000);
        const turnRow = db.select().from(conversationTurns).get();
        return { handled: handled!, turnRow: turnRow as { replyText: string; stats: unknown } | undefined };
      } finally {
        await stub.stop();
        delete process.env.MAIPAI_LLAMA_SERVER_URL;
      }
    }

    test("the handled text is the server's speech text, and the stored reply is the written text", async () => {
      const written = "It is 72°F at 10:04 am, Dr. Smith said.";
      const { handled, turnRow } = await handleAs(makePerson(), "how do I make a paper airplane", written);
      expect(handled.type).toBe("handled");
      expect((handled.data as { text: string }).text).toBe("It is seventy-two degrees Fahrenheit at ten oh four in the morning, Doctor Smith said.");
      expect(turnRow?.replyText).toBe(written);
      const nodes = (JSON.parse(turnRow!.stats as string) as { nodes?: { node: string }[] }).nodes ?? [];
      expect(nodes.length).toBeGreaterThan(0);
    });

    test("raw reasoning never reaches the satellite", async () => {
      const { handled } = await handleAs(makePerson(), "what is 17 times 24", "17 times 24 is 408.", "carry the two");
      expect((handled.data as { text: string }).text).toBe("seventeen times twenty-four is four hundred eight.");
      expect(JSON.stringify(handled)).not.toContain("carry the two");
      expect(JSON.stringify(handled)).not.toContain("think>");
    });

    test("a child's satellite turn is released as the default path releases it", async () => {
      const { handled, turnRow } = await handleAs(makePerson("child", "Willow"), "hi", "<think>internal reasoning here</think>Hi there!");
      expect((handled.data as { text: string }).text).toBe("Hi there!");
      expect(JSON.stringify(handled)).not.toContain("internal reasoning");
      const nodes = (JSON.parse(turnRow!.stats as string) as { nodes?: { node: string }[] }).nodes ?? [];
      expect(nodes.map((n) => n.node)).toContain("output_gate");
    });
  });
});
