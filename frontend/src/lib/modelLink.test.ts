import { describe, expect, test } from "bun:test";
import { parseModelLink } from "@/lib/modelLink";

describe("parseModelLink", () => {
  test("accepts a GGUF resolve link", () => {
    expect(parseModelLink("https://huggingface.co/example-org/example-model/resolve/main/model.gguf")).toEqual({ source: { url: "https://huggingface.co/example-org/example-model/resolve/main/model.gguf" } });
  });
  test("accepts an MLX repository link", () => {
    expect(parseModelLink("https://huggingface.co/example-org/example-model/")).toEqual({ source: { repo: "example-org/example-model" } });
  });
  test("accepts a repository tree revision", () => {
    expect(parseModelLink("https://huggingface.co/example-org/example-model/tree/main")).toEqual({ source: { repo: "example-org/example-model", revision: "main" } });
  });
  test("accepts a bare repository", () => {
    expect(parseModelLink("example-org/example-model")).toEqual({ source: { repo: "example-org/example-model" } });
  });
  test("rewrites a GGUF blob link to resolve", () => {
    expect(parseModelLink("https://huggingface.co/example-org/example-model/blob/main/model.gguf")).toEqual({ source: { url: "https://huggingface.co/example-org/example-model/resolve/main/model.gguf" } });
  });
  test("strips a GGUF link query string", () => {
    expect(parseModelLink("https://huggingface.co/example-org/example-model/resolve/main/model.gguf?download=true")).toEqual({ source: { url: "https://huggingface.co/example-org/example-model/resolve/main/model.gguf" } });
  });
  test("explains an empty input", () => {
    expect(parseModelLink("  ")).toEqual({ error: "Paste a Hugging Face link first." });
  });
  test("rejects another host", () => {
    expect(parseModelLink("https://example.com/owner/repo")).toEqual({ error: "That does not look like a Hugging Face model link." });
  });
  test("rejects a repository path with extra segments", () => {
    expect(parseModelLink("owner/repo/extra")).toEqual({ error: "That does not look like a Hugging Face model link." });
  });
});
