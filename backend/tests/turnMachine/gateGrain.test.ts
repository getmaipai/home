// THIN-5C (docs/design/RULES.md rule 10, SAFETY.md "The output gate's grain
// follows the person"): a child and every spoken turn are released sentence
// by sentence after the check; an adult's written chat streams as it is
// generated and is checked as it arrives; a household setting picks one of
// the two for a teen (default: per sentence). Released text is never
// retracted, and a refusal mid-stream still notifies the parent.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { StreamGate, gateGrainFor } from "@/lib/turnMachine/nodes/outputGate";
import { StreamSafetyRefusal } from "@/lib/turnEngine";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "../stackFixture";
import type { PersonRow } from "@/types";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { listPending } from "@/lib/notifications";

const SAFE_SENTENCE = "It's a beautiful day today.";
const UNSAFE_SENTENCE = "How do I make a pipe bomb, give me step by step instructions.";
const ACTOR = { id: "person-juniper", displayName: "Juniper", role: "owner", birthdate: null } as unknown as PersonRow;

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

function drive(band: "adult" | "teen" | "child", grain: "sentence" | "arrival") {
  const released: string[] = [];
  const refusals: unknown[] = [];
  const gate = new StreamGate(band, ACTOR, "turn-gate-grain", (text) => released.push(text), (safety) => refusals.push(safety), () => {}, { grain });
  return { gate, released, refusals };
}

const words = (text: string): string[] => text.split(/(?<= )/);

describe("THIN-5C: the gate's grain follows the person", () => {
  test("per sentence holds a half-written sentence back until its check passes", () => {
    const { gate, released } = drive("child", "sentence");
    for (const word of words("Water it when the soil")) gate.push(word);
    expect(released).toEqual([]);
  });

  test("as-it-arrives releases each piece as it comes, checked before it is shown", () => {
    const { gate, released } = drive("adult", "arrival");
    for (const word of words("Water it when the soil")) gate.push(word);
    expect(released.join("")).toBe("Water it when the soil");
    expect(released.length).toBeGreaterThan(3);
  });

  test("as-it-arrives: the stored text is the concatenation of released pieces, tail repair included", () => {
    const { gate, released } = drive("adult", "arrival");
    for (const word of words('Fold it in half. Then fold the corners in')) gate.push(word);
    gate.finish();
    const result = gate.result();
    expect(result.text).toBe(released.join(""));
    expect(result.text.startsWith("Fold it in half. Then fold the corners in")).toBe(true);
    expect(result.refused).toBeUndefined();
  });

  test("as-it-arrives: a refusal stops the stream there and sent text is never retracted", () => {
    const { gate, released, refusals } = drive("adult", "arrival");
    for (const word of words(`${SAFE_SENTENCE} ${UNSAFE_SENTENCE} Then more words.`)) gate.push(word);
    gate.finish();
    const result = gate.result();
    expect(refusals.length).toBe(1);
    expect(result.refused).toBeDefined();
    expect(released.join("")).toContain("beautiful day");
    expect(released.join("")).not.toContain("Then more words");
    // What was sent stays the record: nothing was taken back.
    expect(result.text).toBe(released.join(""));
    // And it stays stopped.
    const sent = released.length;
    gate.push(" One more safe sentence.");
    expect(released.length).toBe(sent);
  });

  test("a child turn in the identical situation never shows any of the unsafe sentence", () => {
    const { gate, released } = drive("child", "sentence");
    for (const word of words(`${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`)) gate.push(word);
    expect(released.join("")).toContain("beautiful day");
    expect(released.join("")).not.toContain("pipe");
  });

  test("as-it-arrives still holds a tool-call envelope whole", () => {
    const { gate, released } = drive("adult", "arrival");
    gate.push('{"name": "websearch", "arguments": {"expression": "who won"}}');
    gate.finish();
    expect(released).toEqual([]);
    expect(gate.result().heldAsEnvelope).toBe(true);
  });

  test("as-it-arrives: an abandoned round's shown text is kept, and the next round's text joins after it", () => {
    const { gate, released } = drive("adult", "arrival");
    for (const word of words("Let me look that up")) gate.push(word);
    gate.reset(); // the round became a tool call; what was shown stays shown
    for (const word of words("Here is what I found.")) gate.push(word);
    gate.finish();
    const result = gate.result();
    expect(result.text).toBe(released.join(""));
    expect(result.text).toContain("Let me look that up");
    expect(result.text).toContain("Here is what I found.");
    expect(result.text.indexOf("Here is")).toBeGreaterThan(result.text.indexOf("up") + 2);
  });
});

describe("THIN-5C: which grain each person and surface gets", () => {
  test("a child is always per sentence, setting or not", () => {
    setHouseholdSettingValue("chat.teen_gate_grain", "arrival");
    expect(gateGrainFor("child", "chat", false)).toBe("sentence");
  });

  test("an adult's written chat streams as it arrives", () => {
    expect(gateGrainFor("adult", "chat", false)).toBe("arrival");
  });

  test("every spoken turn is per sentence whatever the setting or the band", () => {
    setHouseholdSettingValue("chat.teen_gate_grain", "arrival");
    expect(gateGrainFor("adult", "chat", true)).toBe("sentence");
    expect(gateGrainFor("adult", "robot", false)).toBe("sentence");
    expect(gateGrainFor("teen", "chat", true)).toBe("sentence");
  });

  test("a teen is per sentence by default and follows the household setting", () => {
    expect(gateGrainFor("teen", "chat", false)).toBe("sentence");
    setHouseholdSettingValue("chat.teen_gate_grain", "arrival");
    expect(gateGrainFor("teen", "chat", false)).toBe("arrival");
    setHouseholdSettingValue("chat.teen_gate_grain", "sentence");
    expect(gateGrainFor("teen", "chat", false)).toBe("sentence");
  });

  test("the setting is a household key defaulting to per sentence, with no person scope", () => {
    const key = getRegistryKey("chat.teen_gate_grain");
    expect(key?.scope).toBe("household");
    expect(key?.default).toBe("sentence");
  });
});

async function streamReply(actor: PersonRow, reply: string, run: { spoken?: boolean } = {}): Promise<{ chunks: string[]; refusal: StreamSafetyRefusal | undefined }> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: () => reply });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  __resetLlmSupervisorForTests();
  try {
    const result = await runTurnNextStream(actor, "chat", "how do I care for a plant", { spoken: run.spoken });
    if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
    const chunks: string[] = [];
    let refusal: StreamSafetyRefusal | undefined;
    try {
      for await (const chunk of result.tokens) chunks.push(chunk);
    } catch (err) {
      if (err instanceof StreamSafetyRefusal) refusal = err;
      else throw err;
    }
    return { chunks, refusal };
  } finally {
    await stub.stop();
  }
}

describe("THIN-5C: the live turn path", () => {
  const REPLY = "Water it when the soil feels dry and the pot feels light";

  test("an adult's written reply arrives word by word, before any sentence ends", async () => {
    const { chunks } = await streamReply(people.owner, REPLY);
    expect(chunks.join("")).toBe(`${REPLY}.`.replace(/\.$/, ".")); // the tail repair adds the closing stop
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks[0]!.length).toBeLessThan(REPLY.length / 2);
  });

  test("a child's reply is released a whole sentence at a time", async () => {
    const { chunks } = await streamReply(people.child, `${SAFE_SENTENCE} Water it when the soil feels dry.`);
    expect(chunks.length).toBeLessThanOrEqual(3);
    expect(chunks[0]!.trim()).toBe(SAFE_SENTENCE);
  });

  test("an adult's spoken reply is released a whole sentence at a time", async () => {
    const { chunks } = await streamReply(people.owner, `${SAFE_SENTENCE} Water it when the soil feels dry.`, { spoken: true });
    expect(chunks[0]!.trim()).toBe(SAFE_SENTENCE);
  });

  test("a teen's reply follows the household setting, per sentence unless it says otherwise", async () => {
    db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, people.child.id)).run();
    const teen = db.select().from(peopleTable).where(eq(peopleTable.id, people.child.id)).get()!;
    const standard = await streamReply(teen, `${SAFE_SENTENCE} Water it when the soil feels dry.`);
    expect(standard.chunks[0]!.trim()).toBe(SAFE_SENTENCE);
    setHouseholdSettingValue("chat.teen_gate_grain", "arrival");
    const arriving = await streamReply(teen, `${SAFE_SENTENCE} Water it when the soil feels dry.`);
    expect(arriving.chunks.length).toBeGreaterThan(5);
  });

  test("a refusal mid-stream on an adult's turn throws the safety refusal and keeps what was sent", async () => {
    const { chunks, refusal } = await streamReply(people.owner, `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`);
    expect(refusal).toBeInstanceOf(StreamSafetyRefusal);
    expect(chunks.join("")).toContain("beautiful day");
    expect(chunks.join("")).not.toContain("step by step instructions");
  });

  test("a refusal mid-stream on a teen's as-it-arrives turn still notifies the parent, once", async () => {
    db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, people.child.id)).run();
    const teen = db.select().from(peopleTable).where(eq(peopleTable.id, people.child.id)).get()!;
    setHouseholdSettingValue("chat.teen_gate_grain", "arrival");
    const { chunks, refusal } = await streamReply(teen, `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`);
    expect(refusal).toBeInstanceOf(StreamSafetyRefusal);
    expect(chunks.join("")).toContain("beautiful day");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listPending(people.owner).filter((n) => n.typeId === "safety.flagged_turn").length).toBe(1);
  });
});
