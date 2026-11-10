import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { todaySlots } from "@/shell/pages/dashboard/TodaySection";
import { DashboardPage } from "@/shell/pages/DashboardPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createQueryClient } from "@/lib/queryClient";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import type { HomeWidgets, InstallStatusView, Roster, SetupChecklistItem, WidgetData, WidgetDescriptor } from "@/lib/api";

afterEach(() => {
  cleanup();
});

function makePerson(role: Roster["role"] = "owner"): Roster {
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
  };
}

const checklistItem = (id: string, done: boolean): SetupChecklistItem => ({ id, title: `Step ${id}`, reason: "Because.", done, open: { label: "Open", href: `/settings/${id}` } });
const widget = (id: string, title = `Widget ${id}`): WidgetDescriptor => ({ package: "pkg", id, title, size: "card", refresh_s: 300 });
const data = (title: string): WidgetData => ({ as_of: "2026-10-17T12:00:00.000Z", items: [{ title, subtitle: "Sub", value: "72" }] });

interface Mocks {
  checklist?: SetupChecklistItem[];
  widgets?: WidgetDescriptor[];
  home?: HomeWidgets;
  widgetData?: Record<string, WidgetData | "fail">;
  install?: Partial<InstallStatusView>;
  chat?: "ready" | "starting";
  layout?: "ask" | "board" | "shelves";
  family?: string;
  repairs?: unknown[];
  updates?: unknown;
  continue?: unknown[];
}

function mockFetch(mocks: Mocks = {}) {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    // The real route refuses a key filter for this key (400 "unsupported settings key filter"); Home must read the whole list.
    if (url.includes("/api/settings") && url.includes("key=")) return Promise.resolve(new Response(JSON.stringify({ error: "unsupported settings key filter" }), { status: 400 }));
    if (url.includes("/api/settings")) return Promise.resolve(Response.json([
      ...(mocks.layout ? [{ key: "ui.home_layout", value: mocks.layout, layer: "person", source: "user" }] : []),
      ...(mocks.family !== undefined ? [{ key: "household.family_name", value: mocks.family, layer: "household", source: "user" }] : []),
    ]));
    if (url.includes("/api/repairs")) return Promise.resolve(Response.json(mocks.repairs ?? []));
    if (url.includes("/api/updates")) return Promise.resolve(Response.json(mocks.updates ?? { installed: "1.0.0", latest: "1.0.0", checkedAt: null, summary: null, error: null }));
    if (url.includes("/api/setup-checklist")) return Promise.resolve(Response.json(mocks.checklist ?? []));
    if (url.includes("/api/install")) return Promise.resolve(Response.json({ state: "none", ...mocks.install }));
    if (url.includes("/api/widgets/") && url.endsWith("/data")) {
      const id = decodeURIComponent(url.split("/").at(-2) ?? "");
      const body = mocks.widgetData?.[id];
      if (body === "fail" || body === undefined) return Promise.resolve(new Response(JSON.stringify({ error: "no" }), { status: 400 }));
      return Promise.resolve(Response.json(body));
    }
    if (url.includes("/api/widgets/home")) return Promise.resolve(Response.json(mocks.home ?? { hero: null, cards: mocks.widgets ?? [], more: [] }));
    if (url.includes("/api/widgets")) return Promise.resolve(Response.json(mocks.widgets ?? []));
    if (url.includes("/api/people")) return Promise.resolve(Response.json([{ id: "person-abc123", display_name: "Nova", role: "owner" }]));
    if (url.includes("/api/continue")) return Promise.resolve(Response.json({ rows: mocks.continue ?? [] }));
    if (url.includes("/api/health")) {
      return Promise.resolve(Response.json({ ok: true, engines: { chat: mocks.chat === "starting" ? { state: "down", kind: "starting", reason: "ai_installing" } : { state: "up" } } }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, restore: () => { globalThis.fetch = originalFetch; } };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}{location.search}</p>;
}

function renderHome(person: Roster) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<DashboardPage person={person} />} />
        <Route path="/chat" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const hrefOf = (label: string) => Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.trim() === label)?.getAttribute("href") ?? undefined;
const urls = (fetchMock: ReturnType<typeof mock>) => fetchMock.mock.calls.map(([input]) => (typeof input === "string" ? input : String(input)));

describe("DashboardPage (Home)", () => {
  test("the household's family name shows above the greeting as '<name> Family' (DOCS-GAP-04)", async () => {
    const { restore } = mockFetch({ layout: "ask", family: "Willow" });
    try {
      const view = renderHome(makePerson("adult"));
      await view.findByText("Willow Family");
    } finally { restore(); }
  });

  test("no family name set shows only the greeting", async () => {
    const { restore } = mockFetch({ layout: "ask" });
    try {
      const view = renderHome(makePerson("adult"));
      await view.findByRole("button", { name: /Ask|Send/i }).catch(() => undefined);
      expect(view.queryByText(/ Family$/)).toBeNull();
    } finally { restore(); }
  });

  test("the greeting uses the semantic hero type", async () => {
    const { restore } = mockFetch({ layout: "ask" });
    try {
      const view = renderHome(makePerson("adult"));
      const greeting = await view.findByText(/Good .*Nova/);
      expect(greeting.className).toContain("text-hero");
    } finally { restore(); }
  });

  test("keeps the home block order in one layout function", async () => {
    const { homeBlocks } = await import("@/shell/pages/dashboard/homeBlocks");
    expect(homeBlocks("ask")).toEqual(["greeting", "admin", "ask", "today_chips", "pick_up", "family", "getting_started"]);
    expect(homeBlocks("board")).toEqual(["greeting", "admin", "hero", "ask", "pick_up", "today", "family", "getting_started"]);
    expect(homeBlocks("shelves")).toEqual(["greeting", "admin", "ask", "media_continue", "today", "media_new", "media_made", "getting_started"]);
    expect(homeBlocks("shelves", false)).toEqual(homeBlocks("ask"));
  });

  test("Ask first draws Today as chips; a chip opens its card and a second tap closes it", async () => {
    const weather = { ...widget("a", "Weather"), package: "weather" };
    const { restore } = mockFetch({ layout: "ask", home: { hero: null, cards: [weather], more: [] }, widgets: [weather], widgetData: { a: data("Row a") } });
    try {
      const view = renderHome(makePerson("adult"));
      const chip = await view.findByRole("button", { name: "Weather" });
      expect(chip.className).toContain("inline-flex h-10");
      expect(chip.closest('[data-testid="home-suggestions"]')).toBeNull();
      expect(view.queryByTestId("home-today-card")).toBeNull();
      fireEvent.click(chip);
      await view.findByTestId("home-today-card");
      fireEvent.click(chip);
      expect(view.queryByTestId("home-today-card")).toBeNull();
    } finally { restore(); }
  });

  test("coming back to Home after changing the layout in Settings shows the new layout, not the cached one", async () => {
    const queryClient = createQueryClient();
    const tree = () => (
      <QueryClientProvider client={queryClient}><TooltipProvider>
        <MemoryRouter initialEntries={["/"]}><Routes><Route path="/" element={<DashboardPage person={makePerson("adult")} />} /></Routes></MemoryRouter>
      </TooltipProvider></QueryClientProvider>
    );
    const board = mockFetch({ layout: "board", home: { hero: null, cards: [widget("a", "Weather")], more: [] }, widgets: [widget("a", "Weather")], widgetData: { a: data("Row a") } });
    const first = render(tree());
    await first.findByTestId("home-today-card");
    first.unmount();
    board.restore();
    // The Settings write refreshes the person's shared settings read (SettingsRenderer sets it; a test with no write invalidates it).
    await queryClient.invalidateQueries({ queryKey: ["settings-values"] });
    const ask = mockFetch({ layout: "ask", home: { hero: null, cards: [widget("a", "Weather")], more: [] }, widgets: [widget("a", "Weather")], widgetData: { a: data("Row a") } });
    try {
      const second = render(tree());
      await second.findByRole("button", { name: "Weather" });
      expect(second.queryByTestId("home-today-card")).toBeNull();
    } finally { ask.restore(); }
  });

  test("Today board draws the cards themselves, not chips", async () => {
    const weather = { ...widget("a", "Weather"), package: "weather" };
    const { restore } = mockFetch({ layout: "board", home: { hero: null, cards: [weather], more: [] }, widgets: [weather], widgetData: { a: data("Row a") } });
    try {
      const view = renderHome(makePerson("adult"));
      await view.findByTestId("home-today-card");
      expect(view.queryByRole("button", { name: "Weather" })).toBeNull();
    } finally { restore(); }
  });

  test("a sentence-only empty shopping list card is hidden from a non-admin", async () => {
    const shopping = { ...widget("shopping", "Shopping List"), package: "remind" };
    const { restore } = mockFetch({ layout: "board", home: { hero: null, cards: [shopping], more: [] }, widgets: [shopping], widgetData: { shopping: { as_of: "2026-10-17T12:00:00.000Z", items: [{ title: "Your shopping list is empty." }] } } });
    try {
      const view = renderHome(makePerson("adult"));
      await waitFor(() => expect(view.queryByTestId("home-today-card")).toBeNull());
      expect(view.queryByText("Shopping List")).toBeNull();
    } finally { restore(); }
  });

  test("the Home page has no layout gear in its body or header", async () => {
    const { restore } = mockFetch();
    try {
      const view = renderHome(makePerson("owner"));
      await view.findByText(/Good/);
      expect(view.queryByRole("link", { name: "Home layout" })).toBeNull();
      expect(view.queryByRole("button", { name: "Home layout" })).toBeNull();
    } finally { restore(); }
  });

  test("shows skeletons on first paint", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    try {
      const view = renderHome(makePerson("adult"));
      expect(view.getByRole("status", { name: "Loading Home" })).toBeDefined();
    } finally { globalThis.fetch = originalFetch; }
  });

  test("guest sees greeting, Ask and Today only", async () => {
    const { restore } = mockFetch({ widgets: [widget("weather", "Weather")], widgetData: { weather: data("Sunny") }, checklist: [checklistItem("x", false)] });
    try {
      const view = renderHome(makePerson("guest"));
      await view.findByText("Weather");
      expect(view.getByRole("textbox", { name: "Ask" })).toBeDefined();
      expect(view.queryByText("Getting started")).toBeNull();
      expect(view.queryByText("Pick up where you left off")).toBeNull();
      expect(view.queryByText("Your family")).toBeNull();
      expect(hrefOf("Updates")).toBeUndefined();
    } finally { restore(); }
  });

  test("greets the person, asks first, and drops the old numbers and activity log", async () => {
    const { restore } = mockFetch();
    try {
      const view = renderHome(makePerson("adult"));
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      expect(document.body.textContent).toContain("Here is your household today.");
      expect(view.getByRole("textbox", { name: "Ask" })).toBeDefined();
      expect(document.body.textContent).not.toMatch(/Recent activity|People|Up to date|\b(Turns|Engines|Stack)\b/);
    } finally {
      restore();
    }
  });

  test("a typed line opens Chat with the words in the address, unsent", async () => {
    const { restore } = mockFetch();
    try {
      const view = renderHome(makePerson("adult"));
      const box = await view.findByRole("textbox", { name: "Ask" });
      fireEvent.change(box, { target: { value: "What is for dinner?" } });
      fireEvent.click(view.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/chat?ask=What%20is%20for%20dinner%3F"));
    } finally {
      restore();
    }
  });

  test("an empty Ask does nothing and never disables the group (a disabled control fades the placeholder below WCAG contrast)", async () => {
    const { restore } = mockFetch();
    try {
      const view = renderHome(makePerson("adult"));
      await view.findByRole("textbox", { name: "Ask" });
      const ask = view.getByRole("button", { name: "Send" }) as HTMLButtonElement;
      expect(ask.disabled).toBe(false);
      expect(ask.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(ask);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(view.queryByTestId("where")).toBeNull();
      fireEvent.change(view.getByRole("textbox", { name: "Ask" }), { target: { value: "Hi" } });
      expect(ask.getAttribute("aria-disabled")).toBeNull();
    } finally {
      restore();
    }
  });

  test("three starters open Chat with their prompt", async () => {
    const { restore } = mockFetch();
    try {
      const view = renderHome(makePerson("adult"));
      const starters = (await view.findAllByRole("button")).filter((button) => /^(Plan|Explain|Write|Brainstorm) /.test(button.textContent ?? ""));
      expect(starters).toHaveLength(3);
      fireEvent.click(starters[0]!);
      await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/chat?ask=Help%20me%20plan%20a%20week%20of%20simple%20family%20dinners."));
    } finally {
      restore();
    }
  });

  test("while the AI installs the box shows the install strip's own line, the starters are off and the warming-up art shows", async () => {
    const { restore } = mockFetch({ chat: "starting", install: { state: "installing_engine", stageLabel: "Building the engine" } });
    try {
      const view = renderHome(makePerson("adult"));
      await waitFor(() => expect(view.getByRole("textbox", { name: "Ask" }).getAttribute("placeholder")).toBe("Building the engine"));
      const starters = Array.from(view.getByTestId("home-suggestions").children);
      expect(starters).toHaveLength(3);
      for (const starter of starters) {
        expect(starter.getAttribute("role")).toBeNull();
        expect(starter.querySelector("a")).toBeNull();
      }
      expect(view.container.querySelector('img[src="/setup-art/warming-up.webp"]')).not.toBeNull();
    } finally {
      restore();
    }
  });

  test("Today shows four cards and puts the rest behind More; a failed or fallback widget drops out", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const widgetData: Record<string, WidgetData | "fail"> = Object.fromEntries(ids.map((id) => [id, data(`Row ${id}`)]));
    widgetData.b = "fail";
    widgetData.c = { ...data("Fallback text"), degraded: true };
    widgetData.d = { as_of: "2026-10-17T12:00:00.000Z", items: [] };
    const { restore } = mockFetch({ layout: "board", home: { hero: null, cards: ids.slice(0, 4).map((id) => ({ ...widget(id), package: "weather" })), more: ids.slice(4).map((id) => ({ ...widget(id), package: "weather" })) }, widgets: ids.map((id) => ({ ...widget(id), package: "weather" })), widgetData });
    try {
      const view = renderHome(makePerson("adult"));
      await waitFor(() => expect(view.getAllByTestId("home-today-card").length).toBe(4));
      expect(document.body.textContent).not.toContain("Fallback text");
      expect(document.body.textContent).not.toContain("Widget b");
      expect(view.queryByRole("button", { name: "More" })).toBeNull();
      view.unmount();
    } finally {
      restore();
    }
    const many = ["a", "b", "c", "d", "e", "f"];
    const second = mockFetch({ layout: "board", home: { hero: null, cards: many.slice(0, 4).map((id) => ({ ...widget(id), package: "weather" })), more: many.slice(4).map((id) => ({ ...widget(id), package: "weather" })) }, widgets: many.map((id) => ({ ...widget(id), package: "weather" })), widgetData: Object.fromEntries(many.map((id) => [id, data(`Row ${id}`)])) });
    try {
      const view = renderHome(makePerson("adult"));
      const more = await view.findByRole("button", { name: "More" });
      expect(view.getAllByTestId("home-today-card").length).toBe(4);
      fireEvent.click(more);
      await waitFor(() => expect(view.getAllByTestId("home-today-card").length).toBe(6));
    } finally {
      second.restore();
    }
  });

  test("a card with data shows a quiet 'Updated ... ago' line, in the warning tone once it is over three refresh intervals old", async () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const { restore } = mockFetch({ layout: "board", widgets: [{ ...widget("fresh", "Fresh"), package: "weather" }, { ...widget("old", "Old"), package: "weather" }], widgetData: {
      fresh: { as_of: ago(4), items: [{ title: "Row fresh" }] },
      old: { as_of: ago(120), items: [{ title: "Row old" }] },
    } });
    try {
      const view = renderHome(makePerson("adult"));
      await waitFor(() => expect(view.getAllByTestId("home-today-updated").length).toBe(2));
      const [fresh, old] = view.getAllByTestId("home-today-updated");
      expect(fresh!.textContent).toBe("Updated 4 minutes ago");
      expect(fresh!.getAttribute("data-old")).toBeNull();
      expect(fresh!.className).not.toContain("status-warning");
      expect(old!.textContent).toBe("Updated 2 hours ago");
      expect(old!.getAttribute("data-old")).toBe("true");
      expect(old!.className).toContain("text-status-warning-ink");
    } finally {
      restore();
    }
  });

  test("an item with a time shows it as a relative time ('in 25 minutes')", async () => {
    const at = new Date(Date.now() + 25 * 60_000 + 5_000).toISOString();
    const { restore } = mockFetch({ layout: "board", widgets: [{ ...widget("upcoming", "Next up"), package: "remind" }], widgetData: { upcoming: { as_of: new Date().toISOString(), items: [{ title: "Call Nadia", value: "6:00 PM", at }] } } });
    try {
      const view = renderHome(makePerson("adult"));
      await view.findByText("Call Nadia");
      expect(document.body.textContent).toContain("in 25 minutes");
      expect(document.body.textContent).not.toContain("6:00 PM");
    } finally {
      restore();
    }
  });

  test("a card that had data keeps it, marked stale, when a refresh fails or comes back degraded; one that never had data stays out", () => {
    const w = (id: string) => ({ ...widget(id), package: "weather" });
    const good = (title: string): WidgetData => ({ as_of: "2026-10-17T12:00:00.000Z", items: [{ title }] });
    const last = new Map<string, WidgetData>();
    const widgets = [w("a"), w("b"), w("c")];
    const first = todaySlots(widgets, [{ isPending: false, data: good("A") }, { isPending: false, data: good("B") }, { isPending: false, data: good("C") }], last);
    expect(first.map((slot) => slot.stale)).toEqual([false, false, false]);
    const later = todaySlots(widgets, [
      { isPending: false, isError: true, data: undefined },
      { isPending: false, data: { ...good("Fallback"), degraded: true } },
      { isPending: false, data: { as_of: "2026-10-17T13:00:00.000Z", items: [] } },
    ], last);
    expect(later.map((slot) => [slot.data.items[0]!.title, slot.stale])).toEqual([["A", true], ["B", true]]);
    const never = todaySlots([w("z")], [{ isPending: false, isError: true }], new Map());
    expect(never).toEqual([]);
  });

  test("a weather widget that carries a card draws the compact weather card in place of the text", async () => {
    const card = (await import("@maipai/spec/fixtures/answer-block/valid-weather_card.json")).default;
    const withCard: WidgetData = { ...data("Sunny"), card: card as unknown as Record<string, unknown> };
    const { restore } = mockFetch({ layout: "board", widgets: [{ ...widget("weather", "Weather"), package: "weather" }], widgetData: { weather: withCard } });
    try {
      const view = renderHome(makePerson("adult"));
      await view.findByTestId("home-today-card");
      expect(document.querySelector('[data-slot="weather-card"]')?.getAttribute("data-variant")).toBe("compact");
      expect(view.queryByText("Sub")).toBeNull();
      // A tap on the weather card opens the Weather app.
      expect(view.getByTestId("home-today-link").getAttribute("href")).toBe("/apps/weather");
    } finally {
      restore();
    }
  });

  test("a child sees only the widgets the server returns, and no admin links or setup steps", async () => {
    const { restore, fetchMock } = mockFetch({ widgets: [widget("weather", "Weather")], widgetData: { weather: data("Sunny") }, checklist: [checklistItem("family", false)] });
    try {
      const view = renderHome(makePerson("child"));
      await view.findByText("Weather");
      expect(hrefOf("Updates")).toBeUndefined();
      expect(hrefOf("Repairs")).toBeUndefined();
      expect(document.body.textContent).not.toContain("Getting started");
      expect(urls(fetchMock).some((url) => url.includes("/api/setup-checklist"))).toBe(false);
    } finally {
      restore();
    }
  });

  test("owner: admin links and the open setup steps, three at a time with a link to the rest", async () => {
    const { restore } = mockFetch({ checklist: ["a", "b", "c", "d", "e"].map((id) => checklistItem(id, id === "a")) });
    try {
      const view = renderHome(makePerson("owner"));
      await view.findByText("Getting started");
      await view.findByRole("button", { name: "Open Step b" });
      // Each row is a list item whose buttons name their step, so three rows never read as three identical "Open" / "Skip" pairs.
      const section = view.getByRole("region", { name: "Getting started" });
      expect(section.querySelectorAll('[role="listitem"]')).toHaveLength(3);
      expect(view.getAllByRole("button", { name: /^Skip Step / }).map((b) => b.textContent)).toEqual(["Skip Step b", "Skip Step c", "Skip Step d"]);
      expect(view.queryByText("Step a")).toBeNull();
      expect(view.queryByText("Step e")).toBeNull();
      expect(hrefOf("Show 1 more")).toBe("/settings/household?tab=general");
    } finally {
      restore();
    }
  });

  test("every Home control carries the kit's 48 px hit area (the row size) and the ask field sits in a hit-field label", async () => {
    const { restore } = mockFetch({ checklist: [checklistItem("a", false)] });
    try {
      const view = renderHome(makePerson("owner"));
      await view.findByRole("button", { name: "Open Step a" });
      for (const el of [view.getByRole("button", { name: "Open Step a" }), view.getByRole("button", { name: "Skip Step a" })]) {
        expect(el.className, el.textContent ?? "").toContain("cn-button-size-row");
      }
      expect(view.getByRole("button", { name: "Send" }).getAttribute("data-variant")).toBe("ghost");
      expect(view.getByLabelText("Ask").getAttribute("data-shape")).toBe("pill");
    } finally {
      restore();
    }
  });

  test("nothing open means no Getting started block", async () => {
    const { restore } = mockFetch({ checklist: [checklistItem("family", true)] });
    try {
      const view = renderHome(makePerson("owner"));
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(view.queryByText("Getting started")).toBeNull();
    } finally {
      restore();
    }
  });

  test("owner: Repairs and Updates show as status cards only while something is waiting", async () => {
    const quiet = mockFetch({ layout: "ask" });
    try {
      const view = renderHome(makePerson("owner"));
      await view.findByRole("textbox", { name: "Ask" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(view.queryByRole("navigation", { name: "Looking after your hub" })).toBeNull();
      cleanup();
    } finally { quiet.restore(); }
    const busy = mockFetch({ layout: "ask", repairs: [{ id: "i1" }], updates: { installed: "1.0.0", latest: "1.1.0", checkedAt: null, summary: null, error: null } });
    try {
      const view = renderHome(makePerson("owner"));
      await view.findByText("Something needs fixing");
      await view.findByText("An update is ready");
      fireEvent.click(view.getByRole("button", { name: "Repairs" }));
      expect(document.body.textContent).not.toContain("An update is ready");
    } finally { busy.restore(); }
  });

  test("an adult sees no status cards even when repairs are open", async () => {
    const { restore } = mockFetch({ layout: "ask", repairs: [{ id: "i1" }] });
    try {
      const view = renderHome(makePerson("adult"));
      await view.findByRole("textbox", { name: "Ask" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(view.queryByText("Something needs fixing")).toBeNull();
    } finally { restore(); }
  });

  test("Continue is compact shortcuts, and an empty one is a single quiet sentence", async () => {
    const rows = [{ source: "chat", kind: "chat", id: "c1", title: "Plan the trip", subtitle: null, href: "/chat?conversation=c1", at: "2026-11-09T00:00:00Z", percent: null, media_kind: null, artwork_url: null }];
    const full = mockFetch({ layout: "ask", continue: rows });
    try {
      const view = renderHome(makePerson("adult"));
      const link = await view.findByRole("link", { name: "Plan the trip" });
      expect(link.getAttribute("href")).toBe("/chat?conversation=c1");
      expect(view.getByRole("region", { name: "Continue" })).toBeDefined();
      cleanup();
    } finally { full.restore(); }
    const empty = mockFetch({ layout: "ask" });
    try {
      const view = renderHome(makePerson("adult"));
      await view.findByText("Nothing to pick up yet. Chats and things you play show up here.");
    } finally { empty.restore(); }
  });

  test("the greeting is sentence case with a theme-readable supporting line", async () => {
    const { restore } = mockFetch({ layout: "ask" });
    try {
      const view = renderHome(makePerson("adult"));
      const greeting = await view.findByText(/Good .*Nova/);
      expect(greeting.className).not.toContain("capitalize");
      expect(view.getByText("Here is your household today.").className).toContain("text-primary-foreground/80");
    } finally { restore(); }
  });
});
