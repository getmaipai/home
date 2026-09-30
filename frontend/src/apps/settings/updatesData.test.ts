import { describe, expect, test } from "bun:test";
import { hasUpdate, rowsFrom } from "@/apps/settings/updatesData";
import type { RobotUpdate, UpdateProjection } from "@/lib/api";

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
    robots: [],
    robotsError: null,
  };
}

const robot = (overrides: Partial<RobotUpdate> = {}): RobotUpdate => ({
  id: "device-1",
  name: "Riff",
  installed: "0.1.0",
  latest: "v0.2.0",
  daemonVersion: "1.4.2",
  updateAvailable: true,
  blockedBy: "Installing robot updates from Home isn't built yet.",
  lastChecked: "2026-09-29T12:00:00.000Z",
  ...overrides,
});

describe("robot update rows", () => {
  test("a robot behind the latest Bot release has an update row that carries its honest block", () => {
    const rows = rowsFrom({ ...projection(null), robots: [robot()] });
    const row = rows.find((candidate) => candidate.kind === "robot");
    expect(row).toMatchObject({ kind: "robot", id: "robot:device-1", name: "Riff", installed: "0.1.0", available: "v0.2.0", blockedBy: "Installing robot updates from Home isn't built yet.", detail: "Body software 1.4.2" });
    expect(row && hasUpdate(row)).toBe(true);
  });

  test("a robot with an unknown MaiPai version is never an update, even beside a newer release", () => {
    const rows = rowsFrom({ ...projection(null), robots: [robot({ installed: null, updateAvailable: false, blockedBy: null })] });
    const row = rows.find((candidate) => candidate.kind === "robot")!;
    expect(row.installed).toBeNull();
    expect(hasUpdate(row)).toBe(false);
  });

  test("no robots means no robot rows", () => {
    expect(rowsFrom(projection(null)).filter((row) => row.kind === "robot")).toEqual([]);
  });
});

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
