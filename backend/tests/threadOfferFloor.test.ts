import { describe, expect, test } from "bun:test";
import { threadOfferFloor } from "@/lib/threadOfferFloor";
import { defaultChildDisclosure } from "@/lib/childDisclosure";

const base = { category: "event", text: "Has a job interview at the bakery on Monday.", sensitive: false };

describe("threadOfferFloor (NAT-07c)", () => {
  test("an ordinary event, goal or project may be offered", () => {
    expect(threadOfferFloor(base)).toEqual({ offerable: true });
    expect(threadOfferFloor({ ...base, category: "goal", text: "Wants to run a 10k in the spring." })).toEqual({ offerable: true });
    expect(threadOfferFloor({ ...base, category: "project", text: "Is building a bookshelf for the hall." })).toEqual({ offerable: true });
  });

  test("other kinds are never offered", () => {
    for (const category of ["fact", "state", "preference", "relationship"]) {
      expect(threadOfferFloor({ ...base, category })).toEqual({ offerable: false, reason: "kind" });
    }
  });

  // One case per withheld subject the note names: health, money owed, a relationship conflict, a death.
  test.each([
    ["health", "Has a biopsy on Tuesday."],
    ["health", "Is in hospital for surgery on Friday."],
    ["money owed", "Owes the landlord and is behind on rent, talking to him Monday."],
    ["a relationship conflict", "Is separating and meeting a lawyer for the divorce on Wednesday."],
    ["a death", "Flying out for the funeral on Saturday."],
    ["a death", "Nana passed away; the memorial service is on Sunday."],
  ])("%s is withheld by the cue floor: %s", (_subject, text) => {
    expect(threadOfferFloor({ ...base, text })).toEqual({ offerable: false, reason: "adult_to_tell" });
  });

  test("a record the person set sensitive is withheld, whatever its words", () => {
    expect(threadOfferFloor({ ...base, sensitive: true })).toEqual({ offerable: false, reason: "sensitive" });
  });

  test("the judge's tag withholds and nothing un-withholds", () => {
    expect(threadOfferFloor({ ...base, offerWithheld: true })).toEqual({ offerable: false, reason: "offer_withheld" });
    expect(threadOfferFloor({ ...base, offerWithheld: false })).toEqual({ offerable: true });
    expect(threadOfferFloor({ ...base, offerWithheld: null })).toEqual({ offerable: true });
  });

  test("it uses the same cue list as the child-disclosure floor", () => {
    const text = "Has a court date on Thursday.";
    expect(defaultChildDisclosure(text, { sensitive: false, scope: "person" })).toBe("adult_only");
    expect(threadOfferFloor({ ...base, text }).offerable).toBe(false);
  });

  test("the answer carries a reason id, never the record text", () => {
    const answer = threadOfferFloor({ ...base, text: "Has a biopsy on Tuesday." });
    expect(JSON.stringify(answer)).not.toContain("biopsy");
  });
});
