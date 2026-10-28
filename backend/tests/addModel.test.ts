// MODEL-ADD-01 S4: the add flow from a pasted link, against a stubbed Stack.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { addChatModel, addedModelId, AddModelError, inspectForAdd, recordFor } from "@/lib/addModel";
import { listAddedModels, removeAddedModel } from "@/lib/addedModels";
import { chatCatalogEntry } from "@/lib/modelCatalog";
import { __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import { resetDb } from "./reset-db";

const HASH = "a".repeat(64);
const found = {
  repo: "owner/Tiny-7B-GGUF", revision: "abc123", file: "Tiny-7B-Q4_K_M.gguf", url: "https://huggingface.co/owner/Tiny-7B-GGUF/resolve/abc123/Tiny-7B-Q4_K_M.gguf",
  sizeBytes: 4_000_000_000, sha256: HASH, licence: "apache-2.0", gated: false,
  architecture: { name: "llama", experts: 0, verified: true, ramBytes: 6_000_000_000, vramBytes: 0, shape: { paramCountBillion: 7, bitsPerWeight: 4.8, layers: 32, kvHeads: 8, headDim: 128, maxContext: 32768 } },
};
let inspected: Record<string, unknown> = found;
let pulls: Array<Record<string, unknown>> = [];

function client(): StackClient {
  return {
    inspectModel: async () => inspected, roles: async () => ({ roles: [{ id: "chat", model: null, state: { state: "offline" }, models: [] }] }), modelCatalog: async () => ({ models: [] }), models: async () => [], jobs: async () => [], engineAction: async () => ({}),
    pullModel: async (body: Record<string, unknown>) => { pulls.push(body); return { job: "job-1" }; },
  } as unknown as StackClient;
}

beforeEach(() => { resetDb(); inspected = found; pulls = []; __setStackClientForTests(client()); });
afterEach(() => { for (const model of listAddedModels()) removeAddedModel(model.id); __setStackClientForTests(null); });

test("the id is a plain slug and the record carries its source and the engine defaults", () => {
  expect(addedModelId("owner/Tiny-7B-GGUF", "Tiny-7B-Q4_K_M.gguf")).toBe("added-tiny-7b-gguf-tiny-7b-q4-k-m");
  const record = recordFor({ ...found, architecture: "llama", verifiedArchitecture: true, shape: found.architecture.shape, ramBytes: 1 }, "person-sage", new Date("2026-10-27T00:00:00Z"));
  expect(record.origin).toBe("added");
  expect(record.added_by).toBe("person-sage");
  expect(record.sampling).toEqual({ source: "engine defaults, not tuned" });
  expect(record.download?.sha256).toBe(HASH);
});

test("a repository with no checksum or layer shape is refused with a sentence, never guessed", async () => {
  inspected = { ...found, sha256: "" };
  await expect(inspectForAdd("owner/Tiny-7B-GGUF")).rejects.toThrow("checksum");
  inspected = { ...found, architecture: { ...found.architecture, shape: null } };
  await expect(inspectForAdd("owner/Tiny-7B-GGUF")).rejects.toBeInstanceOf(AddModelError);
});

test("adding stores the record and starts a hash-checked download from the link", async () => {
  const added = await addChatModel("owner/Tiny-7B-GGUF", undefined, "person-sage");
  expect(chatCatalogEntry(added.id)?.origin).toBe("added");
  expect(added.state.status).toBe("downloading");
  expect(pulls).toHaveLength(1);
  expect(pulls[0]).toMatchObject({ sha256: HASH, url: found.url });
});
