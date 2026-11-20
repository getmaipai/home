// The reference limit is sized from the engine, never from a constant: the Stack's own per-request cap wins, else the model's own count,
// at most 6 pictures in all (what the shipped picture model takes), at least 1. A status that reports 0 extras (the live Stack with
// the old Klein summary) still reads the installed model's count.
import { describe, expect, test } from "bun:test";
import { MAX_REFERENCE_PICTURES, pictureEngineEdits, pictureEngineReferences, pictureReferenceLimit, readyStatusForTests, TEST_PICTURE_PART } from "@/lib/pictures/ready";

const model = (extra: Record<string, unknown> = {}) => ({ id: TEST_PICTURE_PART, family: "test-family", installed: true, loras: false, edit: true, steps_default: 6, peak_gb: 22, ...extra });
const status = (over: Record<string, unknown>) => readyStatusForTests({ edit: { generative: true, masked: false, references: 0 }, ...over } as never);

describe("picture reference limit", () => {
  test("a model that takes 15 is held at the Stack's own per-request cap", () => {
    const s = status({ models: [model({ max_references: 15 })], limits: { max_references: 2, queue_max: 4 } });
    expect(pictureEngineReferences(s)).toBe(2);
    expect(pictureReferenceLimit(s)).toBe(2);
  });
  test("with no cap stated the model's count is used, held at 6", () => {
    const s = status({ models: [model({ max_references: 15 })], limits: { queue_max: 4 } });
    expect(pictureEngineReferences(s)).toBe(15);
    expect(pictureReferenceLimit(s)).toBe(MAX_REFERENCE_PICTURES);
    expect(MAX_REFERENCE_PICTURES).toBe(6);
  });
  test("the count the Stack reports for edits is used when no cap is stated, ahead of the model's own", () => {
    expect(pictureReferenceLimit(status({ edit: { generative: true, masked: false, references: 2 }, models: [model({ max_references: 15 })], limits: { queue_max: 4 } }))).toBe(2);
  });
  test("a Stack that states 5 gives 5", () => {
    const s = status({ models: [model({ max_references: 15 })], limits: { max_references: 5, queue_max: 4 } });
    expect(pictureReferenceLimit(s)).toBe(5);
  });
  test("an engine that says nothing is 1, and no engine is 1 for the tool but 0 extras", () => {
    expect(pictureReferenceLimit(null)).toBe(1);
    expect(pictureEngineReferences(null)).toBe(0);
    expect(pictureReferenceLimit(status({ models: [model()] }))).toBe(1);
  });
  test("edits are possible when an installed model edits even if the summary says not generative", () => {
    expect(pictureEngineEdits(status({ edit: { generative: false, masked: false, references: 0 }, models: [model()] }))).toBe(true);
    expect(pictureEngineEdits(status({ edit: { generative: false, masked: false, references: 0 }, models: [model({ edit: false })] }))).toBe(false);
    expect(pictureEngineEdits(null)).toBe(false);
  });
});
