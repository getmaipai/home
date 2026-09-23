import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { parseReplyConstraint, setReplyConstraint, constraintsFor, bannedPhrasesFor, clearReplyConstraints } from "@/lib/replyConstraints";
import { __resetThinkingCuesForTests, pickThinkingCue, THINKING_CUE_VARIANTS } from "@/lib/replyVariation";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";

beforeEach(() => resetDb());

let personCounter = 0;
function makePerson() {
  personCounter += 1;
  return db.insert(people).values({ id: `person-decay${personCounter}`, displayName: "Sage", nickname: null, birthdate: null, role: "owner", avatarSeed: "sage", source: "hub", localOnly: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, hlc: nextHlc() }).returning().get();
}

/** A real `conversations` row (attachments.test.ts's own
 * `conversationFor`) - conversation_turns' own FK needs one to exist,
 * a bare string id fails the insert below. */
function conversationFor(person: ReturnType<typeof makePerson>): string {
  const result = resolveOrCreateConversation(person, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

/** A minimal "done" turn (attachments.test.ts's own `turnFor` shape) -
 * only `createdAt` varies between calls, which is all the decay window
 * reads. */
function doneTurn(personId: string, conversationId: string, createdAt: string) {
  const id = newConversationTurnId();
  db.insert(conversationTurns).values({ id, personId, surface: "chat", conversationId, userText: "x", replyText: "y", source: "model", safetyAction: "allow", createdAt, hlc: nextHlc() }).run();
  return id;
}

/** `setReplyConstraint` stamps `setAt` with the real wall clock at call
 * time, so a fixture turn's own `createdAt` has to be anchored to that
 * same clock, offset in whole seconds, to land reliably before or
 * after it - a fixed calendar date (a prior draft of this file used
 * "2026-09-23T00:0N:00") floats free of whatever `setAt` actually
 * captures and silently miscounts the window (caught by a "the fourth
 * turn is still active" failure, not reasoned out ahead of time). */
function secondsFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

describe("CONS-01: the cue", () => {
  beforeEach(() => __resetThinkingCuesForTests());

  test("rotates, filters, and exhausts thinking cues", () => {
    let previous: string | null = null;
    for (let i = 0; i < 10; i++) {
      const cue = pickThinkingCue("person-a");
      expect(cue).not.toBe(previous);
      previous = cue;
    }
    __resetThinkingCuesForTests();
    for (let i = 0; i < 10; i++) expect(pickThinkingCue("person-a", ["one sec"])?.toLowerCase()).not.toContain("one sec");
    __resetThinkingCuesForTests();
    expect(pickThinkingCue("person-a", THINKING_CUE_VARIANTS.flatMap((cue) => cue.toLowerCase().split(/\s+/)))).toBeNull();
  });
});

describe("reply constraint parser", () => {
  test("parses bans only when the hub said the phrase", () => {
    expect(parseReplyConstraint("stop saying good luck", ["Good luck with it!"])).toEqual({ kind: "banned_phrase", value: "good luck" });
    expect(parseReplyConstraint("stop saying good luck", ["See you Thursday."])).toBeNull();
    expect(parseReplyConstraint("don't say 'one sec' again", ["One sec."])).toEqual({ kind: "banned_phrase", value: "one sec" });
  });

  test("parses shape and length asks", () => {
    expect(parseReplyConstraint("give me a bulleted list", [])).toEqual({ kind: "shape", value: "list" });
    expect(parseReplyConstraint("just the number", [])).toEqual({ kind: "shape", value: "number" });
    expect(parseReplyConstraint("one line", [])).toEqual({ kind: "shape", value: "one_line" });
    expect(parseReplyConstraint("keep it under 20 words", [])).toEqual({ kind: "length", value: "120" });
    expect(parseReplyConstraint("keep it short", [])).toEqual({ kind: "length", value: "120" });
    expect(parseReplyConstraint("what's the weather", [])).toBeNull();
  });
});

describe("reply constraint store", () => {
  test("sets, deduplicates, reads, filters, and clears by conversation", () => {
    const person = db.insert(people).values({ id: "person-sage01", displayName: "Sage", nickname: null, birthdate: null, role: "owner", avatarSeed: "sage", source: "hub", localOnly: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, hlc: "1:0:node123" }).returning().get();
    const first = setReplyConstraint({ conversationId: "conv-first", person: person.id, kind: "banned_phrase", value: "good luck", setByTurn: null });
    const duplicate = setReplyConstraint({ conversationId: "conv-first", person: person.id, kind: "banned_phrase", value: "good luck", setByTurn: null });
    setReplyConstraint({ conversationId: "conv-first", person: null, kind: "shape", value: "list", setByTurn: null });
    setReplyConstraint({ conversationId: "conv-second", person: null, kind: "banned_phrase", value: "one sec", setByTurn: null });
    expect(duplicate.id).toBe(first.id);
    expect(constraintsFor("conv-first")).toHaveLength(2);
    expect(bannedPhrasesFor("conv-first")).toEqual(["good luck"]);
    expect(constraintsFor("conv-second")).toHaveLength(1);
    clearReplyConstraints("conv-first");
    expect(constraintsFor("conv-first")).toEqual([]);
    expect(constraintsFor("conv-second")).toHaveLength(1);
  });
});

// U4/RESP-01, ARCH-AMEND-01's accepted design: a length or shape ask
// holds for the turn that set it and the next three done turns, never
// longer; a banned phrase never decays. constraintsFor's second
// parameter is optional so every existing call above (one argument)
// keeps its own exact behaviour - decay only ever applies when a caller
// asks for it by name.
describe("reply constraint decay by turn count", () => {
  test("with no currentTurnId, nothing decays - the frozen path's own behaviour", () => {
    const person = makePerson();
    const conversationId = conversationFor(person);
    const setTurn = doneTurn(person.id, conversationId, secondsFromNow(-60));
    setReplyConstraint({ conversationId, person: person.id, kind: "length", value: "120", setByTurn: setTurn });
    for (let i = 1; i <= 10; i++) doneTurn(person.id, conversationId, secondsFromNow(i));
    expect(constraintsFor(conversationId)).toHaveLength(1);
  });

  test("a length constraint is returned on its own turn and the next three, absent on the fourth", () => {
    const person = makePerson();
    const conversationId = conversationFor(person);
    const setTurn = doneTurn(person.id, conversationId, secondsFromNow(-60));
    setReplyConstraint({ conversationId, person: person.id, kind: "length", value: "120", setByTurn: setTurn });
    // On its own turn: no other done turn exists after it yet.
    expect(constraintsFor(conversationId, setTurn)).toHaveLength(1);

    const turn1 = doneTurn(person.id, conversationId, secondsFromNow(1));
    expect(constraintsFor(conversationId, turn1)).toHaveLength(1);
    const turn2 = doneTurn(person.id, conversationId, secondsFromNow(2));
    expect(constraintsFor(conversationId, turn2)).toHaveLength(1);
    const turn3 = doneTurn(person.id, conversationId, secondsFromNow(3));
    expect(constraintsFor(conversationId, turn3)).toHaveLength(1);
    const turn4 = doneTurn(person.id, conversationId, secondsFromNow(4));
    expect(constraintsFor(conversationId, turn4)).toHaveLength(0);
  });

  test("a shape constraint decays the same way", () => {
    const person = makePerson();
    const conversationId = conversationFor(person);
    const setTurn = doneTurn(person.id, conversationId, secondsFromNow(-60));
    setReplyConstraint({ conversationId, person: person.id, kind: "shape", value: "list", setByTurn: setTurn });
    for (let i = 1; i <= 3; i++) doneTurn(person.id, conversationId, secondsFromNow(i));
    const turn4 = doneTurn(person.id, conversationId, secondsFromNow(4));
    expect(constraintsFor(conversationId, turn4)).toHaveLength(0);
  });

  test("a banned phrase never decays", () => {
    const person = makePerson();
    const conversationId = conversationFor(person);
    const setTurn = doneTurn(person.id, conversationId, secondsFromNow(-60));
    setReplyConstraint({ conversationId, person: person.id, kind: "banned_phrase", value: "good luck", setByTurn: setTurn });
    let lastTurn = setTurn;
    for (let i = 1; i <= 10; i++) lastTurn = doneTurn(person.id, conversationId, secondsFromNow(i));
    expect(constraintsFor(conversationId, lastTurn)).toHaveLength(1);
  });

  test("a row with no setByTurn never decays", () => {
    const person = makePerson();
    const conversationId = conversationFor(person);
    setReplyConstraint({ conversationId, person: person.id, kind: "length", value: "120", setByTurn: null });
    let lastTurn = "";
    for (let i = 1; i <= 10; i++) lastTurn = doneTurn(person.id, conversationId, secondsFromNow(i));
    expect(constraintsFor(conversationId, lastTurn)).toHaveLength(1);
  });
});
