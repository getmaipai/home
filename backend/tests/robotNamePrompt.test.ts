import { describe, expect, test } from "bun:test";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { buildStablePrefix, identityLine } from "@/lib/turnShared";

describe("robot identity in turn prompts", () => {
  test("chat stable prefix remains byte-identical", () => {
    expect(buildStablePrefix(DEFAULT_PERSONA, "written")).toBe(
      "You are MaiPai, a private, self-hosted AI assistant for this household. Nothing you say leaves this house. You cannot tell who a person in a photo is.",
    );
  });

  test("the robot name replaces the persona name in its identity line", () => {
    expect(identityLine(DEFAULT_PERSONA, "StackChan 2")).toBe(
      "You are StackChan 2, a private, self-hosted AI assistant for this household.",
    );
  });
});
