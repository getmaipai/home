// Verification pass: every News page's Save, Follow and Less-like-this posted an empty body (the page action had a target and no
// `args`), so the route answered 404 or 400 and nothing saved or followed. The bundled pages now name the fields the route reads.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PAGES = join(import.meta.dir, "..", "packages", "news", "pages");
type Node = Record<string, unknown>;

function actionMaps(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) node.forEach((entry) => actionMaps(entry, out));
  else if (node && typeof node === "object") {
    const record = node as Node;
    if (record.actions && typeof record.actions === "object") out.push(record.actions as Node);
    Object.values(record).forEach((entry) => actionMaps(entry, out));
  }
  return out;
}

const NEEDS: Record<string, string[]> = { save: ["item_id", "on"], follow: ["kind", "key", "on"], feedback: ["item_id", "kind"] };

describe("the bundled News pages send a body with each call action", () => {
  for (const file of readdirSync(PAGES).filter((name) => name.endsWith(".json"))) {
    test(`${file}: save, follow and feedback carry the args the route reads`, () => {
      const page = JSON.parse(readFileSync(join(PAGES, file), "utf-8")) as unknown;
      for (const actions of actionMaps(page)) {
        for (const [name, fields] of Object.entries(NEEDS)) {
          const action = actions[name] as { call?: { args?: Record<string, unknown> } } | undefined;
          if (!action?.call) continue;
          expect(Object.keys(action.call.args ?? {}).sort(), `${file} ${name}`).toEqual([...fields].sort());
        }
      }
    });
  }
});

describe("a shelf's channel button has somewhere to go", () => {
  for (const file of ["index.json", "mix.json"]) {
    test(`${file}: open_channel navigates to the channel page with the channel's kind and key`, () => {
      const page = JSON.parse(readFileSync(join(PAGES, file), "utf-8")) as unknown;
      const maps = actionMaps(page).filter((actions) => actions.open !== undefined);
      expect(maps.length).toBeGreaterThan(0);
      for (const actions of maps) {
        expect(actions.open_channel).toEqual({ navigate: { to: "/apps/news/channel", state: { kind: "{channel_kind}", key: "{channel_key}" } } });
      }
    });
  }
});
