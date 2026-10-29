import { beforeEach, describe, expect, test } from "bun:test";
import { __resetPrefixPrewarmForTests, notePrefix, prewarmPrefix } from "@/lib/prefixPrewarm";

beforeEach(() => { __resetPrefixPrewarmForTests(); });

describe("prefix prewarm", () => {
  test("a person with no recorded prefix sends nothing", async () => {
    expect(await prewarmPrefix("person-a", "spoken", 100_000)).toBe(false);
  });

  test("only a leading system message is recorded", async () => {
    notePrefix("person-a", "spoken", [{ role: "user", content: "hi" }], [], undefined, 100_000);
    expect(await prewarmPrefix("person-a", "spoken", 200_000)).toBe(false);
  });

  test("a second request inside the gap sends nothing", async () => {
    notePrefix("person-a", "spoken", [{ role: "system", content: "You are a helper." }], [], undefined, 100_000);
    await prewarmPrefix("person-a", "spoken", 200_000);
    expect(await prewarmPrefix("person-a", "spoken", 205_000)).toBe(false);
  });

  test("prefixes are kept per person and per surface class", async () => {
    notePrefix("person-a", "written", [{ role: "system", content: "x" }], [], undefined, 100_000);
    expect(await prewarmPrefix("person-a", "spoken", 200_000)).toBe(false);
    expect(await prewarmPrefix("person-b", "written", 200_000)).toBe(false);
  });
});
