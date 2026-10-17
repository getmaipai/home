import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SETTINGS_AREAS } from "./settingsAreas";

test("the News shelf has one settings card, owned by News instead of Search", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../../../../../backend/packages/news/manifest.json"), "utf-8"));
  const areas = [...SETTINGS_AREAS, manifest.contributes.settings_area];
  const owners = areas.flatMap((area) => area.sections.flatMap((section: { cards?: Array<{ group?: string }> }) =>
    (section.cards ?? []).filter((card) => card.group === "household.news").map(() => area.id)));
  expect(owners).toEqual(["news"]);
});
