// APP-SET-02: the settings route, end to end at the page: the role and band
// matrix as drawn, the redirects, the requests the page makes, the deep link
// and the rail (RULES S3) on a settings route.
import { afterEach, describe, expect, test, mock } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import RailProfileMenu from "@maipai/ui/src/dashboard/layouts/full/vertical/rail/RailProfileMenu";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { CustomizeRedirect, LegacySettingsRedirect, SettingsEntryRedirect } from "@/shell/pages/settings/SettingsEntryRedirect";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { settingsArea } from "@/shell/pages/settings/settingsAreas";
import { activeAppHref, rememberLastAppRoute } from "@/shell/pages/settings/settingsBackLink";
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
    matches: query.includes("639.98") ? width < 640 : query.includes("max-width") && width <= 768,
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
        <Route path="setup/away" element={<h1>Away setup wizard</h1>} />
        <Route element={<FullLayout rail activeAppHref={activeAppHref(new URL(url, "http://home").pathname)} railProfile={<RailProfileMenu displayName={person.display_name} subtitle={person.role} settingsHref="/settings" helpHref="https://example.com/help" onLogout={() => {}} />} />}>
          <Route path="settings" element={<SettingsEntryRedirect person={person} />} />
          <Route path="settings/home/robot/:robotId" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/home" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/account" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/home/:legacySection" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/account/:legacySection" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/chat/:legacySection" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/:section?/:detailId?" element={<SettingsAreaPage person={person} onPersonChange={() => {}} />} />
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
const rows = (view: ReturnType<typeof open>) => [...within(column(view)).queryAllByRole("link")].filter((link) => !link.closest('[data-slot="settings-back-link"]')).map((link) => link.textContent?.trim());

describe("the settings route", () => {
  test("Not now writes the dismissal setting and leaves pinned apps byte-identical", async () => {
    const view = open(makePerson("owner"), "/settings/household?tab=general", {
      pinnedApps: ["existing-app"],
      setupChecklist: [
        { id: "family", title: "Add your family", reason: "Home works best when everyone has their own account.", done: false, open: { label: "Open People", href: "/settings/household?tab=people" } },
        { id: "backup-target", title: "Choose where backups go", reason: "A second place keeps a copy if this computer fails.", done: true, open: { label: "Open Storage and backups", href: "/settings/backups?tab=storage" } },
      ],
    });
    await waitFor(() => expect(view.getByText("1 thing left to finish setting up.")).toBeTruthy());
    expect(view.getByText("Done")).toBeTruthy();
    const pinnedAppsBefore = fixture!.pinnedAppsValue();
    fireEvent.click(view.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(fixture!.puts).toContainEqual({
      scope: "person:person-owner",
      key: "setup.checklist_dismissed",
      value: JSON.stringify(["family"]),
    }));
    expect(fixture!.puts.some((setting) => setting.key === "ui.pinned_apps")).toBe(false);
    expect(fixture!.pinnedAppsValue()).toBe(pinnedAppsBefore);
  });

  test("nothing open means the checklist card is absent", async () => {
    const view = open(makePerson("owner"), "/settings/household?tab=general", {
      setupChecklist: [
        { id: "family", title: "Add your family", reason: "Home works best when everyone has their own account.", done: true, open: { label: "Open People", href: "/settings/household?tab=people" } },
      ],
    });
    await waitFor(() => expect(fixture!.requests.some((request) => request.includes("/api/setup-checklist"))).toBe(true));
    expect(view.queryByText("Finish setting up")).toBeNull();
  });

  test("an adult asking for Home settings sees why access is refused and can open their settings", async () => {
    const adult = makePerson("adult");
    const view = open(adult, "/settings/ai?tab=overview");
    expect(await view.findByText("Only a parent or admin can change these settings. Ask the person who set up Home.")).toBeTruthy();
    expect(view.getByRole("link", { name: "Open your settings" }).getAttribute("href")).toBe("/settings/profile");
    expect(where(view)).toBe("/settings/ai?tab=overview");
    expect(fixture!.scopes).not.toContain("household");
    expect(fixture!.requests.filter((r) => r.includes("scope=household"))).toEqual([]);
  });

  test("the column names its area and shows its reach", async () => {
    const home = open(makePerson("owner"), "/settings/household?tab=general");
    expect(await home.findByRole("heading", { level: 2, name: settingsArea("settings")!.title })).toBeTruthy();
    expect(within(column(home)).getByText("Applies to everyone at home")).toBeTruthy();
    cleanup();
    fixture?.restore();
    fixture = null;

    const personal = open(makePerson("adult"), "/settings/chat?tab=general");
    expect(await personal.findByRole("heading", { level: 2, name: "Settings" })).toBeTruthy();
    expect(within(column(personal)).getByText("Only you")).toBeTruthy();
  });

  test("an owner opens Settings and sees the personal and household pages together", async () => {
    const view = open(makePerson("owner"), "/settings/home");
    await waitFor(() => expect(where(view)).toBe("/settings/household"));
    expect(rows(view)).toEqual(["Profile and sign-in", "Look and ease", "Chat and AI", "Voice and robot", "Notifications", "Pictures and videos", "Your data and apps", "Household and people", "Privacy and safety", "AI and models", "Pictures, videos and music", "Voice", "Search and web", "Offline data", "Apps and devices", "Backups, storage and updates", "Advanced"]);
    expect(view.getByRole("heading", { level: 1, name: /^Household and people$/ })).toBeTruthy();
  });

  test("robot detail uses the spec tabs and the URL selects the active shell tab", async () => {
    const view = open(makePerson("owner"), "/settings/apps/d1?tab=behaviour", { robots: true });
    await waitFor(() => expect(where(view)).toBe("/settings/apps/d1?tab=behaviour"));
    expect(view.getByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Behaviour" }).getAttribute("aria-selected")).toBe("true");
    expect(view.getByRole("tab", { name: "Access" })).toBeTruthy();
  });

  test("legacy device query replaces to the robot detail route", async () => {
    const view = open(makePerson("owner"), "/settings/home/robot?device=d1&tab=access&addRobot=1", { robots: true });
    await waitFor(() => expect(where(view)).toBe("/settings/apps/d1?tab=access"));
  });

  test("unknown robot detail redirects to the section page", async () => {
    const view = open(makePerson("owner"), "/settings/apps/missing?tab=overview", { robots: true });
    await waitFor(() => expect(where(view)).toBe("/settings/apps?tab=robot"));
  });

  test("robot list row links to the route detail", async () => {
    const view = open(makePerson("owner"), "/settings/apps?tab=robot", { robots: true });
    expect(await view.findByRole("link", { name: "Robot settings" })).toHaveAttribute("href", "/settings/apps/d1?tab=overview");
  });

  test("COLUMN-UNIFY-01: the column's first row goes back to the app the person came from, and the area title stays", async () => {
    rememberLastAppRoute("/files?section=all");
    const view = open(makePerson("adult"), "/settings/chat?tab=general");
    const back = await waitFor(() => within(column(view)).getByRole("link", { name: "Back to Library" }));
    expect(back.getAttribute("href")).toBe("/files?section=all");
    expect(within(column(view)).getByRole("heading", { level: 2, name: "Settings" })).toBeTruthy();
    window.sessionStorage.clear();
  });

  test("a child gets the Home settings access explanation on a direct URL", async () => {
    const view = open(makePerson("child"), "/settings/offline-data");
    expect(await view.findByText("Only a parent or admin can change these settings. Ask the person who set up Home.")).toBeTruthy();
    expect(where(view)).toBe("/settings/offline-data");
    expect(view.queryByText("Disk space")).toBeNull();
    expect(fixture!.requests.some((r) => r.includes("/api/reference/"))).toBe(false);
  });

  test.each(["child", "teen"] as const)("a %s gets the Home settings access explanation for Engines and AI", async (role) => {
    const view = open(makePerson(role), "/settings/ai?tab=overview");
    expect(await view.findByText("Only a parent or admin can change these settings. Ask the person who set up Home.")).toBeTruthy();
    expect(where(view)).toBe("/settings/ai?tab=overview");
    expect(view.queryByText("Where the engine runs")).toBeNull();
    expect(fixture!.requests.filter((r) => /api\/(engines|settings\?scope=household)/.test(r))).toEqual([]);
  });

  test("an admin opens Offline data as its own page, with no tab row", async () => {
    const view = open(makePerson("admin"), "/settings/offline-data");
    await waitFor(() => expect(where(view)).toBe("/settings/offline-data"));
    expect(view.queryByRole("tab", { name: "Reference library" })).toBeNull();
  });

  test("an owner manages the household command list in Home settings", async () => {
    const view = open(makePerson("owner"), "/settings/home-voice?tab=commands");
    await waitFor(() => expect(where(view)).toBe("/settings/home-voice?tab=commands"));
    await waitFor(() => expect(document.body.textContent).toContain("No commands yet."));
  });

  test("the network area renders the expert port from the spec registry and confirms its new address", async () => {
    const originalConfirm = window.confirm;
    const confirm = mock(() => true);
    window.confirm = confirm;
    try {
      const view = open(makePerson("owner"), "/settings/advanced?tab=network");
      const port = await view.findByLabelText("Home network port");
      fireEvent.change(port, { target: { value: "4555" } });
      fireEvent.blur(port);
      await waitFor(() => expect(confirm).toHaveBeenCalledWith("Home will restart after this is saved. Devices will use maipai.local:4555. Continue?"));
      await waitFor(() => expect(fixture!.puts).toContainEqual({ scope: "household", key: "network.hub_port", value: 4555 }));
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("away wizard opens from the checklist and from Settings, network", async () => {
    const checklist = open(makePerson("owner"), "/settings/household?tab=general", {
      setupChecklist: [{ id: "away-access", title: "Set up access away from home", reason: "Tailscale lets your family reach Home when they are away.", done: false, open: { label: "Open", href: "/setup/away" } }],
    });
    const checklistLink = await checklist.findByRole("link", { name: "Open Set up access away from home" });
    fireEvent.click(checklistLink);
    await waitFor(() => expect(where(checklist)).toBe("/setup/away"));
    expect(checklist.getByRole("heading", { name: "Away setup wizard" })).toBeTruthy();
    cleanup();
    fixture?.restore();
    fixture = null;

    const settings = open(makePerson("owner"), "/settings/advanced?tab=network");
    fireEvent.click(await settings.findByRole("link", { name: "Set up away access" }));
    await waitFor(() => expect(where(settings)).toBe("/setup/away"));
    expect(settings.getByRole("heading", { name: "Away setup wizard" })).toBeTruthy();
  });

  test("Settings, network renders no second copy of the setup steps", async () => {
    const view = open(makePerson("owner"), "/settings/advanced?tab=network");
    await view.findByRole("link", { name: "Set up away access" });
    expect(view.queryByText("Install Tailscale on this computer")).toBeNull();
    expect(view.queryByText("Turn on secure addresses")).toBeNull();
    expect(view.queryByRole("img", { name: /QR code for your Home address/ })).toBeNull();
  });

  test("an admin opens the voice manager in Home settings", async () => {
    const view = open(makePerson("admin"), "/settings/home-voice?tab=voices");
    await waitFor(() => expect(where(view)).toBe("/settings/home-voice?tab=voices"));
    await waitFor(() => expect(view.getByRole("button", { name: "Add voice" })).toBeTruthy());
  });

  test("a section the viewer may not see replaces to the first visible one, naming nothing", async () => {
    const view = open(makePerson("child"), "/settings/chat?tab=skills");
    await waitFor(() => expect(where(view)).toBe("/settings/chat"));
    expect(rows(view)).not.toContain("Skills");
    cleanup();
    fixture!.restore();
    const unknown = open(makePerson("adult"), "/settings/chat/not-a-section");
    await waitFor(() => expect(where(unknown)).toBe("/settings/chat"));
  });

  test("/settings/<area> opens the area's first visible section on a desktop", async () => {
    const view = open(makePerson("teen"), "/settings/chat");
    await waitFor(() => expect(where(view)).toBe("/settings/chat"));
  });

  test("on a phone /settings/<area> shows the column alone, with its search and rows", async () => {
    const view = open(makePerson("adult"), "/settings/chat", {}, 390);
    await waitFor(() => expect(rows(view)).toContain("Chat and AI"));
    expect(where(view)).toBe("/settings/chat");
    expect(view.getByRole("searchbox", { name: "Search" })).toBeTruthy();
    expect(column(view).inert).toBe(false);
    expect(view.queryByRole("button", { name: /settings sidebar/ })).toBeNull();
  });

  test("an arrow row opened directly goes where it points", async () => {
    const view = open(makePerson("adult"), "/settings/chat/voice");
    await waitFor(() => expect(where(view)).toBe("/settings/voice"));
  });

  test("the data page keeps its memory view on the Data and privacy tab", async () => {
    // An owner has two tabs on the page (Data and privacy, Developer tools); the first tab drops ?tab=.
    const view = open(makePerson("owner"), "/settings/data");
    expect(await view.findByRole("tab", { name: "Data and privacy" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Developer tools" })).toBeTruthy();
    expect(where(view)).toBe("/settings/data");
  });

  test("a dirty profile draft blocks a SettingsShell section change", async () => {
    const originalConfirm = window.confirm;
    window.confirm = mock(() => false);
    try {
      const view = open(makePerson("adult"), "/settings/profile?tab=profile");
      await waitFor(() => expect(view.getByLabelText("Name")).toBeTruthy());
      fireEvent.change(view.getByLabelText("Name"), { target: { value: "Changed" } });
      fireEvent.click(within(column(view)).getByRole("link", { name: "Look and ease" }));
      expect(window.confirm).toHaveBeenCalledWith("Leave without saving?");
      expect(where(view)).toBe("/settings/profile?tab=profile");
      expect(view.getByText("Unsaved changes.")).toBeTruthy();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("the column title names the area with no back row or collapse controls; Cmd/Ctrl+B is inert", async () => {
    window.sessionStorage.setItem("maipai.settings.last-app-route", "/status?tab=system");
    const view = open(makePerson("adult"), "/settings/chat?tab=general");
    expect(await view.findByRole("heading", { level: 2, name: "Settings" })).toBeTruthy();
    expect(view.queryByRole("link", { name: "Back to app" })).toBeNull();
    expect(view.queryByRole("button", { name: /settings sidebar/i })).toBeNull();
    const before = column(view).getAttribute("data-state");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(column(view).getAttribute("data-state")).toBe(before);
    expect(view.getByRole("link", { name: "Chat" }).getAttribute("aria-current")).toBe("page");
    expect(view.getByRole("button", { name: /Open profile menu/ }).getAttribute("aria-current")).toBeNull();
  });
});

describe("what a band is shown", () => {
  test("a teen sees the chat photo switch but neither Show pictures in answers nor any household row", async () => {
    const view = open(makePerson("teen"), "/settings/chat?tab=general");
    await waitFor(() => expect(view.getByText("Send photos in chat")).toBeTruthy());
    expect(view.queryByText("Show pictures in answers")).toBeNull();
    expect(view.queryByText("How a teen's replies are checked")).toBeNull();
    expect(rows(view)).not.toContain("Household chat");
  });

  test("a child sees safe search but not the chat card, Skills or Parental controls", async () => {
    const view = open(makePerson("child"), "/settings/chat?tab=general", { hasChild: true });
    await waitFor(() => expect(view.getByText("Safe search level")).toBeTruthy());
    expect(view.queryByText("Send photos in chat")).toBeNull();
    expect(rows(view)).not.toContain("Skills");
    expect(rows(view)).not.toContain("Parental controls");
  });

  test("Chat and AI no longer carries link rows: Parental controls moved to the Family app in the rail (spec legacy map)", async () => {
    const withChild = open(makePerson("adult"), "/settings/chat", { hasChild: true });
    await waitFor(() => expect(withChild.getByText("Send photos in chat")).toBeTruthy());
    expect(withChild.queryByRole("link", { name: "Parental controls" })).toBeNull();
    cleanup();
    const without = open(makePerson("adult"), "/settings/chat", { hasChild: false });
    await waitFor(() => expect(without.getByText("Send photos in chat")).toBeTruthy());
    expect(without.queryByRole("link", { name: "Parental controls" })).toBeNull();
  });

  test("an adult sees the wake word device tab only once its assets are installed", async () => {
    const without = open(makePerson("adult"), "/settings/voice");
    await waitFor(() => expect(without.getByRole("heading", { level: 1, name: "Voice and robot" })).toBeTruthy());
    expect(without.queryByRole("tab", { name: "This device" })).toBeNull();
    cleanup();
    fixture!.restore();
    fixture = null;
    const withAssets = open(makePerson("adult"), "/settings/voice", { wakeword: true });
    await waitFor(() => expect(withAssets.getByRole("tab", { name: "This device" })).toBeTruthy());
    expect(withAssets.getByRole("tab", { name: "Voice" })).toBeTruthy();
  });

  test("the Robot tab is an adult's or admin's and only with a paired robot", async () => {
    const adult = open(makePerson("adult"), "/settings/voice", { robots: true });
    await waitFor(() => expect(adult.getByRole("tab", { name: "Robot" })).toBeTruthy());
    cleanup();
    fixture!.restore();
    fixture = null;
    const teen = open(makePerson("teen"), "/settings/voice", { robots: true });
    await waitFor(() => expect(teen.getByRole("heading", { level: 1, name: "Voice and robot" })).toBeTruthy());
    expect(teen.queryByRole("tab", { name: "Robot" })).toBeNull();
  });
});

describe("what the page asks for", () => {
  test("it reads the household scope for Home settings and only the viewer's settings when needed", async () => {
    const teen = open(makePerson("teen"), "/settings/notifications?tab=notifications");
    await waitFor(() => expect(teen.getByText("Show alerts on this device")).toBeTruthy());
    expect(fixture!.scopes.every((scope) => scope === "person:person-teen")).toBe(true);
    cleanup();
    fixture!.restore();
    for (const page of ["household", "privacy", "ai", "home-voice", "apps", "backups"]) {
      open(makePerson("owner"), `/settings/${page}`);
      await waitFor(() => expect(fixture!.scopes.length).toBeGreaterThan(0));
      expect(fixture!.scopes).toContain("household");
      expect(fixture!.scopes.every((scope) => scope === "household")).toBe(true);
      expect(fixture!.requests.some((r) => /scope=person%3A(?!person-owner)/.test(r))).toBe(false);
      cleanup();
      fixture!.restore();
      fixture = null;
    }
  });

  test("a #<key> deep link scrolls to the row and focuses its control", async () => {
    open(makePerson("adult"), "/settings/chat?tab=general#chat.photo_uploads");
    await waitFor(() => {
      const row = document.body.querySelector('[data-setting-key="chat.photo_uploads"]');
      expect(row).toBeTruthy();
      expect(row!.contains(document.activeElement)).toBe(true);
    });
  });

  test("a search in the column lists matching rows under a section / card breadcrumb, and Escape clears it", async () => {
    const view = open(makePerson("adult"), "/settings/chat?tab=general");
    await waitFor(() => expect(view.getByText("Send photos in chat")).toBeTruthy());
    fireEvent.change(view.getByRole("searchbox", { name: "Search" }), { target: { value: "safe" } });
    await waitFor(() => expect(where(view)).toContain("q=safe"));
    await waitFor(() => expect(view.getByText("Chat and AI / Search")).toBeTruthy());
    fireEvent.keyDown(view.getByRole("searchbox", { name: "Search" }), { key: "Escape" });
    await waitFor(() => expect(where(view)).not.toContain("q="));
  });

  test("a search with no match says so", async () => {
    const view = open(makePerson("adult"), "/settings/chat?tab=general");
    await waitFor(() => expect(view.getByText("Send photos in chat")).toBeTruthy());
    fireEvent.change(view.getByRole("searchbox", { name: "Search" }), { target: { value: "zzzz-nothing" } });
    await waitFor(() => expect(view.getByText("No settings match that search.")).toBeTruthy());
  });
});

describe("the rail on a settings route (RULES S1 and S3)", () => {
  test("the main navigation renders on /settings/chat at 1440px", async () => {
    const view = open(makePerson("adult"), "/settings/chat?tab=general", {}, 1440);
    const rail = view.getByRole("navigation", { name: "Primary navigation" });
    expect(rail.className).toContain("w-[var(--rail-width,56px)]");
    for (const label of ["Home", "Chat", "Library", "Family"]) await waitFor(() => expect(view.getByRole("link", { name: label })).toBeTruthy());
    expect(view.getByRole("button", { name: /Open profile menu for Adult/ })).toBeTruthy();
    await waitFor(() => expect(column(view)).toBeTruthy());
  });

  test("at 390px the menu button opens the same destinations in a drawer", async () => {
    const view = open(makePerson("adult"), "/settings/chat", {}, 390);
    expect(view.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    fireEvent.click(await view.findByRole("button", { name: "Open menu" }));
    const drawer = await view.findByRole("dialog");
    for (const label of ["Home", "Chat", "Library", "Family"]) await waitFor(() => expect(within(drawer).getByRole("link", { name: label })).toBeTruthy());
    expect(within(drawer).getByRole("button", { name: /Open profile menu for Adult/ })).toBeTruthy();
    await waitFor(() => expect(column(view)).toBeTruthy());
  });
});

describe("old URLs through the route", () => {
  test("/settings?tab=household&section=ai as an admin replaces to Home settings AI", async () => {
    const view = open(makePerson("admin"), "/settings?tab=household&section=ai");
    await waitFor(() => expect(where(view)).toBe("/settings/ai?tab=overview"));
  });

  test("/settings?tab=household as an adult opens the explanation with no household request", async () => {
    const view = open(makePerson("adult"), "/settings?tab=household&section=ai");
    await waitFor(() => expect(where(view)).toBe("/settings/ai?tab=overview"));
    expect(await view.findByText("Only a parent or admin can change these settings. Ask the person who set up Home.")).toBeTruthy();
    expect(fixture!.scopes).not.toContain("household");
  });

  test("an old search link names a group and lands at its first key", async () => {
    const view = open(makePerson("owner"), "/settings?tab=household&section=household.search");
    await waitFor(() => expect(where(view)).toMatch(/^\/settings\/search\?tab=search#search\./));
  });

  test("/customize lands on Skills for an adult and on Chat settings for a child", async () => {
    const adult = open(makePerson("adult"), "/customize");
    await waitFor(() => expect(where(adult)).toBe("/settings/chat?tab=skills"));
    cleanup();
    fixture!.restore();
    const child = open(makePerson("child"), "/customize");
    await waitFor(() => expect(where(child)).toBe("/settings/chat"));
  });
});

describe("a package's own settings area", () => {
  const weatherKeys = [
    { key: "weather.places", scope: "person", selector: "location", range: { multiple: true, allow_current: false }, default: [], label: "Weather places", help: "Places saved for weather answers.", level: "basic", lives_in: "weather", honoured_by: ["home"] },
    { key: "weather.default_place", scope: "person", selector: "location", range: { multiple: false, allow_current: true }, default: "current", label: "Weather default place", help: "The place weather uses when you do not name one.", level: "basic", lives_in: "weather", honoured_by: ["home"] },
  ] as unknown as NonNullable<Parameters<typeof mockHome>[0]>["extraKeys"];
  const area = { id: "weather", title: "Weather", app: "/apps/weather", audience: { min_role: "child" }, groups: [{ label: "Weather", sections: ["places"] }], sections: [{ id: "places", label: "Places", icon: "map-pin", kind: "keys", cards: [{ label: "Places", group: "weather", scope: "person" }] }] };
  const apps = [{ package: "weather", page: "index", label: "Weather", icon: "cloud-sun", description: "", category: "Utilities", keywords: [], sections: [], to: "/apps/weather", incognito: "unaffected", settings_area: area }];

  test("/settings/weather opens the package area with the person's places and default as place pickers", async () => {
    const view = open(makePerson("adult"), "/settings/weather", { apps, extraKeys: weatherKeys, places: [{ id: "p1", kind: "place", name: "Cabin", scope: "person" }] });
    await waitFor(() => expect(where(view)).toBe("/settings/weather/places"));
    await waitFor(() => expect(view.getAllByText("Weather places").length).toBeGreaterThan(0));
    expect(view.queryByText("Not supported in this hub version yet.")).toBeNull();
    expect(view.getAllByText("Weather default place").length).toBeGreaterThan(0);
  });

  test("a child opens it too and sees the same two rows (their own list)", async () => {
    const view = open(makePerson("child"), "/settings/weather", { apps, extraKeys: weatherKeys });
    await waitFor(() => expect(where(view)).toBe("/settings/weather/places"));
    await waitFor(() => expect(view.getAllByText("Weather places").length).toBeGreaterThan(0));
    expect(fixture!.scopes.every((scope) => scope === "person:person-child")).toBe(true);
  });

  test("while the app list is loading the page waits; once it answers without that area it goes to Account", async () => {
    const view = open(makePerson("adult"), "/settings/nonesuch", { apps: [] });
    await waitFor(() => expect(where(view)).toContain("/settings/profile"));
  });

  test("the rail selection and the way back are the app the area belongs to", () => {
    expect(activeAppHref("/settings/weather/places", { weather: "/apps/weather" })).toBe("/apps/weather");
    expect(activeAppHref("/settings/chat?tab=general", { weather: "/apps/weather" })).toBe("/chat");
  });
});
