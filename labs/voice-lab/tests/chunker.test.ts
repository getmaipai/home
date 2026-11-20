import { expect, test } from "bun:test";
import { Chunker } from "../src/chunker";
const run = (c: Chunker, parts: string[]) => parts.flatMap((p) => c.push(p));
test("default: the first chunk waits for punctuation at 14+ characters (or 42 characters)", () => {
  expect(run(new Chunker(), ["Oh that is a really good question, ", "and more"])).toEqual(["Oh that is a really good question,"]);
});
test("firstWords: the first chunk is cut after N words when no punctuation came earlier, never inside a [tag], the rest is unchanged", () => {
  expect(run(new Chunker(4), ["Oh that is a really", " good question, and more words."])).toEqual(["Oh that is a", "really good question, and more words."]);
});
test("firstWords never splits an open [tag]", () => { const c = new Chunker(2); expect(run(c, ["[sigh", "] Well then, ok."])).not.toContain("[sigh"); });
