import { describe, expect, test } from "bun:test";
import { readPictureMakeBody } from "@/lib/pictures/make";
import { ERNIE_MODEL, modelCanSpell, TEXT_CAPABLE_MODELS } from "@/lib/pictures/quality";

describe("TEXT-PIC words arguments and model catalog", () => {
  test("only ERNIE is marked text capable", () => {
    expect(TEXT_CAPABLE_MODELS).toEqual(new Set([ERNIE_MODEL]));
    expect(modelCanSpell(ERNIE_MODEL)).toBe(true);
    expect(modelCanSpell("flux2-klein-4b")).toBe(false);
    expect(modelCanSpell("z-image-turbo")).toBe(false);
    expect(modelCanSpell(undefined)).toBe(false);
  });

  test("Create accepts, trims and drops empty word strings", () => {
    expect(readPictureMakeBody({ prompt: "a poster", words: ["  Hello  ", "", " World "] })).toMatchObject({ ok: true, body: { words: ["Hello", "World"] } });
    expect(readPictureMakeBody({ prompt: "a poster", words: ["x".repeat(81)] }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a poster", words: Array(7).fill("word") }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a poster", words: "hello" }).ok).toBe(false);
  });
});
