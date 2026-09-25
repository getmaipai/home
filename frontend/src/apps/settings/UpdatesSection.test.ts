import { describe, expect, test } from "bun:test";
import { hasUpdate, rowsFrom } from "@/apps/settings/UpdatesSection";
import type { UpdateProjection } from "@/lib/api";

function projection(reference: UpdateProjection["reference"]): UpdateProjection {
  return {
    installed: "0.1.0",
    latest: null,
    summary: null,
    url: null,
    checkedAt: null,
    error: null,
    stack: null,
    stackError: null,
    reference,
    referenceError: null,
  };
}

describe("reference update rows", () => {
  test("an installed set with a newer catalog snapshot has an update row", () => {
    const rows = rowsFrom(projection({
      lastChecked: "2026-09-24T12:00:00.000Z",
      entries: [{ id: "vikidia:eng:nopic", name: "vikidia_en_all", installed: "2026-08", available: "2026-09", lastChecked: "2026-09-24T12:00:00.000Z", notes: null }],
    }));
    const row = rows.find((candidate) => candidate.kind === "reference");
    expect(row).toMatchObject({ kind: "reference", id: "reference:vikidia:eng:nopic", installed: "2026-08", available: "2026-09" });
    expect(row && hasUpdate(row)).toBe(true);
  });

  test("no installed sets means no reference rows or empty placeholder", () => {
    const rows = rowsFrom(projection(null));
    expect(rows.filter((row) => row.kind === "reference")).toEqual([]);
    expect(rows).toHaveLength(1);
  });
});
