// Pure package validation runs without Home's server-based test preload from the repo root.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { checkAppPackage } from "@maipai/spec/ui/app-check.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

const dir = join(import.meta.dir, "../packages/news");
const read = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf-8"));
const manifest = read("manifest.json");

test("News is a valid manifest and its seven pages validate against the pinned spec", () => {
  const ajv = new Ajv2020({ strict: false });
  expect(PackageManifest.safeParse(manifest).success).toBe(true);
  expect(checkAppPackage("news", manifest.contributes, (module) => read(`pages/${module}.json`), manifest.min_role)).toEqual([]);
  for (const entry of manifest.contributes.pages) {
    expect(ajv.validate(UI_SCHEMA, read(`pages/${entry.module}.json`))).toBe(true);
    expect(entry.min_role ?? manifest.min_role).toBe(entry.id === "mix" ? "teen" : "child");
  }
});

test("News declares list rows, local person keys and the shelf matrix without premature widget fields", () => {
  expect(manifest.offline).toBe("degraded");
  expect(manifest.contributes.data.filter((entry: { rows?: string }) => entry.rows === "list").map((entry: { id: string }) => entry.id)).toEqual(["topics", "sources", "saved", "search-recents"]);
  for (const key of manifest.config) expect(SettingsKey.safeParse(key).success).toBe(true);
  expect(manifest.config.filter((key: { scope: string }) => key.scope === "person").map((key: { key: string }) => key.key)).toEqual(["news.my_mix", "news.reader_open", "news.digest"]);
  expect(manifest.contributes.settings_area.sections[1].min_role).toBe("admin");
  expect(manifest.contributes.settings_area.sections[1].cards[0].matrix.columns.map((column: { band: string }) => column.band)).toEqual(["child", "teen", "adult"]);
  expect(manifest.contributes.widgets[0]).toEqual({ id: "headlines", title: "News", size: "row", refresh_s: 900, inputs: {} });
});

test("page references declare every data id and keep Mix-only actions off child pages", () => {
  const references = new Map<string, Set<string>>();
  const permitted = new Set(["page", "section", "answer_blocks", "tabs", "list", "picker", "empty_state", "search"]);
  function visit(value: unknown, found: Set<string>): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, found)); return; }
    const node = value as Record<string, unknown>;
    if (node.type) expect(permitted.has(String(node.type))).toBe(true);
    if (node.source === "package") {
      expect(manifest.contributes.data.map((entry: { id: string }) => entry.id)).toContain(node.path);
      found.add(`data:${node.path}`);
    }
    if (node.target) {
      expect(String(node.target)).toMatch(/^\/api\/plugins\/news\/actions\/[a-z_]+$/);
      found.add(`action:${String(node.target).split("/").at(-1)}`);
    }
    Object.values(node).forEach((item) => visit(item, found));
  }
  for (const page of manifest.contributes.pages) {
    const found = new Set<string>(); visit(read(`pages/${page.module}.json`), found); references.set(page.id, found);
  }
  expect([...references.get("mix")!]).toContain("data:mix");
  for (const [page, found] of references) {
    expect(found.has("data:mix")).toBe(page === "mix");
    expect(found.has("action:feedback")).toBe(page === "mix");
    expect(found.has("action:reset_mix")).toBe(page === "mix");
    expect(found.has("data:household-today")).toBe(false);
  }
});
