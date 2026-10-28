import { afterEach, expect, test } from "bun:test";
import { listAddedModels, removeAddedModel, saveAddedModel } from "@/lib/addedModels";
import { CATALOG, catalogEntries, chatCatalogEntry } from "@/lib/modelCatalog";
import { chatSamplingOf } from "@/lib/llmSampling";
import { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";

const shipped = CATALOG.find((model) => model.role === "chat")!;
function addedRecord(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return ModelCapabilities.parse({ ...shipped, id: "added-test-model", label: "Added test model", origin: "added", added_by: "person-sage", added_at: "2026-10-27T12:00:00.000Z", sampling: undefined, ...overrides });
}

afterEach(() => { removeAddedModel("added-test-model"); removeAddedModel(shipped.id); });

test("an added record joins the one catalog list and its sampling comes from its own record", () => {
  saveAddedModel(addedRecord({ sampling: { temperature: 0.6, top_k: 20, source: "the repository's generation_config.json" } }), "huggingface.co/owner/repo");
  expect(catalogEntries().map((model) => model.id)).toContain("added-test-model");
  expect(chatCatalogEntry("added-test-model")?.origin).toBe("added");
  expect(chatSamplingOf(chatCatalogEntry("added-test-model"))).toEqual({ temperature: 0.6, top_k: 20 });
});

test("an added record with no sampling sends no sampling keys", () => {
  saveAddedModel(addedRecord(), "huggingface.co/owner/repo");
  expect(chatSamplingOf(chatCatalogEntry("added-test-model"))).toEqual({});
});

test("a shipped id is never shadowed, and removal takes the record out of the list", () => {
  saveAddedModel(addedRecord({ id: shipped.id }), "huggingface.co/owner/repo");
  expect(catalogEntries().filter((model) => model.id === shipped.id)).toHaveLength(1);
  expect(chatCatalogEntry(shipped.id)?.origin).not.toBe("added");
  saveAddedModel(addedRecord(), "huggingface.co/owner/repo");
  expect(removeAddedModel("added-test-model")).toBe(true);
  expect(listAddedModels().some((model) => model.id === "added-test-model")).toBe(false);
});

test("a shipped record cannot be stored as added", () => {
  expect(() => saveAddedModel(shipped, "x")).toThrow();
});
