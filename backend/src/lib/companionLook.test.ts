import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { addVersion, compositeOnKey, deleteLook, deleteVersion, keyOut, lookPromptFor, normalizePicture, readLook, setRest, versionPath, LOOK_LIMIT_LINE, SMALL_PICTURE_LINE } from "@/lib/companionLook";
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
  test("builds a clipped character prompt with the selected key colour", () => {
    expect(lookPromptFor("  small red fox  ", "#00FF00")).toBe("small red fox. A single character, full body, centred in the frame, standing in a relaxed neutral pose, facing the viewer, mouth closed, arms down. Simple clean cartoon illustration, flat colours. Plain solid green background, no shadow, no ground, no text, no other objects.");
    expect(lookPromptFor("x".repeat(700), "#FF00FF").startsWith("x".repeat(600) + ". A single character")).toBe(true);
    expect(lookPromptFor("cat", "#FF00FF")).toContain("solid magenta background");
  });

  test("keys out green and magenta without tinting antialiased red edges", async () => {
    for (const key of ["#00FF00", "#FF00FF"]) {
      const background = key === "#00FF00" ? { r: 0, g: 255, b: 0 } : { r: 255, g: 0, b: 255 };
      const svg = Buffer.from('<svg width="64" height="64"><circle cx="32" cy="32" r="20" fill="red"/></svg>');
      const input = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background } }).composite([{ input: svg }]).png().toBuffer());
      const result = await sharp(await keyOut(input, key)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const center = (32 * 64 + 32) * 4;
      expect([...result.data.subarray(center, center + 4)]).toEqual([255, 0, 0, 255]);
      const partial: number[] = [];
      for (let i = 0; i < result.data.length; i += 4) if (result.data[i + 3]! > 10 && result.data[i + 3]! < 245) partial.push(i);
      expect(partial.length).toBeGreaterThan(0);
      const edge = result.data.subarray(partial[Math.floor(partial.length / 2)]!, partial[Math.floor(partial.length / 2)]! + 4);
      expect(edge[0]).toBeGreaterThan(220); expect(edge[1]).toBeLessThanOrEqual(16); expect(edge[2]).toBeLessThanOrEqual(16);
    }
  });

  test("composites a transparent look picture on the chosen key colour", async () => {
    const input = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg width="4" height="4"><rect width="2" height="4" fill="red"/></svg>') }]).png().toBuffer());
    const output = await sharp(await compositeOnKey(input, "#FF00FF")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([...output.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...output.data.subarray(8, 12)]).toEqual([255, 0, 255, 255]);
  });

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
