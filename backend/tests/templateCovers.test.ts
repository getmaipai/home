import { expect, test } from "bun:test";
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
