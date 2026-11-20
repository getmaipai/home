import { describe, expect, test } from "bun:test";
import { readPictureMakeBody } from "@/lib/pictures/make";

describe("TEXT-PIC words arguments", () => {
  test("Create accepts, trims and drops empty word strings", () => {
    expect(readPictureMakeBody({ prompt: "a poster", words: ["  Hello  ", "", " World "] })).toMatchObject({ ok: true, body: { words: ["Hello", "World"] } });
    expect(readPictureMakeBody({ prompt: "a poster", words: ["x".repeat(81)] }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a poster", words: Array(7).fill("word") }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a poster", words: "hello" }).ok).toBe(false);
  });
});
