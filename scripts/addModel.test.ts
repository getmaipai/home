import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CATALOG_FILE, insertRecord, inspectedFrom } from "./addModel";
import { recordFor } from "../backend/src/lib/addModelRecord";

const found = {
  repo: "owner/Tiny-7B-GGUF", revision: "abc123", file: "Tiny-7B-Q4_K_M.gguf", url: "https://huggingface.co/owner/Tiny-7B-GGUF/resolve/abc123/Tiny-7B-Q4_K_M.gguf",
  sizeBytes: 4_000_000_000, sha256: "a".repeat(64), licence: "apache-2.0",
  architecture: { name: "llama", verified: true, ramBytes: 6e9, shape: { paramCountBillion: 7, bitsPerWeight: 4.8, layers: 32, kvHeads: 8, headDim: 128, maxContext: 32768 } },
};
const record = () => recordFor(inspectedFrom(found), null, new Date("2026-10-27T00:00:00Z"), "shipped");

test("a shipped record carries no added-by and the catalog source stays valid TypeScript with the new id in it", () => {
  expect(record().origin).toBe("shipped");
  expect(record().added_by).toBeUndefined();
  const out = insertRecord(readFileSync(CATALOG_FILE, "utf8"), record());
  expect(out).toContain('id: "added-tiny-7b-gguf-tiny-7b-q4-k-m"');
  expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(out)).not.toThrow();
  expect(out.indexOf("added-tiny-7b")).toBeLessThan(out.indexOf("\n];"));
});

test("adding the same file twice is refused, and a repository without a checksum is refused", () => {
  const once = insertRecord(readFileSync(CATALOG_FILE, "utf8"), record());
  expect(() => insertRecord(once, record())).toThrow("already has");
  expect(() => inspectedFrom({ ...found, sha256: undefined })).toThrow("checksum");
});
