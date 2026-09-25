// ASK-02's world-subject and world-answer routing was removed in D9.
// These surviving tests protect candidate hygiene and household asks.
import { describe, expect, test } from "bun:test";
import { replyAsksAbout, replyAsksIdentityOf, resolveNames, type SubjectRef } from "@/lib/unknownNames";

const known = { names: ["Pippa", "Nadia", "Sage", "Rover"], resolveEntity: (name: string) => `ent-${name.toLowerCase()}` };
const show = (r: { subjects: SubjectRef[] }) => r.subjects.map((s) => (s.type === "unresolved" ? `unresolved:${s.surface_form}${s.candidate_kinds.length ? `[${s.candidate_kinds.join("/")}]` : ""}` : s.type === "world" ? `world:${s.display_name}` : `household:${s.entity_id}`));

describe("rule 1: candidate hygiene", () => {
  test("an oath in its slot is not a name; the same word outside it is", () => {
    expect(show(resolveNames("Lord, that took ages", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("oh God, not again", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Jesus - that took ages", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Lord is coming over for dinner", undefined, known, "t"))).toEqual(["unresolved:Lord"]);
  });
  test("an edge dash is trimmed; an internal hyphen stands", () => {
    expect(show(resolveNames("Bella - no, the other one", undefined, known, "t"))).toEqual(["unresolved:Bella"]);
    expect(show(resolveNames("Mary-Jane came by with our tent", undefined, known, "t"))).toEqual(["unresolved:Mary-Jane"]);
  });
  test("a capitalized ordinary word after a determiner, or one that was lowercase a turn ago, is that word", () => {
    expect(show(resolveNames("that Answer was wrong", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Storm hit the coast last night", undefined, { ...known, recent: ["that storm was loud"] }, "t"))).toEqual([]);
    expect(show(resolveNames("Storm hit the coast last night", undefined, known, "t"))).toEqual(["unresolved:Storm"]);
    // A word the lexicon does not know is a name however it was typed a turn ago.
    expect(show(resolveNames("Tempo played well", undefined, { ...known, recent: ["the tempo of that song is off"] }, "t"))).toEqual(["unresolved:Tempo"]);
  });
  test("a typo one edit from a predicate in a predicate's slot is not a name; a first name the lexicon knows never is a typo", () => {
    expect(show(resolveNames("Wong, that's not it", undefined, known, "t"))).toEqual([]);
    // The copula's complement introduces a name and is never the typo slot.
    expect(show(resolveNames("that's Wong", undefined, known, "t"))).toEqual(["unresolved:Wong"]);
    expect(show(resolveNames("Serena, that's not it", undefined, known, "t"))).toEqual(["unresolved:Serena"]);
    // A household frame keeps the name whatever the word looks like.
    expect(resolveNames("my cousin Wong is visiting", undefined, known, "t").subjects.map((s) => s.type)).toEqual(["unresolved"]);
  });
  test("a known name is never read by the hygiene rules", () => {
    expect(show(resolveNames("Rover, that's not it", undefined, known, "t"))).toEqual(["household:ent-rover"]);
  });
  test("the review's cases: an introduction, a possessive, a lowercase name a turn ago, a first name that is a lexicon word", () => {
    expect(show(resolveNames("his name is Clover", undefined, known, "t"))).toEqual(["unresolved:Clover"]);
    expect(show(resolveNames("this is Atlas", undefined, known, "t"))).toEqual(["unresolved:Atlas"]);
    expect(show(resolveNames("my Daisy has a cough", undefined, known, "t"))).toEqual(["unresolved:Daisy"]);
    expect(show(resolveNames("our Max is sick", undefined, known, "t"))).toEqual(["unresolved:Max"]);
    expect(show(resolveNames("Nova is coming over", undefined, { ...known, recent: ["is nova coming tonight?"] }, "t"))).toEqual(["unresolved:Nova"]);
    expect(show(resolveNames("Clover, dinner's ready", undefined, known, "t"))).toEqual(["unresolved:Clover"]);
    // The comma slot is the appositive introduction's too: a relation
    // frame's name is never read by the rules, an oath included.
    expect(show(resolveNames("Rover, our new puppy, is adorable", undefined, { ...known, names: ["Pippa"] }, "t"))).toEqual(["unresolved:Rover[pet]"]);
    expect(show(resolveNames("Atlas, my cousin, is visiting on Friday", undefined, known, "t"))).toEqual(["unresolved:Atlas[person]"]);
    expect(show(resolveNames("Jesus, my cousin, is visiting", undefined, known, "t"))).toEqual(["unresolved:Jesus[person]"]);
    expect(show(resolveNames("Jesus, my cousin", undefined, known, "t"))).toEqual(["unresolved:Jesus[person]"]);
    // The frame pattern also matches an oath before a clause; the oath
    // rule still reads it when no comma closes the appositive.
    expect(show(resolveNames("God, my dad is going to be so mad", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Man, my sister is late again", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Man, my sister is late", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("God, my dad is mad", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("God, my dad is so mad, I swear", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Rover, our new puppy", undefined, { ...known, names: ["Pippa"] }, "t"))).toEqual(["unresolved:Rover[pet]"]);
    expect(resolveNames("God, my dad is going to be so mad", undefined, known, "t").unknown).toEqual([]);
  });
});
describe("who-answer questions", () => {
  test("the model's own identity question binds; a which-question or an offer about a world subject does not", () => {
    expect(replyAsksIdentityOf("Serena? Is that someone you know or a public figure?", "Serena")).toBe(true);
    expect(replyAsksIdentityOf("Who's Serena?", "Serena")).toBe(true);
    expect(replyAsksIdentityOf("Which Marsh Lantern album do you mean?", "Marsh Lantern")).toBe(false);
    expect(replyAsksIdentityOf("Want me to look up what Marsh Lantern are doing?", "Marsh Lantern")).toBe(false);
    expect(replyAsksIdentityOf("How is Serena doing?", "Serena")).toBe(false);
    expect(replyAsksAbout("Serena, someone you know or a public figure?", "Serena")).toBe(true);
  });
});
