import { describe, expect, test, beforeEach } from "bun:test";
import { __resetVoiceCueStateForTests, freshCueState, isProtectedSentence, planForPerson, planVoiceCues, sanitizeSpeechTags, seededRoll, stripCueTags, type CueInput, type CueState } from "@/lib/voiceCues";
import { readTtsTags } from "@/lib/ttsCapabilities";

const TAGS = ["laugh", "chuckle", "cough", "sigh", "clear throat", "gasp"];
const FUNNY = "That joke was honestly pretty funny.";
const PLAIN = "The garden needs more sun than the porch gets.";

function plan(over: Partial<CueInput> = {}) {
  return planVoiceCues({ text: FUNNY, turnId: "t1", level: "light", band: "adult", supportedTags: TAGS, roll: 0, state: freshCueState(), ...over });
}

beforeEach(() => __resetVoiceCueStateForTests());

describe("planVoiceCues gates", () => {
  test("adds a laugh after humorous content when the engine honors it", () => {
    const r = plan();
    expect(r.text).toBe(`${FUNNY} [laugh]`);
    expect(r.inserted).toEqual({ kind: "tag", name: "laugh" });
  });

  test("falls back to chuckle when laugh is not advertised", () => {
    expect(plan({ supportedTags: ["chuckle"] }).text).toBe(`${FUNNY} [chuckle]`);
  });

  test("an engine with no tags gets no nonverbal tag", () => {
    const r = plan({ supportedTags: [] });
    expect(r.text).not.toContain("[");
  });

  test("a tag outside the known list is never inserted", () => {
    expect(plan({ supportedTags: ["burp"] }).text).not.toContain("[");
  });

  test("off inserts nothing", () => {
    expect(plan({ level: "off" }).text).toBe(FUNNY);
  });

  test("a child or a teen never gets a cue or a filler, whatever the setting", () => {
    for (const band of ["child", "teen"] as const) {
      for (const level of ["light", "natural"] as const) {
        expect(plan({ band, level }).text).toBe(FUNNY);
        expect(plan({ band, level, text: PLAIN, supportedTags: [] }).text).toBe(PLAIN);
      }
    }
  });

  test("a blocked line (safety, refusal, alarm, tool status) gets nothing", () => {
    expect(plan({ blocked: true }).text).toBe(FUNNY);
    expect(plan({ blocked: true, text: PLAIN, supportedTags: [] }).text).toBe(PLAIN);
  });

  test("never in numbers, links, instructions, names of steps or safety wording", () => {
    for (const text of [
      "Haha, that costs 40 dollars.",
      "Funny, it takes about three minutes.",
      "That was funny, see https://example.com for more.",
      "First, preheat the oven, which is funny.",
      "Haha, call 911 if it gets worse.",
      "Ha, the alarm goes off at noon.",
      "I'm sorry, that was a funny mistake.",
      "Make sure you stir, it is funny how it thickens.",
    ]) {
      expect(isProtectedSentence(text)).toBe(true);
      expect(plan({ text }).text).toBe(text);
    }
  });

  test("an unfinished sentence gets no trailing laugh", () => {
    expect(plan({ text: "That joke was funny and then" }).text).toBe("That joke was funny and then");
  });

  test("a surprise cue goes before the sentence", () => {
    expect(plan({ text: "Wow, that is a big pumpkin." }).text).toBe("[gasp] Wow, that is a big pumpkin.");
  });

  test("a plain sentence with an engine that has tags gets no tag", () => {
    expect(plan({ text: PLAIN, roll: 0.99 }).text).toBe(PLAIN);
  });
});

describe("spoken filler for engines without tags", () => {
  const OPENER = "The garden needs more sun than the porch gets.";
  test("adds a light filler at the opener", () => {
    const r = plan({ text: OPENER, supportedTags: [], roll: 0 });
    expect(r.inserted?.kind).toBe("filler");
    expect(r.text).toMatch(/^(Hmm|Well), the garden needs/);
  });
  test("keeps a name capitalized", () => {
    const r = plan({ text: "Marlow said the garden needs more sun today.", supportedTags: [], roll: 0 });
    expect(r.text).toMatch(/^(Hmm|Well), Marlow said/);
  });
  test("not on a short line, a question, or one that already starts with a filler", () => {
    expect(plan({ text: "Sure thing.", supportedTags: [], roll: 0 }).text).toBe("Sure thing.");
    expect(plan({ text: "Do you want the garden moved closer to the porch?", supportedTags: [], roll: 0 }).text).toBe("Do you want the garden moved closer to the porch?");
    expect(plan({ text: "Well, the garden needs more sun than the porch.", supportedTags: [], roll: 0 }).text).toBe("Well, the garden needs more sun than the porch.");
  });
  test("only the opener, never a later sentence", () => {
    const first = plan({ text: "Okay then.", supportedTags: [] });
    const later = planVoiceCues({ text: OPENER, turnId: "t1", level: "light", band: "adult", supportedTags: [], roll: 0, state: first.state });
    expect(later.text).toBe(OPENER);
  });
});

describe("rate limits", () => {
  const run = (level: "light" | "natural", n: number) => {
    let state: CueState = freshCueState();
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = planVoiceCues({ text: FUNNY, turnId: "t1", level, band: "adult", supportedTags: TAGS, roll: 0, state });
      state = r.state;
      out.push(r.text);
    }
    return out;
  };
  test("light: one cue per turn", () => {
    expect(run("light", 10).filter((t) => t.includes("["))).toHaveLength(1);
  });
  test("natural: two per turn, at least three sentences apart", () => {
    const out = run("natural", 10);
    const idx = out.flatMap((t, i) => (t.includes("[") ? [i] : []));
    expect(idx).toEqual([0, 3]);
  });
  test("cooldown across turns", () => {
    let state = freshCueState();
    const r1 = planVoiceCues({ text: FUNNY, turnId: "a", level: "light", band: "adult", supportedTags: TAGS, roll: 0, state });
    state = r1.state;
    const hits: boolean[] = [];
    for (const id of ["b", "c", "d", "e"]) {
      const r = planVoiceCues({ text: FUNNY, turnId: id, level: "light", band: "adult", supportedTags: TAGS, roll: 0, state });
      state = r.state;
      hits.push(r.text.includes("["));
    }
    expect(r1.text).toContain("[laugh]");
    expect(hits).toEqual([false, false, true, false]);
  });
  test("the seeded roll is deterministic and the chance gate can close", () => {
    expect(seededRoll("t1:0")).toBe(seededRoll("t1:0"));
    expect(seededRoll("t1:0")).not.toBe(seededRoll("t1:1"));
    expect(plan({ roll: 0.95 }).text).toBe(FUNNY);
  });
  test("planForPerson keeps state per person", () => {
    const a = planForPerson("p1", { text: FUNNY, turnId: "x", level: "light", band: "adult", supportedTags: TAGS, roll: 0 });
    const a2 = planForPerson("p1", { text: FUNNY, turnId: "x", level: "light", band: "adult", supportedTags: TAGS, roll: 0 });
    const b = planForPerson("p2", { text: FUNNY, turnId: "x", level: "light", band: "adult", supportedTags: TAGS, roll: 0 });
    expect(a.text).toContain("[laugh]");
    expect(a2.text).toBe(FUNNY);
    expect(b.text).toContain("[laugh]");
  });
});

describe("tag stripping", () => {
  test("stripCueTags removes known tags from shown text and keeps links and citations", () => {
    expect(stripCueTags("That was funny [laugh] really.")).toBe("That was funny really.");
    expect(stripCueTags("[Sigh] okay [clear throat], here we go")).toBe("okay, here we go");
    expect(stripCueTags("See [the docs](https://example.com) and [1].")).toBe("See [the docs](https://example.com) and [1].");
    expect(stripCueTags("no tags here")).toBe("no tags here");
  });
  test("regression: a tag the engine does not honor is dropped before the engine", () => {
    expect(sanitizeSpeechTags("Fine [laugh] then.", [])).toBe("Fine then.");
    expect(sanitizeSpeechTags("Fine [laugh] then [burp].", ["laugh"])).toBe("Fine [laugh] then.");
    expect(sanitizeSpeechTags("Fine [laugh] then.", ["chuckle"])).toBe("Fine then.");
    expect(sanitizeSpeechTags("Fine [Laugh] then.", ["[laugh]"])).toBe("Fine [Laugh] then.");
  });
  test("a composed line never leaves a non-supporting engine with a tag", () => {
    const composed = plan().text;
    expect(composed).toContain("[laugh]");
    expect(sanitizeSpeechTags(composed, [])).not.toContain("[");
    expect(stripCueTags(composed)).toBe(FUNNY);
  });
});

describe("tts capability reader", () => {
  test("reads nested, flat and bare shapes; absent is none", () => {
    expect(readTtsTags({ id: "tts", tts: { tags: ["[laugh]", "Clear Throat"] } })).toEqual(["laugh", "clear throat"]);
    expect(readTtsTags({ "tts.tags": ["sigh"] })).toEqual(["sigh"]);
    expect(readTtsTags({ tags: ["gasp", 4] })).toEqual(["gasp"]);
    expect(readTtsTags({ id: "tts" })).toEqual([]);
    // Copied from the live Stack (GET /stack/v1/roles, tts role, 2026-10-17).
    const live = { id: "tts", wire: "speech", tts: { engine: "chatterbox-turbo", requested: "chatterbox-turbo", tags: ["[laugh]", "[chuckle]", "[cough]", "[sigh]", "[clear throat]", "[gasp]"], fallback_reason: null } };
    expect(readTtsTags(live)).toEqual(TAGS);
    // GET /stack/v1/voices entry.
    expect(readTtsTags({ id: "chatterbox-turbo-voice-default", engine: "chatterbox-turbo", tts: { engine: "chatterbox-turbo", tags: ["[laugh]", "[gasp]"] } })).toEqual(["laugh", "gasp"]);
    // Fell back to Pocket: no tags even if listed.
    expect(readTtsTags({ ...live, tts: { ...live.tts, engine: "pocket", fallback_reason: "chatterbox failed to load" } })).toEqual([]);
    expect(readTtsTags(undefined)).toEqual([]);
  });
});

describe("tag engines versus text openers (owner ruling 2026-10-17)", () => {
  const OPENER = "The garden needs more sun than the porch gets.";
  test("an engine that advertises tags gets no plain-text opener", () => {
    expect(plan({ text: OPENER, supportedTags: TAGS, roll: 0 }).text).toBe(OPENER);
  });
  test("groan and sniff are never placed even when advertised", () => {
    expect(plan({ supportedTags: ["groan", "sniff"], roll: 0 }).text).not.toContain("[");
  });
  test("sigh follows weariness or sympathy", () => {
    expect(plan({ text: "That sounds really tough." }).text).toBe("That sounds really tough. [sigh]");
  });
  test("clear throat opens a long explanation at natural level only", () => {
    const long = "There are a few reasons the garden struggles on that side of the porch over the summer.";
    expect(plan({ text: long, level: "natural", roll: 0.05 }).text).toBe(`[clear throat] ${long}`);
    expect(plan({ text: long, level: "light", roll: 0.05 }).text).toBe(long);
  });
});
