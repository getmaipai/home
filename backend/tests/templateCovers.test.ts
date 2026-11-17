import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE_COVER_IDS, templateCoverUrl } from "@/lib/templateCovers";

const TEMPLATES = join(import.meta.dir, "..", "packages", "generate_image", "images", "templates");
const COVERS = join(import.meta.dir, "..", "..", "frontend", "public", "template-covers");

test("every picture template has a cover file and a cover entry", () => {
  const ids = readdirSync(TEMPLATES).filter((f) => f.startsWith("mtpl-") && f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(TEMPLATES, f), "utf8")).id as string);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    expect(TEMPLATE_COVER_IDS).toContain(id);
    expect(existsSync(join(COVERS, `${id}.jpg`))).toBe(true);
  }
});

test("a template without a cover gets no picture, so the card keeps its gradient", () => {
  expect(templateCoverUrl("mtpl-adpack")).toBe("/template-covers/mtpl-adpack.jpg");
  expect(templateCoverUrl("mtpl-unknown")).toBeNull();
});

const VIDEO_TEMPLATES = join(import.meta.dir, "..", "packages", "generate_video", "video", "templates");
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

test("the cover list has no repeats and names no template that does not exist", () => {
  expect(new Set(TEMPLATE_COVER_IDS).size).toBe(TEMPLATE_COVER_IDS.length);
  const ids = new Set([
    ...readdirSync(TEMPLATES).filter((f) => f.startsWith("mtpl-") && f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(TEMPLATES, f), "utf8")).id as string),
    ...(JSON.parse(readFileSync(join(VIDEO_TEMPLATES, "shot-starters.json"), "utf8")) as Array<{ id: string }>).map((t) => t.id),
  ]);
  for (const id of TEMPLATE_COVER_IDS) expect(ids.has(id)).toBe(true);
  for (const f of readdirSync(COVERS)) expect(ids.has(f.replace(/\.jpg$/, ""))).toBe(true);
});

// A video template's cover is a picture made from that template's own prompt. cover-sources.json records the sha256 of the prompt and of the
// file each cover was made from, so an edited prompt, a swapped file, two templates sharing one picture, or the old plain gradient tile all fail here.
test("every video template has its own real cover, made from its current prompt", () => {
  const templates = JSON.parse(readFileSync(join(VIDEO_TEMPLATES, "shot-starters.json"), "utf8")) as Array<{ id: string; kind: string; prompt: string }>;
  const sources = JSON.parse(readFileSync(join(VIDEO_TEMPLATES, "..", "cover-sources.json"), "utf8")) as Record<string, { prompt: string; file: string }>;
  const seen = new Set<string>();
  for (const t of templates.filter((row) => row.kind === "video")) {
    const path = join(COVERS, `${t.id}.jpg`);
    expect(existsSync(path)).toBe(true);
    const bytes = readFileSync(path);
    expect(bytes.length).toBeGreaterThan(14_000); // the gradient tiles were 8 to 11 KB; a real picture is larger
    const src = sources[t.id];
    expect(src).toBeDefined();
    expect(src!.prompt).toBe(sha(t.prompt));
    expect(src!.file).toBe(sha(bytes));
    expect(seen.has(src!.file)).toBe(false);
    seen.add(src!.file);
  }
  expect(Object.keys(sources).sort()).toEqual(templates.filter((row) => row.kind === "video").map((row) => row.id).sort());
});
