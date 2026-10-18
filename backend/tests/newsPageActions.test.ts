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
  for (const file of ["index.json", "mix.json", "search.json"]) {
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

describe("the search box (NEWS-LOOK-02)", () => {
  const page = (name: string) => JSON.parse(readFileSync(join(PAGES, name), "utf-8")) as { body: Node[] };

  test("every story page opens on a search box that navigates to the Search page with the query", () => {
    for (const file of ["index.json", "mix.json", "following.json", "saved.json", "channel.json", "story.json"]) {
      expect(page(file).body[0], file).toEqual({ type: "search", state: "q", placeholder: "Search News", submit: { navigate: { to: "/apps/news/search", state: { q: "{q}" } } } });
    }
  });

  test("the Search page records a search with its text, clears with no body, and reads its results from q and the chip", () => {
    const [field, results] = page("search.json").body as [Node, Node];
    expect((field.submit as { call: { target: string; args: Node } }).call).toEqual({ target: "/api/plugins/news/actions/search_recent", args: { q: "{q}" } });
    expect((field.clear_recents as { call: { target: string } }).call.target).toBe("/api/plugins/news/actions/search_recent_clear");
    expect(field.recents).toEqual({ source: "package", path: "search-recents" });
    expect(results.bind).toEqual({ source: "package", path: "search", params: { q: "$state.q", topic: "$state.topic" } });
    expect(results.filter_state).toBe("topic");
    expect(Object.keys(results.actions as Node).sort()).toEqual(["follow", "open", "open_channel", "save"]);
  });

  test("Today and My Mix pass the chosen topic chip to their data", () => {
    for (const file of ["index.json", "mix.json"]) {
      const feed = page(file).body.find((node) => node.type === "answer_blocks")!;
      expect(feed.filter_state, file).toBe("topic");
      expect((feed.bind as { params: Node }).params, file).toEqual({ topic: "$state.topic" });
    }
  });
});
