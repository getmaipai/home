import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifestOnly } from "@/lib/plugins";
import {
  copyBundledCompanion,
  createHouseholdCompanion,
  deleteHouseholdCompanion,
  getHouseholdCompanion,
  listHouseholdCompanionIds,
  setHouseholdCompanionAudience,
  setHouseholdCompanionStatus,
  updateHouseholdCompanion,
} from "@/lib/householdCompanions";

const dataRoot = process.env.MAIPAI_DATA_DIR!;
const companionsRoot = join(dataRoot, "companions");
const author = { display_name: "Jesse" };
const source = loadManifestOnly("rivet");
if (!source.ok || !source.value.companion) throw new Error("rivet fixture is unavailable");
const input = source.value.companion;

beforeEach(() => rmSync(companionsRoot, { recursive: true, force: true }));

describe("household companion store", () => {
  test("create writes a valid manifest and returns its id", () => {
    const result = createHouseholdCompanion(input, author);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("hc-rivet");
    expect(result.value.companion?.status).toBe("draft");
    const reread = getHouseholdCompanion(result.value.id);
    expect(reread).toEqual(result.value);
  });

  test("a bad field returns a plain sentence", () => {
    const result = createHouseholdCompanion({ ...input, formality: "wild" } as never, author);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/^[A-Z].*\.$/);
      expect(result.error).not.toContain("Zod");
      expect(result.error).not.toContain("[");
    }
  });

  test("ids use hc slugs, stay within 40 characters, and are unique", () => {
    const first = createHouseholdCompanion(input, author);
    const second = createHouseholdCompanion(input, author);
    expect(first.ok && first.value.id).toBe("hc-rivet");
    expect(second.ok && second.value.id).toBe("hc-rivet-2");
    const longName = createHouseholdCompanion({ ...input, display_name: "A name that is much longer than forty ch" }, author);
    expect(longName.ok).toBe(true);
    if (longName.ok) {
      expect(longName.value.id).toMatch(/^hc-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(longName.value.id.length).toBeLessThanOrEqual(40);
    }
  });

  test("path tricks are refused by every id-taking operation", () => {
    for (const id of ["../x", "HC-rivet", "hc-rivet/other"]) {
      expect(getHouseholdCompanion(id)).toBeNull();
      expect(updateHouseholdCompanion(id, { tagline: "Changed" }).ok).toBe(false);
      expect(deleteHouseholdCompanion(id)).toBe(false);
      expect(setHouseholdCompanionAudience(id, "adult").ok).toBe(false);
      expect(setHouseholdCompanionStatus(id, "ready").ok).toBe(false);
      expect(copyBundledCompanion(id, author).ok).toBe(false);
    }
  });

  test("copying rivet creates an adult draft named Rivet (copy)", () => {
    const result = copyBundledCompanion("rivet", author);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.companion?.display_name).toBe("Rivet (copy)");
      expect(result.value.companion?.audience).toBe("adult");
      expect(result.value.companion?.status).toBe("draft");
    }
  });

  test("all requires a reviewer, and lowering the audience to adult clears review", () => {
    const created = createHouseholdCompanion(input, author);
    if (!created.ok) throw new Error(created.error);
    expect(setHouseholdCompanionAudience(created.value.id, "all").ok).toBe(false);
    const approved = setHouseholdCompanionAudience(created.value.id, "all", author);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.companion?.review?.confirmed_by).toBe("Jesse");
    expect(approved.value.companion?.review?.confirmed_at).toBeTruthy();
    const lowered = setHouseholdCompanionAudience(created.value.id, "adult");
    expect(lowered.ok && lowered.value.companion?.review).toBeUndefined();
  });

  test("malformed companion folders are skipped", () => {
    const dir = join(companionsRoot, "hc-broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), "not json");
    expect(getHouseholdCompanion("hc-broken")).toBeNull();
    expect(listHouseholdCompanionIds()).toEqual([]);
  });
});
