import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifestOnly } from "@/lib/plugins";
import { createHouseholdCompanion } from "@/lib/householdCompanions";
import { addTake, bestTake, deleteStates, deleteTake, readStates, setMotion, takePath, __resetCompanionStatesForTests } from "@/lib/companionStates";

const dataRoot = process.env.MAIPAI_DATA_DIR!;
const root = join(dataRoot, "companions");
const source = loadManifestOnly("rivet");
if (!source.ok || !source.value.companion) throw new Error("rivet fixture is unavailable");
const sourceCompanion = source.value.companion;

beforeEach(() => { rmSync(root, { recursive: true, force: true }); __resetCompanionStatesForTests(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); __resetCompanionStatesForTests(); });

function companion() { const result = createHouseholdCompanion({ ...sourceCompanion, display_name: "State fixture" }, { display_name: "Author", person_id: "state-test" }); if (!result.ok) throw new Error(result.error); return result.value.id; }

describe("companion states store", () => {
  test("only vocabulary states are accepted, and the state is persisted", () => {
    const id = companion();
    const take = addTake(id, "idle", { source: "upload", label: "first" });
    expect(take.id).toBe("take-1");
    expect(readStates(id).states.idle?.takes).toHaveLength(1);
    expect(() => addTake(id, "../../look", { source: "upload", label: "bad" })).toThrow("Choose one of the listed companion states.");
    expect(() => setMotion(id, "dancing", "spin")).toThrow("Choose one of the listed companion states.");
  });

  test("limits a state to twelve takes and removes a deleted take folder", () => {
    const id = companion();
    for (let i = 0; i < 12; i++) addTake(id, "idle", { source: "upload", label: `take ${i}` });
    expect(() => addTake(id, "idle", { source: "upload", label: "too many" })).toThrow("Delete some of this state's other takes first.");
    const path = takePath(id, "idle", "take-12", "source.mp4")!;
    expect(deleteTake(id, "idle", "take-12")).toBe(true);
    expect(readStates(id).states.idle?.takes).toHaveLength(11);
    expect(path.includes("take-12")).toBe(true);
    expect(addTake(id, "idle", { source: "upload", label: "next" }).id).toBe("take-13");
  });

  test("takes paths are allow-listed and approved takes cannot be deleted", () => {
    const id = companion(), take = addTake(id, "idle", { source: "upload", label: "clip" });
    expect(takePath(id, "idle", take.id, "still.png")).toContain("finished");
    expect(takePath(id, "idle", take.id, "../../manifest.json")).toBeNull();
    const all = readStates(id); all.states.idle!.approved = take.id;
    writeFileSync(join(root, id, "states", "states.json"), JSON.stringify(all));
    expect(() => deleteTake(id, "idle", take.id)).toThrow("That clip is approved. Remove the approval first.");
  });

  test("best take prefers passing reports, then colour distance, then area", () => {
    const id = companion();
    const takes = [1, 2, 3, 4].map((i) => addTake(id, "idle", { source: "upload", label: `${i}` }));
    const report = (ok: boolean, colour_distance: number | null, area_ratio: number) => ({ ok, reasons: [], seconds: 3, bytes: { h264: 100, av1: null }, colour_distance, area_ratio, loop_gap: 0, opaque_share: { min: 0.5, max: 0.8 } });
    takes[0]!.report = report(false, 0.1, 1);
    takes[1]!.report = report(true, 3, 1.1);
    takes[2]!.report = report(true, 2, 1.2);
    takes[3]!.report = report(true, 2, 0.9);
    expect(bestTake(takes)?.id).toBe(takes[3]!.id);
    expect(bestTake([takes[0]!])).toBeNull();
    takes[2]!.report = report(true, null, 0.7);
    expect(bestTake([takes[1]!, takes[2]!])?.id).toBe(takes[1]!.id); // a missing distance counts as 999
  });

  test("motion can return to the vocabulary default and companion states can be removed", () => {
    const id = companion(); setMotion(id, "idle", "swings its tail");
    expect(readStates(id).states.idle?.motion).toBe("swings its tail");
    setMotion(id, "idle", null); expect(readStates(id).states.idle?.motion).toBeNull();
    addTake(id, "idle", { source: "upload", label: "clip" }); deleteStates(id);
    expect(readStates(id).states).toEqual({});
  });
});
