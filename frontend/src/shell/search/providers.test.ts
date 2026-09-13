import { describe, test, expect, mock } from "bun:test";
import { runSearchProviders } from "@/shell/search/providers";

// One provider is independent and best-effort of every other (`step 6:
// "a failing provider contributes nothing"`), so each test here stubs
// only the endpoints that provider itself touches, leaving every other
// endpoint to fail (the catch-all throw below) - a passing test proves
// the OTHER providers never got called for something they shouldn't
// need, not just that the one under test works in isolation.
function stubFetch(routes: Record<string, unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return Promise.resolve(Response.json(body));
    }
    return Promise.reject(new Error(`unstubbed fetch in this test: ${url}`));
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

function findGroup(groups: Awaited<ReturnType<typeof runSearchProviders>>, heading: string) {
  return groups.find((g) => g.heading === heading);
}

describe("runSearchProviders - apps", () => {
  test("matches an app by its name", async () => {
    const restore = stubFetch({});
    try {
      const groups = await runSearchProviders("chat");
      const apps = findGroup(groups, "Apps");
      expect(apps?.items.map((i) => i.label)).toContain("Chat");
    } finally {
      restore();
    }
  });

  test("matches Settings by name", async () => {
    const restore = stubFetch({});
    try {
      const groups = await runSearchProviders("settings");
      const apps = findGroup(groups, "Apps");
      expect(apps?.items.map((i) => i.label)).toContain("Settings");
    } finally {
      restore();
    }
  });
});

describe("runSearchProviders - pages", () => {
  test("the Apps library page matches 'apps' even with no query typed yet", async () => {
    const restore = stubFetch({});
    try {
      const groups = await runSearchProviders("");
      const pages = findGroup(groups, "Pages");
      expect(pages?.items).toEqual([{ id: "page:/apps", label: "Apps", icon: "layout-grid", to: "/apps" }]);
    } finally {
      restore();
    }
  });
});

describe("runSearchProviders - people", () => {
  test("matches a household member by display name", async () => {
    const restore = stubFetch({
      "/api/people": [{ id: "person-marlow1", display_name: "Marlow", nickname: null, role: "teen" }],
    });
    try {
      const groups = await runSearchProviders("marlow");
      const people = findGroup(groups, "People");
      expect(people?.items).toEqual([{ id: "person:person-marlow1", label: "Marlow", sublabel: "teen", icon: "users", to: "/people" }]);
    } finally {
      restore();
    }
  });

  test("a failed people fetch contributes nothing, not an error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/people")) return Promise.reject(new Error("network down"));
      return Promise.resolve(Response.json([]));
    }) as unknown as typeof fetch;
    try {
      const groups = await runSearchProviders("marlow");
      expect(findGroup(groups, "People")).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("runSearchProviders - memories", () => {
  test("matches a memory by its text", async () => {
    const restore = stubFetch({
      "/api/memory": [{ id: "mem-1", text: "Loves hiking on weekends", category: "fact" }],
    });
    try {
      const groups = await runSearchProviders("hiking");
      const memories = findGroup(groups, "Memories");
      expect(memories?.items).toEqual([{ id: "memory:mem-1", label: "Loves hiking on weekends", sublabel: "fact", icon: "brain", to: "/memory?ids=mem-1" }]);
    } finally {
      restore();
    }
  });
});

describe("runSearchProviders - conversations", () => {
  // Lane 9, 2026-09-13: real per-thread routes exist now
  // (GET /api/conversations), replacing the earlier mocked single
  // "Chat" destination.
  test("matches a saved conversation by its title", async () => {
    const restore = stubFetch({
      "/api/conversations": [{ id: "conv-garden1", surface: "chat", companion_id: null, title: "Garden planning", turn_count: 4, last_turn_at: null, created_at: "2026-09-13T00:00:00.000Z" }],
    });
    try {
      const groups = await runSearchProviders("garden");
      const conversations = findGroup(groups, "Conversations");
      expect(conversations?.items).toEqual([{ id: "conversation:conv-garden1", label: "Garden planning", icon: "message-circle", to: "/chat?conversation=conv-garden1" }]);
    } finally {
      restore();
    }
  });

  test("an untitled conversation never matches (nothing to search on)", async () => {
    const restore = stubFetch({
      "/api/conversations": [{ id: "conv-untitled1", surface: "chat", companion_id: null, title: null, turn_count: 1, last_turn_at: null, created_at: "2026-09-13T00:00:00.000Z" }],
    });
    try {
      const groups = await runSearchProviders("untitled");
      expect(findGroup(groups, "Conversations")).toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe("runSearchProviders - settings", () => {
  test("matches a settings key by its label", async () => {
    const restore = stubFetch({
      "/api/settings/registry": [{ key: "household.home_place", label: "Household location", help: "Where your household is, for weather and time.", scope: "household", level: "basic" }],
    });
    try {
      const groups = await runSearchProviders("location");
      const settings = findGroup(groups, "Settings");
      expect(settings?.items).toEqual([{ id: "setting:household.home_place", label: "Household location", sublabel: "Where your household is, for weather and time.", icon: "settings", to: "/settings" }]);
    } finally {
      restore();
    }
  });
});

describe("runSearchProviders - commands", () => {
  test("matches a saved command by its trigger phrase", async () => {
    const restore = stubFetch({
      "/api/commands": [{ id: "cmd-1", trigger: "movie night", action: { type: "say", text: "Starting movie night mode." } }],
    });
    try {
      const groups = await runSearchProviders("movie");
      const commands = findGroup(groups, "Commands");
      expect(commands?.items).toEqual([{ id: "command:cmd-1", label: "movie night", icon: "sparkles", to: "/settings" }]);
    } finally {
      restore();
    }
  });
});
