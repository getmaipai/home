import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { addVersion, approveSheet, chooseKeyColour, compositeOnKey, deleteLook, deleteVersion, describeCharacter, dominantColours, keyOut, lookPromptFor, normalizePicture, readLook, setRest, updateSheet, versionOriginalPath, versionPath, KEY_ALPHA_END, KEY_ALPHA_START, __setCharacterCompletionForTests, __setCharacterPictureCapabilityForTests, LOOK_LIMIT_LINE } from "@/lib/companionLook";
import { createHouseholdCompanion, deleteHouseholdCompanion } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";

const dataRoot = process.env.MAIPAI_DATA_DIR!;
const companionsRoot = join(dataRoot, "companions");
const source = loadManifestOnly("rivet");
if (!source.ok || !source.value.companion) throw new Error("rivet fixture is unavailable");
const companion = source.value.companion;
const png = new Uint8Array([1, 2, 3]);

beforeEach(() => { rmSync(companionsRoot, { recursive: true, force: true }); __setCharacterCompletionForTests(undefined); __setCharacterPictureCapabilityForTests(null); });
afterEach(() => { rmSync(companionsRoot, { recursive: true, force: true }); __setCharacterCompletionForTests(undefined); __setCharacterPictureCapabilityForTests(null); });

function create() {
  const result = createHouseholdCompanion({ ...companion, display_name: "Look test" }, { display_name: "Author" });
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}
function item(label = "Picture") { return { source: "upload" as const, label, width: 1024, height: 1024, from: null }; }

describe("companion look store", () => {
  test("chooses magenta for a green frog and green for a red fox or magenta cat", async () => {
    const character = async (colour: string) => {
      const svg = Buffer.from(`<svg width="64" height="64"><ellipse cx="32" cy="38" rx="22" ry="20" fill="${colour}"/><circle cx="22" cy="19" r="7" fill="${colour}"/><circle cx="42" cy="19" r="7" fill="${colour}"/></svg>`);
      return new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: svg }]).png().toBuffer());
    };
    expect(await chooseKeyColour(await character("#00ff00"))).toBe("#FF00FF");
    expect(await chooseKeyColour(await character("#ff0000"))).toBe("#00FF00");
    expect(await chooseKeyColour(await character("#ff00ff"))).toBe("#00FF00");
  });

  test("returns dominant quantised colours from a two-colour picture", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 20, height: 10, channels: 3, background: "#ff0000" } }).composite([{ input: await sharp({ create: { width: 10, height: 10, channels: 3, background: "#0000ff" } }).png().toBuffer(), left: 10, top: 0 }]).png().toBuffer());
    expect(await dominantColours(png)).toEqual(["#F00000", "#0000F0"]);
  });

  test("asks the picture-reading chat model for the factual card and keeps palette colours local", async () => {
    const image = new Uint8Array(await sharp({ create: { width: 20, height: 20, channels: 3, background: "#cc3322" } }).png().toBuffer());
    let call: { role?: string; messages?: Array<{ content: string; images?: Array<{ url: string }> }>; options?: { response_format?: { type: string; json_schema: { strict: boolean } } } } = {};
    __setCharacterPictureCapabilityForTests({ imageParts: true, pictureTokensMax: 512 });
    __setCharacterCompletionForTests((async (role: string, messages: Array<{ content: string; images?: Array<{ url: string }> }>, options: { response_format?: { type: string; json_schema: { strict: boolean } } }) => {
      call = { role, messages, options };
      return { ok: true, value: { text: JSON.stringify({ species: "fox", description: "A small red fox with a narrow face and black nose." }) } } as never;
    }) as never);
    const described = await describeCharacter(image, "red fox");
    expect(described).toMatchObject({ card: { species: "fox", text: "A small red fox with a narrow face and black nose." }, card_source: "model" });
    expect(described.card.colours).toEqual(["#C03020"]);
    expect(call.role).toBe("chat"); expect(call.messages?.[0]?.images?.[0]?.url).toStartWith("data:image/jpeg;base64,");
    expect(call.messages?.[0]?.content).toContain("Say nothing about mood"); expect(call.options?.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
  });

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

  test("uses the estimated muted background for green and magenta frames", async () => {
    const frame = async (background: [number, number, number], artwork: string) => new Uint8Array(await sharp(Buffer.from(`<svg width="256" height="256"><rect width="256" height="256" fill="rgb(${background.join(",")})"/>${artwork}</svg>`)).png().toBuffer());
    const green = await frame([113, 174, 112], '<defs><filter id="soft"><feGaussianBlur stdDeviation="2"/></filter></defs><ellipse cx="128" cy="168" rx="48" ry="8" fill="rgb(80,130,85)" filter="url(#soft)"/><circle cx="128" cy="128" r="36" fill="rgb(240,140,40)"/>');
    const greenOut = await sharp(await keyOut(green, "#00FF00")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([...greenOut.data.subarray(3, 4)]).toEqual([0]);
    expect([...greenOut.data.subarray((128 * 256 + 128) * 4, (128 * 256 + 128) * 4 + 4)]).toEqual([240, 140, 40, 255]);
    expect(greenOut.data[(168 * 256 + 128) * 4 + 3]!).toBeLessThanOrEqual(20);
    let opaque = 0;
    for (let i = 0; i < greenOut.data.length; i += 4) {
      if (greenOut.data[i + 3]! > 0) opaque++;
      if (greenOut.data[i + 3]! > 20) expect(greenOut.data[i + 1]!).toBeLessThanOrEqual(Math.max(greenOut.data[i]!, greenOut.data[i + 2]!) + 12);
    }
    expect(opaque / (256 * 256)).toBeGreaterThan(0.02);
    const magenta = await frame([170, 90, 175], '<circle cx="128" cy="128" r="36" fill="rgb(250,210,40)"/><circle cx="185" cy="128" r="20" fill="rgb(230,40,30)"/>');
    const magentaOut = await sharp(await keyOut(magenta, "#FF00FF")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(magentaOut.data[3]).toBe(0);
    expect([...magentaOut.data.subarray((128 * 256 + 128) * 4, (128 * 256 + 128) * 4 + 4)]).toEqual([250, 210, 40, 255]);
    expect(magentaOut.data[(128 * 256 + 204) * 4]!).toBeGreaterThan(220);
  });

  test("falls back to the pure-key formula when the foreground touches most of the border", async () => {
    const png = new Uint8Array(await sharp(Buffer.from('<svg width="32" height="32"><rect width="32" height="32" fill="rgb(0,255,0)"/><rect width="24" height="32" fill="rgb(255,0,0)"/></svg>')).png().toBuffer());
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const expected = new Uint8Array(decoded.data);
    for (let i = 0; i < expected.length; i += 4) {
      const r = expected[i]!, g = expected[i + 1]!, b = expected[i + 2]!;
      const coverage = Math.min(g, 255 - r, 255 - b) / 255;
      const rawAlpha = (1 - coverage) * 255;
      expected[i + 3] = Math.min(expected[i + 3]!, Math.round(Math.max(0, Math.min(1, (rawAlpha - KEY_ALPHA_START) / (KEY_ALPHA_END - KEY_ALPHA_START))) * 255));
    }
    const result = await sharp(await keyOut(png, "#00FF00")).ensureAlpha().raw().toBuffer();
    expect(new Uint8Array(result)).toEqual(expected);
  });

  test("keys the Rivet muted-green fixture and keeps its white chest panel", async () => {
    const fixture = new Uint8Array(await Bun.file(new URL("../../tests/fixtures/rivet-muted-green-256.png", import.meta.url)).arrayBuffer());
    const result = await sharp(await keyOut(fixture, "#00FF00")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(result.data[3]).toBe(0);
    const fixturePixels = await sharp(fixture).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let originalOpaque = 0, kept = 0;
    for (let i = 0; i < result.data.length; i += 4) {
      if (fixturePixels.data[i + 3]! > 0) originalOpaque++;
      if (result.data[i + 3] === 255) kept++;
    }
    expect(kept / (256 * 256)).toBeGreaterThan(0.12); expect(kept / (256 * 256)).toBeLessThan(0.3);
    const chest = (151 * 256 + 123) * 4;
    expect([...result.data.subarray(chest, chest + 4)]).toEqual([255, 255, 255, 255]);
    const outside = (220 * 256 + 128) * 4; expect(result.data[outside + 3]).toBeLessThanOrEqual(40);
    expect(originalOpaque).toBeGreaterThan(0);
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

  test("enlarges a small picture instead of refusing it", async () => {
    const input = new Uint8Array(await sharp({ create: { width: 64, height: 90, channels: 3, background: "red" } }).png().toBuffer());
    const output = await normalizePicture(input, { removeBackground: async (bytes) => bytes });
    const meta = await sharp(output).metadata(); expect(meta.width).toBe(1024); expect(meta.height).toBe(1024);
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

  test("stores exact Stack originals and removes them with the version while old manifests still parse", () => {
    const id = create(), original = new Uint8Array([9, 8, 7]);
    const withOriginal = addVersion(id, png, item("Generated"), original);
    expect(new Uint8Array(readFileSync(versionOriginalPath(id, withOriginal.id)!))).toEqual(original);
    expect(readLook(id).versions[0]?.has_original).toBe(true);
    const withoutOriginal = addVersion(id, png, item("Upload"));
    expect(versionOriginalPath(id, withoutOriginal.id)).toBeNull();
    expect(readLook(id).versions[1]?.has_original).toBeUndefined();
    const removable = addVersion(id, png, item("Edited"), original);
    setRest(id, withOriginal.id);
    expect(deleteVersion(id, removable.id)).toBe(true);
    expect(existsSync(join(companionsRoot, id, "look", `${removable.id}.orig.png`))).toBe(false);
    deleteLook(id);
    expect(versionOriginalPath(id, withOriginal.id)).toBeNull();
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
    const id = create(); const one = addVersion(id, png, item("One"), png), two = addVersion(id, png, item("Two"));
    expect(readLook(id).rest).toBe(one.id); expect(setRest(id, two.id)).toBe(true); expect(readLook(id).rest).toBe(two.id);
    expect(deleteHouseholdCompanion(id)).toBe(true);
    expect(readLook(id).versions).toEqual([]);
    expect(existsSync(join(companionsRoot, id, "look", `${one.id}.orig.png`))).toBe(false);
    deleteLook(id);
  });

  test("approval names the missing card and deleting an approved view requires review", () => {
    const id = create(), rest = addVersion(id, png, item("Rest")), view = addVersion(id, png, { ...item("Side"), source: "edit", from: rest.id });
    updateSheet(id, { views: { left: view.id, right: null, mouth: null }, card: null, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null });
    expect(() => approveSheet(id, "Reviewer")).toThrow("Add a description card before approving the character sheet. Make the sheet or write the card first.");
    updateSheet(id, { views: { left: view.id, right: null, mouth: null }, card: { text: "A character description with enough words.", colours: [], species: "fox" }, key: "#00FF00", state: "approved", approved_by: "Reviewer", approved_at: new Date().toISOString() });
    expect(deleteVersion(id, view.id)).toBe(true);
    expect(readLook(id).sheet).toMatchObject({ views: { left: null }, state: "needs_review", approved_by: null });
  });
});
