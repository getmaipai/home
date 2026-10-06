// THIN-0F (rules 4 and 12): episode recall on the default path. Episodes
// are written on both paths (conversationHistory.ts's recordEpisodes());
// before this item only the old path recalled them, so asking about
// something said in an earlier conversation got "nobody told me" on the
// default path. Same structure as context.test.ts: contextNode() called
// directly with a minimal real state, real DB rows, no mocked recall.
import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "../reset-db";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { contextNode } from "@/lib/turnMachine/nodes/context";
import { createConversation, logTurn } from "@/lib/conversationHistory";
import type { TurnState } from "@/lib/turnMachine/contract";
import { withTurnDefaults } from "./turnStateDefaults";
import type { TurnValue } from "@/wire";
import { useDefaultScriptedStack } from "../stackFixture";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  people = createBenchPeople();
  useDefaultScriptedStack();
});

const SIGNAL = new AbortController().signal;
const SAFE_RESULT: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
const SAID = "my dentist appointment is on the fourteenth at nine";
const ASK = "when is my dentist appointment";

function speak(actor: BenchPeople["owner"], conversationId: string, turnId: string, text: string): void {
  logTurn(actor, "chat", text, { reply: { text: "Noted." }, source: "model", safety: SAFE_RESULT, conversation_id: conversationId, turn_id: turnId });
}

function newConversation(actor: BenchPeople["owner"]): string {
  const created = createConversation(actor, { surface: "chat" });
  if (!created.ok) throw new Error(created.error);
  return created.value.id;
}

function stateIn(actor: BenchPeople["owner"], conversationId: string): TurnState {
  return withTurnDefaults({ actor, surface: "chat", conversationId } as TurnState);
}

function episodeText(items: { source: string; text: string }[]): string {
  return items.filter((item) => item.source === "episode").map((item) => item.text).join("\n");
}

describe("contextNode: THIN-0F, episode recall", () => {
  test("a turn that refers to an earlier conversation's wording gets that episode in the context", async () => {
    speak(people.owner, newConversation(people.owner), "turn-earlier-1", SAID);
    const now = newConversation(people.owner);
    const { output } = await contextNode(stateIn(people.owner, now), { utterance: ASK }, SIGNAL);
    expect(episodeText(output.items)).toContain(SAID);
  });

  test("a turn with nothing to recall adds no episode item", async () => {
    speak(people.owner, newConversation(people.owner), "turn-earlier-1", SAID);
    const now = newConversation(people.owner);
    const { output } = await contextNode(stateIn(people.owner, now), { utterance: "tell me a story about otters" }, SIGNAL);
    expect(output.items.filter((item) => item.source === "episode")).toEqual([]);
  });

  test("a temporary conversation recalls no episode", async () => {
    speak(people.owner, newConversation(people.owner), "turn-earlier-1", SAID);
    const { output } = await contextNode(stateIn(people.owner, ""), { utterance: ASK, temporary: true }, SIGNAL);
    expect(output.temporary).toBe(true);
    expect(output.items.filter((item) => item.source === "episode")).toEqual([]);
  });

  test("a child never sees an episode from a conversation it could not read, and still recalls its own", async () => {
    speak(people.owner, newConversation(people.owner), "turn-owner-1", SAID);
    speak(people.child, newConversation(people.child), "turn-child-1", "my dentist appointment is after the school play");
    const now = newConversation(people.child);
    const { output } = await contextNode(stateIn(people.child, now), { utterance: ASK }, SIGNAL);
    const shown = episodeText(output.items);
    expect(shown).not.toContain("fourteenth");
    expect(shown).toContain("after the school play");
  });

  test("this conversation's own turns that fell out of the window come back as earlier words", async () => {
    const conversation = newConversation(people.owner);
    speak(people.owner, conversation, "turn-own-0", "the secret word for the treasure hunt is pomegranate");
    // Long enough that the window's token budget pushes the first turn out.
    for (let i = 1; i <= 8; i++) speak(people.owner, conversation, `turn-own-${i}`, `unrelated chatter number ${i} ${"and so on ".repeat(120)}`);
    const { output } = await contextNode(stateIn(people.owner, conversation), { utterance: "what was the secret word for the treasure hunt" }, SIGNAL);
    const shown = episodeText(output.items);
    expect(shown).toContain("pomegranate");
    expect(shown).toContain("earlier");
  });
});
