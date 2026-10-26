import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { appRouteAllowed } from "@/lib/apps";
import { PACKAGES_DIR } from "@/lib/paths";
import { owner } from "./support/testAuth";

const pages = [
  ["videos", "watch"], ["music", "play"], ["podcasts", "play"], ["shows", "watch"],
] as const;

describe("media detail player pages", () => {
  test("each edit and cover target validates and is owned by its page", async () => {
    const ajv = new Ajv2020({ strict: false });
    const actor = await owner();
    for (const [app, pageId] of pages) {
      const page = JSON.parse(readFileSync(join(PACKAGES_DIR, app, "pages", `${pageId}.json`), "utf8")) as Record<string, unknown>;
      expect(ajv.validate(UI_SCHEMA as object, page), `${app}: ${JSON.stringify(ajv.errors)}`).toBe(true);
      for (const action of ["edit", "cover"]) {
        expect(appRouteAllowed(actor.row, app, "actions", action), `${app}/${action}`).toBe(true);
      }
    }
  });

  test("Music collection detail pages start with a collection creation header", () => {
    const ajv = new Ajv2020({ strict: false });
    for (const pageId of ["album", "playlist", "artist"]) {
      const page = JSON.parse(readFileSync(join(PACKAGES_DIR, "music", "pages", `${pageId}.json`), "utf8")) as { body: Array<Record<string, unknown>> };
      expect(ajv.validate(UI_SCHEMA as object, page), `${pageId}: ${JSON.stringify(ajv.errors)}`).toBe(true);
      expect(page.body[0]).toMatchObject({ type: "creation_header", variant: "collection" });
    }
  });

  test("Music play page uses a byline creation header", () => {
    const page = JSON.parse(readFileSync(join(PACKAGES_DIR, "music", "pages", "play.json"), "utf8")) as { body: Array<{ main: Array<Record<string, unknown>> }> };
    const creationHeader = page.body[0]?.main.find((node) => node.type === "creation_header");
    expect(creationHeader).toMatchObject({ type: "creation_header", variant: "byline" });
  });
});
