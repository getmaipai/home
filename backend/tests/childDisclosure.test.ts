import { describe, expect, test } from "bun:test";
import { defaultChildDisclosure } from "@/lib/childDisclosure";

const ordinary = { sensitive: false, scope: "household" };

describe("defaultChildDisclosure", () => {
  test("recognizes adult-to-tell cues", () => {
    expect(defaultChildDisclosure("Nana passed away on Sunday", ordinary)).toBe("adult_only");
    expect(defaultChildDisclosure("the bank says we're behind on the mortgage", ordinary)).toBe("adult_only");
  });

  test("allows ordinary household facts", () => {
    expect(defaultChildDisclosure("we got a new puppy", ordinary)).toBe("child_ok");
  });

  test("sensitive records are adult-only", () => {
    expect(defaultChildDisclosure("we got a new puppy", { ...ordinary, sensitive: true })).toBe("adult_only");
  });

  test("requires cue word boundaries", () => {
    expect(defaultChildDisclosure("the account owes us money", ordinary)).toBe("child_ok");
  });
});
