// FORM-CHAT-HUB-01: a package's typed `ask` pauses the turn as a form and a Submit resumes the package
// (docs/design/form-in-chat-2026-10-25.md). The package is stubbed at runPlugin; everything else is the real turn machine.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, startRecordingProxy, type BenchPeople } from "../../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import { CATALOG } from "@/lib/modelCatalog";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { streamTurnEvents } from "@/routes/turn";
import { __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { getPendingAsk, setPendingAsk } from "@/lib/conversationHistory";
import { validateAskValues } from "@/lib/askForm";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { TurnAskField } from "@/wire";

const SENTINEL = "ZQX-FORM-VALUE-5519";
let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function withStub<T>(opts: { reply?: (request: ChatCompletionRequest) => string; calls?: (request: ChatCompletionRequest) => { id: string; name: string; args: string }[] | undefined }, fn: () => Promise<T>): Promise<T> {
  __setToolOfferOverridesForTests(CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")?.turn_budget?.tools_offered ?? []);
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedChatReply: opts.reply,
    scriptedToolCalls: (request) => {
      if (!request.tools || request.tools.length === 0) return undefined;
      return opts.calls?.(request)?.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } }));
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    return await fn();
  } finally {
    __setToolOfferOverridesForTests(null);
    proxy.stop();
    await stub.stop();
  }
}

const FIELDS: TurnAskField[] = [
  { name: "when", label: "Time", kind: "text", required: true },
  { name: "count", label: "How many", kind: "number", required: false, min: 1, max: 5 },
  { name: "pick", label: "Which", kind: "choice", required: false, options: ["red", "blue"] },
  { name: "urgent", label: "Urgent", kind: "yes_no", required: false },
];
const FORM_RESULT = { reply: { text: "I need a time." }, actions: [], ask: { prompt: "What time should I use?", min_band: "adult", fields: FIELDS } };

type Plugins = typeof import("@/lib/plugins");

/** Stubs the package: the first run asks for a form, every later run answers. Returns the args each run received. */
async function stubPackage(later: unknown = { ok: true, value: { reply: { text: "Done at the time you gave." }, actions: [] } }, first: unknown = { ok: true, value: FORM_RESULT }) {
  const plugins: Plugins = await import("@/lib/plugins");
  const seen: Record<string, unknown>[] = [];
  const run = spyOn(plugins, "runPlugin").mockImplementation((async (_id: string, _actor: unknown, inputs: Record<string, unknown>) => {
    seen.push(inputs);
    return seen.length === 1 ? first : later;
  }) as never);
  return { seen, restore: () => run.mockRestore() };
}

const search = (request: ChatCompletionRequest) =>
  !request.messages.some((m) => m.role === "tool") && request.tools?.some((t) => t.function.name === "websearch")
    ? [{ id: "call-form", name: "websearch", args: JSON.stringify({ expression: "Thursday" }) }]
    : undefined;

async function askTurn(actor = people.owner, opts: { temporary?: boolean } = {}) {
  const parked = await withStub({ calls: search, reply: () => "unused" }, () => runTurnNext(actor, "chat", "search for Thursday", opts));
  if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
  return parked;
}

describe("FORM-CHAT-HUB-01: drawing the form", () => {
  test("an adult's package ask with fields pauses the turn and draws the form", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn();
      expect(parked.value.source).toBe("confirm");
      expect(parked.value.confirm).toBeUndefined();
      expect(parked.value.reply.text).toBe("What time should I use?");
      expect(parked.value.ask).toMatchObject({ turn_id: parked.value.turn_id, prompt: "What time should I use?", fields: FIELDS });
      expect(Date.parse(parked.value.ask!.expires_at)).toBeGreaterThan(Date.now());
      const pending = getPendingAsk(parked.value.conversation_id);
      expect(pending).toMatchObject({ kind: "ask", packageId: "websearch", turnId: parked.value.turn_id, actorId: people.owner.id, minBand: "adult", fields: FIELDS });
      expect(pending?.expiresAt).toBe(parked.value.ask!.expires_at);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, parked.value.turn_id)).get();
      expect(row?.outcomes ? JSON.parse(row.outcomes as unknown as string) : []).toEqual([]);
    } finally {
      pkg.restore();
    }
  });

  test("the stream's done event carries the ask, and a Submit over the stream resumes it", async () => {
    const pkg = await stubPackage();
    try {
      const events: Array<{ type?: string; value?: { turn_id: string; conversation_id: string; ask?: unknown } }> = [];
      await withStub({ calls: search, reply: () => "unused" }, async () => {
        const result = await runTurnNextStream(people.owner, "chat", "search for Thursday");
        if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
        for await (const event of streamTurnEvents(result, people.owner.id)) events.push(event as never);
      });
      const done = events.find((event) => event.type === "done")!;
      expect(done.value?.ask).toMatchObject({ turn_id: done.value!.turn_id, fields: FIELDS });
      const resumed: typeof events = [];
      await withStub({ reply: () => "All set." }, async () => {
        const result = await runTurnNextStream(people.owner, "chat", "", { conversationId: done.value!.conversation_id, ask_answer: { turn_id: done.value!.turn_id, values: { when: "5pm" } } });
        if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
        for await (const event of streamTurnEvents(result, people.owner.id)) resumed.push(event as never);
      });
      expect(pkg.seen[1]).toMatchObject({ when: "5pm" });
      expect(resumed.some((event) => event.type === "done")).toBe(true);
    } finally {
      pkg.restore();
    }
  });

  test("a child gets no form and no pending ask", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn(people.child);
      expect(parked.value.ask).toBeUndefined();
      expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
    } finally {
      pkg.restore();
    }
  });

  test("a teen gets no form and no pending ask", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn({ ...people.child, role: "teen" });
      expect(parked.value.ask).toBeUndefined();
      expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
    } finally {
      pkg.restore();
    }
  });

  test("a temporary conversation gets no form", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn(people.owner, { temporary: true });
      expect(parked.value.ask).toBeUndefined();
      expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
    } finally {
      pkg.restore();
    }
  });

  test("an ask without fields behaves as it did: no form, no pause", async () => {
    const pkg = await stubPackage(undefined, { ok: true, value: { reply: { text: "Which one?" }, actions: [], ask: { prompt: "Which one?", expects: "a name" } } });
    try {
      const result = await withStub({ calls: search, reply: () => "Which one?" }, () => runTurnNext(people.owner, "chat", "search for Thursday"));
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.ask).toBeUndefined();
      expect(result.value.source).not.toBe("confirm");
      expect(getPendingAsk(result.value.conversation_id)).toBeNull();
    } finally {
      pkg.restore();
    }
  });
});

describe("FORM-CHAT-HUB-01: Submit", () => {
  test("a valid Submit reruns the package with the values bound as inputs, as a new turn", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn();
      const resumed = await withStub({ reply: () => "All set." }, () =>
        runTurnNext(people.owner, "chat", "", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, values: { when: "5pm", count: 2, urgent: true } } }),
      );
      if (!resumed.ok || resumed.kind !== "immediate") throw new Error("expected an immediate result");
      expect(pkg.seen).toHaveLength(2);
      expect(pkg.seen[1]).toMatchObject({ expression: "Thursday", when: "5pm", count: 2, urgent: true });
      expect(resumed.value.turn_id).not.toBe(parked.value.turn_id);
      expect(resumed.value.ask).toBeUndefined();
      expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
    } finally {
      pkg.restore();
    }
  });

  test("a mismatched turn id is 409 ask_stale and leaves the form open", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn();
      const result = await runTurnNext(people.owner, "chat", "", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: "other-turn", values: { when: "5pm" } } });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a failure");
      expect([result.status, result.code]).toEqual([409, "ask_stale"]);
      expect(getPendingAsk(parked.value.conversation_id)?.turnId).toBe(parked.value.turn_id);
      expect(pkg.seen).toHaveLength(1);
    } finally {
      pkg.restore();
    }
  });

  test("an approve tap on a form, or values for a confirm, are 409 ask_stale", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn();
      const tap = await runTurnNext(people.owner, "chat", "Yes", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, approved: true } });
      expect(tap.ok).toBe(false);
      if (tap.ok) throw new Error("expected a failure");
      expect(tap.code).toBe("ask_stale");
      setPendingAsk(parked.value.conversation_id, { kind: "confirm", prompt: "Go?", packageId: "websearch", args: {}, turnId: parked.value.turn_id });
      const values = await runTurnNext(people.owner, "chat", "", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, values: { when: "5pm" } } });
      expect(values.ok).toBe(false);
      if (values.ok) throw new Error("expected a failure");
      expect(values.code).toBe("ask_stale");
    } finally {
      pkg.restore();
    }
  });

  test("an expired form is 409 ask_stale and the package does not run", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn();
      setPendingAsk(parked.value.conversation_id, { ...getPendingAsk(parked.value.conversation_id)!, expiresAt: new Date(Date.now() - 1000).toISOString() });
      const result = await runTurnNext(people.owner, "chat", "", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, values: { when: "5pm" } } });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a failure");
      expect([result.status, result.code]).toEqual([409, "ask_stale"]);
      expect(pkg.seen).toHaveLength(1);
    } finally {
      pkg.restore();
    }
  });

  test("a form bound to another person is 409 ask_stale", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn();
      setPendingAsk(parked.value.conversation_id, { ...getPendingAsk(parked.value.conversation_id)!, actorId: "someone-else" });
      const result = await runTurnNext(people.owner, "chat", "", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, values: { when: "5pm" } } });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a failure");
      expect(result.code).toBe("ask_stale");
    } finally {
      pkg.restore();
    }
  });

  test("an invalid value is a 400 that names the field, runs nothing, and keeps the form open", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn();
      const result = await runTurnNext(people.owner, "chat", "", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, values: { when: "5pm", count: 9 } } });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a failure");
      expect([result.status, result.code]).toEqual([400, "invalid_input"]);
      expect(result.error).toContain("How many");
      expect(pkg.seen).toHaveLength(1);
      expect(getPendingAsk(parked.value.conversation_id)?.turnId).toBe(parked.value.turn_id);
    } finally {
      pkg.restore();
    }
  });
});

describe("FORM-CHAT-HUB-01: rule 6a and failures", () => {
  test("submitted values and the prompt never reach logs, the trace, outcomes or the stored rows", async () => {
    const pkg = await stubPackage();
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" "))));
    try {
      const parked = await askTurn();
      const resumed = await withStub({ reply: () => "All set." }, () =>
        runTurnNext(people.owner, "chat", `typed ${SENTINEL}`, { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, values: { when: SENTINEL } } }),
      );
      if (!resumed.ok || resumed.kind !== "immediate") throw new Error("expected an immediate result");
      expect(pkg.seen[1]).toMatchObject({ when: SENTINEL });
      const rows = db.select().from(conversationTurns).all();
      const stored = JSON.stringify(rows);
      expect(stored).not.toContain(SENTINEL);
      expect(JSON.stringify(resumed.toolEvents ?? [])).not.toContain(SENTINEL);
      expect(JSON.stringify(resumed.value)).not.toContain(SENTINEL);
      expect(logged.join("\n")).not.toContain(SENTINEL);
      expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
      pkg.restore();
    }
  });

  test("a package failure after Submit reaches the model as a kind only, never the raw error", async () => {
    const pkg = await stubPackage({ ok: false, status: 502, code: "upstream", error: `raw failure ${SENTINEL}` });
    try {
      const parked = await askTurn();
      const requests: string[] = [];
      const resumed = await withStub({ reply: (request) => (requests.push(JSON.stringify(request.messages)), "I could not finish that.") }, () =>
        runTurnNext(people.owner, "chat", "", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, values: { when: "5pm" } } }),
      );
      expect(resumed.ok).toBe(true);
      expect(requests.join("\n")).not.toContain(SENTINEL);
      expect(JSON.stringify(db.select().from(conversationTurns).all())).not.toContain(SENTINEL);
    } finally {
      pkg.restore();
    }
  });
});

describe("FORM-CHAT-HUB-01: validateAskValues", () => {
  test("checks kind, required, length, range, choice and yes/no, and drops empty optional fields", () => {
    const ok = validateAskValues(FIELDS, { when: "5pm", count: 3, pick: "red", urgent: false });
    expect(ok).toEqual({ ok: true, inputs: { when: "5pm", count: 3, pick: "red", urgent: false } });
    expect(validateAskValues(FIELDS, { when: "5pm", count: null, pick: "" })).toEqual({ ok: true, inputs: { when: "5pm" } });
    for (const values of [{}, { when: "x".repeat(501) }, { when: "a", count: 0 }, { when: "a", count: "2" }, { when: "a", pick: "green" }, { when: "a", urgent: "yes" }, { when: "a", extra: 1 }]) {
      expect(validateAskValues(FIELDS, values as never).ok).toBe(false);
    }
  });
});

describe("FORM-CHAT-HUB-01: review fixes", () => {
  test("a consequential package parks its own confirm after Submit, and approving it keeps the values out of events, outcomes and rows", async () => {
    const pkg = await stubPackage({ ok: false, status: 502, code: "upstream", error: `raw failure ${SENTINEL}` });
    const entry = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!;
    const original = entry.turn_budget;
    entry.turn_budget = { ...original!, tools_offered: [...(original!.tools_offered ?? []), "lock-doors"] };
    const lockCall = (request: ChatCompletionRequest) => (!request.messages.some((m) => m.role === "tool") && request.tools?.some((t) => t.function.name === "lock-doors") ? [{ id: "call-lock", name: "lock-doors", args: "{}" }] : undefined);
    try {
      const first = await withStub({ calls: lockCall, reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "lock the doors"));
      if (!first.ok || first.kind !== "immediate") throw new Error("expected an immediate result");
      const conversationId = first.value.conversation_id;
      // Approve the first confirm: the package runs and answers with a form.
      const formTurn = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "Yes", { conversationId, ask_answer: { turn_id: first.value.turn_id, approved: true } }));
      if (!formTurn.ok || formTurn.kind !== "immediate") throw new Error("expected an immediate result");
      expect(formTurn.value.ask).toBeDefined();
      // Submit: a consequential package parks its own confirm.
      const confirm = await withStub({ reply: () => "unused" }, () =>
        runTurnNext(people.owner, "chat", "", { conversationId, ask_answer: { turn_id: formTurn.value.turn_id, values: { when: SENTINEL } } }),
      );
      if (!confirm.ok || confirm.kind !== "immediate") throw new Error("expected an immediate result");
      expect(confirm.value.source).toBe("confirm");
      expect(confirm.value.confirm).toBeDefined();
      expect(pkg.seen).toHaveLength(1);
      // Approve it: the package runs with the values, and fails with an error that echoes them.
      const requests: string[] = [];
      const approved = await withStub({ reply: (request) => (requests.push(JSON.stringify(request.messages)), "I could not finish that.") }, () =>
        runTurnNext(people.owner, "chat", "Yes", { conversationId, ask_answer: { turn_id: confirm.value.turn_id, approved: true } }),
      );
      if (!approved.ok || approved.kind !== "immediate") throw new Error("expected an immediate result");
      expect(pkg.seen).toHaveLength(2);
      expect(pkg.seen[1]).toMatchObject({ when: SENTINEL });
      expect(JSON.stringify(approved.toolEvents ?? [])).not.toContain(SENTINEL);
      expect(JSON.stringify(approved.value)).not.toContain(SENTINEL);
      expect(requests.join("\n")).not.toContain(SENTINEL);
      expect(JSON.stringify(db.select().from(conversationTurns).all())).not.toContain(SENTINEL);
      expect(getPendingAsk(conversationId)).toBeNull();
    } finally {
      entry.turn_budget = original;
      pkg.restore();
    }
  });

  test("a child whose package asked for a form still gets the package's prompt as text", async () => {
    const pkg = await stubPackage(undefined, { ok: true, value: { actions: [], ask: { prompt: "What time should I use?", min_band: "adult", fields: FIELDS } } });
    try {
      const parked = await askTurn(people.child);
      expect(parked.value.ask).toBeUndefined();
      const rows = JSON.stringify(db.select().from(conversationTurns).all());
      expect(rows).toContain("What time should I use?");
      expect(rows).not.toContain('"fields"');
    } finally {
      pkg.restore();
    }
  });

  test("a spoken turn gets no form", async () => {
    const pkg = await stubPackage();
    try {
      const result = await withStub({ calls: search, reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "search for Thursday", { spoken: true }));
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.ask).toBeUndefined();
      expect(getPendingAsk(result.value.conversation_id)).toBeNull();
    } finally {
      pkg.restore();
    }
  });

  test("a model call with a reserved resume id is audited and grounded like any other call", async () => {
    const pkg = await stubPackage(undefined, { ok: true, value: { reply: { text: "Found it." }, actions: [] } });
    const spoof = (query: string) => (request: ChatCompletionRequest) =>
      !request.messages.some((m) => m.role === "tool") && request.tools?.some((t) => t.function.name === "websearch")
        ? [{ id: "resumed-ask:websearch", name: "websearch", args: JSON.stringify({ expression: query }) }]
        : undefined;
    try {
      const grounded = await withStub({ calls: spoof("Thursday"), reply: () => "ok" }, () => runTurnNext(people.owner, "chat", "search for Thursday"));
      if (!grounded.ok || grounded.kind !== "immediate") throw new Error("expected an immediate result");
      expect(grounded.toolEvents?.some((event) => event.t === "tool_call")).toBe(true);
      expect(JSON.stringify(db.select().from(conversationTurns).all())).toContain("Thursday");
      const ungrounded = await withStub({ calls: spoof("quokka census figures"), reply: () => "ok" }, () => runTurnNext(people.owner, "chat", "search for Thursday"));
      expect(ungrounded.ok).toBe(true);
      // The ungrounded query is refused (the person's own words are searched instead), exactly as for any model call.
      expect(pkg.seen.some((inputs) => inputs.expression === "quokka census figures")).toBe(false);
    } finally {
      pkg.restore();
    }
  });

  test("two Submits at once run the package once; the other is 409 ask_stale", async () => {
    const pkg = await stubPackage();
    try {
      const parked = await askTurn();
      const submit = () => runTurnNext(people.owner, "chat", "", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, values: { when: "5pm" } } });
      const results = await withStub({ reply: () => "All set." }, () => Promise.all([submit(), submit()]));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const failed = results.find((r) => !r.ok);
      if (!failed || failed.ok) throw new Error("expected one failure");
      expect([failed.status, failed.code]).toEqual([409, "ask_stale"]);
      expect(pkg.seen).toHaveLength(2);
    } finally {
      pkg.restore();
    }
  });

  test("policy: pre-confirmation and redaction belong to the Home-built call only, never to a model call that repeats it", async () => {
    const { policyNode } = await import("@/lib/turnMachine/nodes/policy");
    const state = { actor: { role: "adult" }, context: [], crisis: false, temporary: false, utterance: "lock the doors" } as never;
    const args = { when: SENTINEL };
    const run = async (call: Record<string, unknown>, preConfirmed: Record<string, unknown>) => {
      const out = await policyNode(state, { calls: [{ tool: "lock-doors", args, id: "c1", ...call }], preConfirmed: { kind: "side_effecting", request: { tool: "lock-doors", args, callId: "resumed:lock-doors" }, ...preConfirmed } as never }, new AbortController().signal);
      return out.output.entries[0]!;
    };
    // The Home-built approval of a confirm a form parked: allowed, and the proposal stays redacted.
    const home = await run({ redactArgs: true }, { redactArgs: true });
    expect(home.decision.allow).toBe(true);
    expect(home.proposal.redactArgs).toBe(true);
    // A model call with the same tool and args carries no flag: it is asked again, and not redacted by our flag.
    const repeat = await run({}, { redactArgs: true });
    expect(repeat.decision.allow).toBe(false);
    expect(repeat.proposal.redactArgs).toBeUndefined();
    // A form re-run is never pre-confirmed, even when its own flags are present: a consequential package parks a confirm.
    const resume = await run({ formResume: true, redactArgs: true }, { formResume: true, redactArgs: true });
    expect(resume.decision.allow).toBe(false);
    expect(resume.proposal.formResume).toBe(true);
    // A model call that repeats it gets neither flag.
    const spoofed = await run({}, { formResume: true, redactArgs: true });
    expect(spoofed.proposal.formResume).toBeUndefined();
    expect(spoofed.proposal.redactArgs).toBeUndefined();
  });
});
