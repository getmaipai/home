import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { addVersion, deleteLook, deleteVersion, normalizePicture, readLook, setRest, versionPath, LOOK_LIMIT_LINE, SMALL_PICTURE_LINE } from "@/lib/companionLook";
import { createHouseholdCompanion, deleteHouseholdCompanion } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";

const dataRoot = process.env.MAIPAI_DATA_DIR!;
const companionsRoot = join(dataRoot, "companions");
const source = loadManifestOnly("rivet");
if (!source.ok || !source.value.companion) throw new Error("rivet fixture is unavailable");
const companion = source.value.companion;
const png = new Uint8Array([1, 2, 3]);

beforeEach(() => rmSync(companionsRoot, { recursive: true, force: true }));
afterEach(() => rmSync(companionsRoot, { recursive: true, force: true }));

function create() {
  const result = createHouseholdCompanion({ ...companion, display_name: "Look test" }, { display_name: "Author" });
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}
function item(label = "Picture") { return { source: "upload" as const, label, width: 1024, height: 1024, from: null }; }

describe("companion look store", () => {
  test("normalising centres a minimum-size opaque image on a transparent 1024 square within the margins", async () => {
    const input = new Uint8Array(await sharp({ create: { width: 600, height: 512, channels: 3, background: "red" } }).png().toBuffer());
    const output = await normalizePicture(input, { removeBackground: async (bytes) => bytes });
    const result = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(result.info.width).toBe(1024); expect(result.info.height).toBe(1024);
    let left = 1024, top = 1024, right = -1, bottom = -1;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) if (result.data[(y * 1024 + x) * 4 + 3]! > 0) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    expect(left).toBeGreaterThanOrEqual(122); expect(top).toBeGreaterThanOrEqual(122);
    expect(right).toBeLessThan(902); expect(bottom).toBeLessThan(902);
    expect(Math.abs((left + right) / 2 - 511.5)).toBeLessThanOrEqual(1);
    expect(Math.abs((top + bottom) / 2 - 511.5)).toBeLessThanOrEqual(1);
  });

  test("refuses a picture below the minimum short side", async () => {
    const input = new Uint8Array(await sharp({ create: { width: 511, height: 700, channels: 3, background: "red" } }).png().toBuffer());
    await expect(normalizePicture(input, { removeBackground: async (bytes) => bytes })).rejects.toThrow(SMALL_PICTURE_LINE);
  });

  test("keeps an existing transparent background without calling the remover", async () => {
    const input = new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer(), left: 156, top: 156 }]).png().toBuffer());
    let called = false;
    const output = await normalizePicture(input, { removeBackground: async () => { called = true; return input; } });
    expect(called).toBe(false);
    const meta = await sharp(output).metadata(); expect(meta.width).toBe(1024); expect(meta.height).toBe(1024); expect(meta.hasAlpha).toBe(true);
  });

  test("counts up and does not reuse IDs after deleting a version", () => {
    const id = create(); const first = addVersion(id, png, item("One")), second = addVersion(id, png, item("Two"));
    expect(first.id).toBe("v-1"); expect(second.id).toBe("v-2");
    expect(deleteVersion(id, second.id)).toBe(true);
    expect(addVersion(id, png, item("Three")).id).toBe("v-3");
  });

  test("refuses the 61st picture and refuses to delete the rest picture", () => {
    const id = create();
    for (let index = 0; index < 60; index++) addVersion(id, png, item(`Picture ${index}`));
    expect(() => addVersion(id, png, item("Too many"))).toThrow(LOOK_LIMIT_LINE);
    expect(() => deleteVersion(id, "v-1")).toThrow("That picture is the approved starting picture. Pick another one first.");
  });

  test("rejects path tricks", () => {
    for (const versionId of ["../x", "v-1/../..", "v-x"]) expect(versionPath(create(), versionId)).toBeNull();
  });

  test("setting rest changes the approved picture and deleting the companion removes its pictures", () => {
    const id = create(); const one = addVersion(id, png, item("One")), two = addVersion(id, png, item("Two"));
    expect(readLook(id).rest).toBe(one.id); expect(setRest(id, two.id)).toBe(true); expect(readLook(id).rest).toBe(two.id);
    expect(deleteHouseholdCompanion(id)).toBe(true);
    expect(readLook(id).versions).toEqual([]);
    deleteLook(id);
  });
});
