// APP-SET-02: the settings route, end to end at the page: the role and band
// matrix as drawn, the redirects, the requests the page makes, the deep link
// and the rail (RULES S3) on a settings route.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import RailProfileMenu from "@maipai/ui/src/dashboard/layouts/full/vertical/rail/RailProfileMenu";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { CustomizeRedirect, SettingsEntryRedirect } from "@/shell/pages/settings/SettingsEntryRedirect";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { makePerson, mockHome, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import type { Roster } from "@/lib/api";

const originalMatchMedia = window.matchMedia;
const originalWidth = window.innerWidth;
let fixture: HomeFixture | null = null;

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.removeItem("maipai.chat.rail-collapsed");
  fixture?.restore();
  fixture = null;
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

function Where() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="where">{pathname}{search}{hash}</output>;
}

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width") && width <= 768,
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function open(person: Roster, url: string, home: Parameters<typeof mockHome>[0] = {}, width = 1440) {
  setWidth(width);
  fixture = mockHome(home);
  const view = renderWithQueryClient(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route element={<FullLayout rail railProfile={<RailProfileMenu displayName={person.display_name} subtitle={person.role} settingsHref="/settings" helpHref="https://example.com/help" onLogout={() => {}} />} />}>
          <Route path="settings" element={<SettingsEntryRedirect person={person} />} />
          <Route path="settings/:area/:section?" element={<SettingsAreaPage person={person} onPersonChange={() => {}} />} />
          <Route path="customize" element={<CustomizeRedirect person={person} />} />
          <Route path="chat" element={<h1>Chat</h1>} />
          <Route path="status" element={<h1>Status</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return Object.assign(view, within(document.body));
}

const where = (view: ReturnType<typeof open>) => view.getByTestId("where").textContent;
const column = (_view: ReturnType<typeof open>) => document.body.querySelector<HTMLElement>('[data-slot="settings-column"]')!;
const rows = (view: ReturnType<typeof open>) => [...within(column(view)).queryAllByRole("link")]
  .filter((link) => link.textContent?.trim() !== "Back to app")
  .map((link) => link.textContent?.trim());

describe("the settings route", () => {
  test("an adult asking for Home settings is replaced to Account and no household request is made", async () => {
    const adult = makePerson("adult");
    const view = open(adult, "/settings/home/ai");
    await waitFor(() => expect(where(view)).toBe("/settings/account/profile"));
    await waitFor(() => expect(rows(view)).toContain("Profile"));
    expect(fixture!.scopes).not.toContain("household");
    expect(fixture!.requests.filter((r) => r.includes("scope=household"))).toEqual([]);
    expect(rows(view)).not.toContain("Storage and backups");
  });

  test("an owner opens Home settings on General and sees every Home section", async () => {
    const view = open(makePerson("owner"), "/settings/home");
    await waitFor(() => expect(where(view)).toBe("/settings/home/general"));
    await waitFor(() => expect(rows(view)).toContain("Maintenance"));
    expect(rows(view)).toEqual(["General", "People", "Search", "Integrations", "AI", "Storage and backups", "Maintenance", "Privacy"]);
    expect(view.getByRole("heading", { level: 1, name: /^General$/ })).toBeTruthy();
  });

  test("a section the viewer may not see replaces to the first visible one, naming nothing", async () => {
    const view = open(makePerson("child"), "/settings/chat/skills");
    await waitFor(() => expect(where(view)).toBe("/settings/chat/general"));
    expect(rows(view)).not.toContain("Skills");
    cleanup();
    fixture!.restore();
    const unknown = open(makePerson("adult"), "/settings/chat/not-a-section");
    await waitFor(() => expect(where(unknown)).toContain("/settings/chat/general"));
  });

  test("/settings/<area> opens the area's first visible section on a desktop", async () => {
    const view = open(makePerson("teen"), "/settings/chat");
    await waitFor(() => expect(where(view)).toBe("/settings/chat/general"));
  });

  test("on a phone /settings/<area> shows the column alone, with its search and rows", async () => {
    const view = open(makePerson("adult"), "/settings/chat", {}, 390);
    await waitFor(() => expect(rows(view)).toContain("Keyboard shortcuts"));
    expect(where(view)).toBe("/settings/chat");
    expect(view.getByRole("searchbox", { name: "Search" })).toBeTruthy();
    expect(column(view).inert).toBe(false);
    expect(view.queryByRole("button", { name: /settings sidebar/ })).toBeNull();
  });

  test("an arrow row opened directly goes where it points", async () => {
    const view = open(makePerson("adult"), "/settings/chat/voice");
    await waitFor(() => expect(where(view)).toBe("/settings/account/voice"));
  });

  test("the Memories row opens the viewer's own page, resolved from their own id", async () => {
    const view = open(makePerson("adult"), "/settings/chat/general");
    await waitFor(() => expect(rows(view)).toContain("Memories"));
    const memories = within(column(view)).getByRole("link", { name: /Memories/ });
    expect(memories.getAttribute("href")).toBe("/people/person-adult?tab=memories");
  });

  test("Back to app returns to the remembered app route, falling back to Chat", async () => {
    window.sessionStorage.setItem("maipai.settings.last-app-route", "/status?tab=system");
    const remembered = open(makePerson("adult"), "/settings/chat/general");
    const back = await remembered.findByRole("link", { name: "Back to app" });
    expect(back.getAttribute("href")).toBe("/status?tab=system");
    fireEvent.click(back);
    await waitFor(() => expect(where(remembered)).toBe("/status?tab=system"));

    cleanup();
    fixture!.restore();
    window.sessionStorage.clear();
    const fallback = open(makePerson("adult"), "/settings/chat/general");
    const fallbackLink = await fallback.findByRole("link", { name: "Back to app" });
    expect(fallbackLink.getAttribute("href")).toBe("/chat");
    fireEvent.click(fallbackLink);
    await waitFor(() => expect(where(fallback)).toBe("/chat"));
  });

  test("the desktop hide control, content-header control, and Cmd/Ctrl+B share the remembered state", async () => {
    window.localStorage.removeItem("maipai.chat.rail-collapsed");
    const view = open(makePerson("adult"), "/settings/chat/general");
    const columnToggle = await view.findByRole("button", { name: "Hide settings sidebar" });
    fireEvent.click(columnToggle);
    await waitFor(() => expect(view.getByRole("button", { name: "Show settings sidebar" })).toBeTruthy());
    expect(window.localStorage.getItem("maipai.chat.rail-collapsed")).toBe("1");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    await waitFor(() => expect(view.getByRole("button", { name: "Hide settings sidebar" })).toBeTruthy());
    expect(window.localStorage.getItem("maipai.chat.rail-collapsed")).toBe("0");
  });
});

describe("what a band is shown", () => {
  test("a teen sees the chat photo switch but neither Show pictures in answers nor any household row", async () => {
    const view = open(makePerson("teen"), "/settings/chat/general");
    await waitFor(() => expect(view.getByText("Send photos in chat")).toBeTruthy());
    expect(view.queryByText("Show pictures in answers")).toBeNull();
    expect(view.queryByText("How a teen's replies are checked")).toBeNull();
    expect(rows(view)).not.toContain("Household chat");
  });

  test("a child sees safe search but not the chat card, Skills or Parental controls", async () => {
    const view = open(makePerson("child"), "/settings/chat/general", { hasChild: true });
    await waitFor(() => expect(view.getByText("Safe search level")).toBeTruthy());
    expect(view.queryByText("Send photos in chat")).toBeNull();
    expect(rows(view)).not.toContain("Skills");
    expect(rows(view)).not.toContain("Parental controls");
  });

  test("Parental controls shows for an adult account with a child in the home, and never without one", async () => {
    const withChild = open(makePerson("adult"), "/settings/chat/general", { hasChild: true });
    await waitFor(() => expect(rows(withChild)).toContain("Parental controls"));
    cleanup();
    const without = open(makePerson("adult"), "/settings/chat/general", { hasChild: false });
    await waitFor(() => expect(rows(without)).toContain("Memories"));
    expect(rows(without)).not.toContain("Parental controls");
  });

  test("an adult sees the wake word device section only once its assets are installed", async () => {
    const without = open(makePerson("adult"), "/settings/account/profile");
    await waitFor(() => expect(rows(without)).toContain("Voice"));
    expect(rows(without)).not.toContain("This device");
    cleanup();
    fixture!.restore();
    const withAssets = open(makePerson("adult"), "/settings/account/profile", { wakeword: true });
    await waitFor(() => expect(rows(withAssets)).toContain("This device"));
  });

  test("the Robot section is an adult's or admin's and only with a paired robot", async () => {
    const adult = open(makePerson("adult"), "/settings/account/profile", { robots: true });
    await waitFor(() => expect(rows(adult)).toContain("Robot"));
    cleanup();
    fixture!.restore();
    const teen = open(makePerson("teen"), "/settings/account/profile", { robots: true });
    await waitFor(() => expect(rows(teen)).toContain("Voice"));
    expect(rows(teen)).not.toContain("Robot");
  });
});

describe("what the page asks for", () => {
  test("it reads only the viewer's own person scope, and the household scope for an admin on Home settings", async () => {
    const teen = open(makePerson("teen"), "/settings/account/notifications");
    await waitFor(() => expect(teen.getByText("Show alerts on this device")).toBeTruthy());
    expect(fixture!.scopes.every((scope) => scope === "person:person-teen")).toBe(true);
    cleanup();
    fixture!.restore();
    const owner = open(makePerson("owner"), "/settings/home/general");
    await waitFor(() => expect(owner.getByText("Family name")).toBeTruthy());
    expect(fixture!.scopes.every((scope) => scope === "household")).toBe(true);
    expect(fixture!.requests.some((r) => /scope=person%3A(?!person-owner)/.test(r))).toBe(false);
  });

  test("a #<key> deep link scrolls to the row and focuses its control", async () => {
    open(makePerson("adult"), "/settings/chat/general#chat.photo_uploads");
    await waitFor(() => {
      const row = document.body.querySelector('[data-setting-key="chat.photo_uploads"]');
      expect(row).toBeTruthy();
      expect(row!.contains(document.activeElement)).toBe(true);
    });
  });

  test("a search in the column lists matching rows under a section / card breadcrumb, and Escape clears it", async () => {
    const view = open(makePerson("adult"), "/settings/chat/general");
    await waitFor(() => expect(view.getByText("Send photos in chat")).toBeTruthy());
    fireEvent.change(view.getByRole("searchbox", { name: "Search" }), { target: { value: "safe" } });
    await waitFor(() => expect(where(view)).toContain("q=safe"));
    await waitFor(() => expect(view.getByText("General / Search")).toBeTruthy());
    fireEvent.keyDown(view.getByRole("searchbox", { name: "Search" }), { key: "Escape" });
    await waitFor(() => expect(where(view)).not.toContain("q="));
  });

  test("a search with no match says so", async () => {
    const view = open(makePerson("adult"), "/settings/chat/general");
    await waitFor(() => expect(view.getByText("Send photos in chat")).toBeTruthy());
    fireEvent.change(view.getByRole("searchbox", { name: "Search" }), { target: { value: "zzzz-nothing" } });
    await waitFor(() => expect(view.getByText("No settings match that search.")).toBeTruthy());
  });
});

describe("the rail on a settings route (RULES S3)", () => {
  for (const width of [1440, 390]) {
    test(`the main navigation renders on /settings/chat at ${width}px`, async () => {
      const view = open(makePerson("adult"), width === 1440 ? "/settings/chat/general" : "/settings/chat", {}, width);
      const rail = view.getByRole("navigation", { name: "Primary navigation" });
      expect(rail.className).toContain("w-14");
      for (const label of ["Home", "Chat", "Library", "Family"]) await waitFor(() => expect(view.getByRole("link", { name: label })).toBeTruthy());
      expect(view.getByRole("button", { name: /Open profile menu for Adult/ })).toBeTruthy();
      await waitFor(() => expect(column(view)).toBeTruthy());
    });
  }
});

describe("old URLs through the route", () => {
  test("/settings?tab=household&section=ai as an admin replaces to Home settings AI", async () => {
    const view = open(makePerson("admin"), "/settings?tab=household&section=ai");
    await waitFor(() => expect(where(view)).toBe("/settings/home/ai"));
  });

  test("/settings?tab=household as an adult replaces to Account with no household request", async () => {
    const view = open(makePerson("adult"), "/settings?tab=household&section=ai");
    await waitFor(() => expect(where(view)).toBe("/settings/account/profile"));
    expect(fixture!.scopes).not.toContain("household");
  });

  test("an old search link names a group and lands at its first key", async () => {
    const view = open(makePerson("owner"), "/settings?tab=household&section=household.search");
    await waitFor(() => expect(where(view)).toMatch(/^\/settings\/home\/search#search\./));
  });

  test("/customize lands on Skills for an adult and on Chat settings for a child", async () => {
    const adult = open(makePerson("adult"), "/customize");
    await waitFor(() => expect(where(adult)).toBe("/settings/chat/skills"));
    cleanup();
    fixture!.restore();
    const child = open(makePerson("child"), "/customize");
    await waitFor(() => expect(where(child)).toBe("/settings/chat/general"));
  });
});
