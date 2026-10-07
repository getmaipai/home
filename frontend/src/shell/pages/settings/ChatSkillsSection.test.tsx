import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor, within } from "@testing-library/react";
import { ChatSkillsSection } from "@/shell/pages/settings/ChatSkillsSection";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

// SKILLS-PAGE-01: the Skills section of Chat settings shows the skills a
// person's chat can use, the ones Home ships and the ones added to this
// home. A child has none.

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role,
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  } as Roster;
}

const skill = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: `${name} does a thing.`,
  kind: "plugin",
  origin: "bundled",
  used_in_chat: false,
  status: "enabled",
  ...extra,
});

function withSkills<T>(rows: unknown[], fn: (calls: string[]) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/api/plugins/skills")) return Promise.resolve(Response.json(rows));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  return fn(calls).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

describe("ChatSkillsSection", () => {
  test("lists included skills with their state, in chat first", async () => {
    await withSkills([skill("joke", "Joke"), skill("weather", "Weather", { used_in_chat: true }), skill("storytime-style", "Storytime style", { kind: "skill" })], async () => {
      const view = renderWithQueryClient(<ChatSkillsSection person={makePerson("adult")} />);
      await view.findByText("Weather");
      const rows = [...view.container.querySelectorAll("[data-skill-id]")].map((el) => el.getAttribute("data-skill-id"));
      expect(rows).toEqual(["weather", "joke", "storytime-style"]);
      const weather = view.container.querySelector('[data-skill-id="weather"]') as HTMLElement;
      expect(within(weather).getByText("Used in chat")).toBeTruthy();
      expect(within(weather).getByText("Weather does a thing.")).toBeTruthy();
      const joke = view.container.querySelector('[data-skill-id="joke"]') as HTMLElement;
      expect(within(joke).getByText("Not used in chat yet")).toBeTruthy();
    });
  });

  test("with nothing added, Added to this home says how skills get there", async () => {
    await withSkills([skill("weather", "Weather", { used_in_chat: true })], async () => {
      const view = renderWithQueryClient(<ChatSkillsSection person={makePerson("adult")} />);
      await view.findByText("No skills added yet");
      expect(view.getByText(/Skills added from the MaiPai Catalog will show up here/)).toBeTruthy();
    });
  });

  test("a package added from the catalog lists under Added to this home", async () => {
    await withSkills([skill("weather", "Weather"), skill("recipes", "Recipes", { origin: "store" })], async () => {
      const view = renderWithQueryClient(<ChatSkillsSection person={makePerson("adult")} />);
      await view.findByText("Recipes");
      expect(view.queryByText("No skills added yet")).toBeNull();
    });
  });

  test("a teen sees the minor wording", async () => {
    await withSkills([skill("joke", "Joke")], async () => {
      const view = renderWithQueryClient(<ChatSkillsSection person={makePerson("teen")} />);
      await view.findByText("Not used in your chats");
      expect(view.queryByText("Not used in chat yet")).toBeNull();
    });
  });

  test("a child gets nothing and the skills are never fetched", async () => {
    await withSkills([skill("joke", "Joke")], async (calls) => {
      const view = renderWithQueryClient(<ChatSkillsSection person={makePerson("child")} />);
      await waitFor(() => expect(view.container.textContent).toBe(""));
      expect(calls.some((url) => url.includes("/api/plugins/skills"))).toBe(false);
    });
  });
});
