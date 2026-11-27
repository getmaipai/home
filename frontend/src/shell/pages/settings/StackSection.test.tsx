// STACK-MENU-SYNC-01 slice 2: Settings, Stack. The tests are generated from `spec/stack/screens.json` and the spec's `stack` section, so a new tab or a new
// Stack screen cannot ship without them: the menu mirrors the file, every tab refuses everyone but an adult owner or admin (and sends nothing to the Stack),
// the Styles tab draws only what the server sent (the adult-only tile carries no name), and General shows the status card with the Stack stopped.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { SETTINGS_AREAS } from "@/shell/pages/settings/settingsAreas";
import { makePerson, mockHome, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import { DRAWN_BY_HOME, STACK_SCREENS, stubScreensOf } from "@/apps/settings/stack/stackScreens";
import type { Roster } from "@/lib/api";

let fixture: HomeFixture | null = null;
const realFetch = globalThis.fetch;
let adminLink: Record<string, unknown> | null = null;
let loras: unknown = { loras: [], trash_days: 30 };

function Where() { const { pathname, search } = useLocation(); return <output data-testid="where">{pathname}{search}</output>; }

function open(person: Roster, url: string, home: Parameters<typeof mockHome>[0] = {}) {
  fixture = mockHome(home);
  const settingsFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
    const json = (body: unknown) => Promise.resolve(Response.json(body));
    if (path.endsWith("/api/engine-link/credentials")) return json({ paired: false });
    if (adminLink && path.endsWith("/api/ai/stack/admin-link")) return json(adminLink);
    if (path === "/api/loras/stack") return json(loras);
    if (path === "/api/loras/stack/sources") return json({ sources: [] });
    if (path.endsWith("/api/plugins/stats")) return json({ total: 0, fallthroughRate: null, byCommand: [] });
    return settingsFetch(input, init);
  }) as typeof fetch;
  const restoreSettings = fixture.restore;
  fixture.restore = () => { restoreSettings(); globalThis.fetch = realFetch; };
  const view = renderWithQueryClient(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes><Route path="settings/:section?/:detailId?" element={<SettingsAreaPage person={person} onPersonChange={() => {}} />} /></Routes>
    </MemoryRouter>,
  );
  return Object.assign(view, within(document.body));
}
const where = (view: ReturnType<typeof open>) => view.getByTestId("where").textContent;
const stack = () => SETTINGS_AREAS.find((area) => area.id === "settings")!.sections.find((section) => section.id === "stack")!;

afterEach(() => { cleanup(); fixture?.restore(); fixture = null; loras = { loras: [], trash_days: 30 }; adminLink = null; });

describe("the menu mirrors the one definition in the spec", () => {
  test("General first, then one tab for each tab the screens name, in the order the file lists them", () => {
    const fromScreens = [...new Set(STACK_SCREENS.map((screen) => screen.tab))];
    const tabs = stack().tabs!.map((tab) => tab.id);
    expect(tabs[0]).toBe("general");
    expect(new Set(tabs.slice(1))).toEqual(new Set(fromScreens));
  });

  test("every screen is drawn: by its kit page, by a Home page, or as a stub in its own tab", () => {
    const tabs = new Set(stack().tabs!.map((tab) => tab.id));
    for (const screen of STACK_SCREENS) {
      expect(tabs.has(screen.tab)).toBe(true);
      if (screen.kit === null) expect(DRAWN_BY_HOME.has(screen.id) || stubScreensOf(screen.tab).some((stub) => stub.id === screen.id)).toBe(true);
    }
  });
});

describe("every Stack tab is for an adult owner or admin only", () => {
  const tabIds = () => stack().tabs!.map((tab) => tab.id);
  const refused: Array<[string, Roster["role"]]> = [["a child", "child"], ["a teen", "teen"], ["a guest", "guest"], ["a non-admin adult", "adult"]];

  test.each(refused)("%s gets no Stack tab, sees no Stack screen and nothing is asked of the Stack", async (_name, role) => {
    for (const tab of tabIds()) {
      const view = open(makePerson(role), `/settings/stack?tab=${tab}`);
      // A child, teen or guest is sent to their own settings without a word; a non-admin adult sees the one plain sentence.
      await waitFor(() => expect(!where(view)!.startsWith("/settings/stack") || view.queryByText("An owner or admin sets this.") !== null).toBe(true));
      for (const name of ["General", "Models", "Styles", "Monitor", "Maintain"]) expect(view.queryByRole("tab", { name })).toBeNull();
      for (const screen of STACK_SCREENS) expect(view.queryByTestId(`stack-screen-${screen.id}`)).toBeNull();
      expect(view.queryByTestId("stack-general")).toBeNull();
      expect(fixture!.requests.filter((request) => /\/api\/(ai\/stack|loras\/stack)/.test(request))).toEqual([]);
      cleanup(); fixture!.restore(); fixture = null;
    }
  });

  test("an owner and an admin see every tab", async () => {
    for (const role of ["owner", "admin"] as const) {
      const view = open(makePerson(role), "/settings/stack");
      for (const name of ["General", "Models", "Styles", "Monitor", "Maintain"]) expect(await view.findByRole("tab", { name })).toBeTruthy();
      cleanup(); fixture!.restore(); fixture = null;
    }
  });
});

describe("the stubs", () => {
  test.each(["monitor", "maintain"])("the %s tab shows a stub for each screen the file gives it, with its question and the Stack admin link", async (tab) => {
    const view = open(makePerson("owner"), `/settings/stack?tab=${tab}`);
    for (const screen of stubScreensOf(tab)) {
      const row = await view.findByTestId(`stack-screen-${screen.id}`);
      expect(within(row).getByText(screen.question)).toBeTruthy();
      expect((await within(row).findByRole("link", { name: "Open in Stack admin" })).getAttribute("href")).toBe("http://127.0.0.1:8770/admin/");
    }
  });
  test("Models adds a stub for the Models screen that has no page yet (Modes) and none for Engines, which Home draws", async () => {
    const view = open(makePerson("owner"), "/settings/stack?tab=models");
    expect(await view.findByTestId("stack-screen-modes")).toBeTruthy();
    expect(view.queryByTestId("stack-screen-engines")).toBeNull();
  });
});

describe("General", () => {
  test("says where the Stack runs, its version and that it is running, with the Open and Check now buttons", async () => {
    const view = open(makePerson("owner"), "/settings/stack");
    expect(await view.findByText("The Stack is running")).toBeTruthy();
    // The lead circle of the status card holds its check icon, not an empty circle.
    expect(view.getByText("The Stack is running").closest("section")!.querySelector("svg")).not.toBeNull();
    expect(view.getByText("This computer")).toBeTruthy();
    expect(view.getByText("0.4.2")).toBeTruthy();
    expect((await view.findByRole("link", { name: "Open the Stack admin sign-in page" })).getAttribute("target")).toBe("_blank");
    fireEvent.click(view.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(fixture!.requests.filter((request) => request.endsWith("/api/ai/stack/general")).length).toBeGreaterThan(1));
  });

  test("with the Stack stopped it shows the status card with the Stack's sentence, and no version", async () => {
    const view = open(makePerson("owner"), "/settings/stack", { stackGeneral: { where: "this_computer", reachable: false, version: null, problems: null, reason: "The engine isn't answering. Check that the engine is running, then try again." } });
    expect(await view.findByText("The Stack is not answering")).toBeTruthy();
    expect(view.getByText("The engine isn't answering. Check that the engine is running, then try again.")).toBeTruthy();
    expect(view.getByText("Not known while it is not answering")).toBeTruthy();
    expect(view.queryByText("The Stack is running")).toBeNull();
  });

  test("a Stack that lists problems says so and sends the person to the Stack admin", async () => {
    const view = open(makePerson("owner"), "/settings/stack", { stackGeneral: { where: "another_computer", reachable: true, version: "0.4.2", problems: 2, reason: null } });
    expect(await view.findByText("The Stack is running and lists 2 to look at")).toBeTruthy();
    expect(view.getByText("The Stack is running and lists 2 to look at").closest("section")!.querySelector("svg")).not.toBeNull();
    expect(view.getByText("Another computer, over your home network or tailnet")).toBeTruthy();
  });
});

describe("General: the Stack admin link", () => {
  test("shows a working link to the Stack admin sign-in on the computer that runs it", async () => {
    const view = open(makePerson("owner"), "/settings/stack");
    expect((await view.findByRole("link", { name: "Open the Stack admin sign-in page" })).getAttribute("href")).toBe("http://127.0.0.1:8770/admin/");
  });
  test("from another device it uses the Tailscale address the Stack reports", async () => {
    adminLink = { local_url: "http://127.0.0.1:8770/admin/", remote_url: "http://100.64.0.9:8770/admin/", reason: null };
    const view = open(makePerson("owner"), "/settings/stack");
    const link = await view.findByRole("link", { name: "Open the Stack admin sign-in page" });
    expect(link.getAttribute("href")).toMatch(/^http:\/\/(127\.0\.0\.1|100\.64\.0\.9):8770\/admin\/$/);
  });
  test("a Stack that lists the tailnet address makes the link work from any computer, with no same-computer warning", async () => {
    adminLink = { local_url: "http://127.0.0.1:8770/admin/", remote_url: "http://100.64.0.9:8770/admin/", reason: null, remote_state: "listening", can_turn_on: false };
    const view = open(makePerson("owner"), "/settings/stack");
    await view.findByRole("link", { name: "Open the Stack admin sign-in page" });
    expect(view.queryByText(/only on the computer|same computer/i)).toBeNull();
  });
  test("with the setting on but the Stack not restarted yet it says restart pending in words, not a bare dead button", async () => {
    adminLink = { local_url: null, remote_url: null, reason: "The setting is on and takes effect when the Stack restarts. Restart the Stack, then this link works from any computer on your tailnet.", remote_state: "restart_pending", can_turn_on: false };
    const view = open(makePerson("owner"), "/settings/stack");
    expect(await view.findByText(/takes effect when the Stack restarts/)).toBeTruthy();
    expect((view.getByRole("button", { name: "Open the Stack admin sign-in page" }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.queryByRole("button", { name: "Turn on admin page over Tailscale" })).toBeNull();
  });
  test("with the setting off it offers one button that turns it on, then shows restart pending", async () => {
    adminLink = { local_url: null, remote_url: null, reason: "Turn on \"Admin page over Tailscale\" to open the admin page from another computer.", remote_state: "off", can_turn_on: true };
    const view = open(makePerson("owner"), "/settings/stack");
    const turnOnCalls: string[] = [];
    const wrapped = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
      if (path.endsWith("/api/ai/stack/admin-link/turn-on")) {
        turnOnCalls.push(init?.method ?? "GET");
        adminLink = { local_url: null, remote_url: null, reason: "The setting is on and takes effect when the Stack restarts.", remote_state: "restart_pending", can_turn_on: false };
        return Promise.resolve(Response.json(adminLink));
      }
      return wrapped(input, init);
    }) as typeof fetch;
    fireEvent.click(await view.findByRole("button", { name: "Turn on admin page over Tailscale" }));
    expect(await view.findByText("The setting is on and takes effect when the Stack restarts.")).toBeTruthy();
    expect(turnOnCalls).toEqual(["POST"]);
    expect(view.queryByRole("button", { name: "Turn on admin page over Tailscale" })).toBeNull();
  });
});

describe("General: live use of the Stack's computer", () => {
  test("draws the shared colored memory bar from the Stack's own readings, and the jobs", async () => {
    const view = open(makePerson("owner"), "/settings/stack");
    const usage = await view.findByTestId("stack-usage");
    const memory = await within(usage).findByTestId("stack-memory-now");
    expect(within(memory).getByText("60 GB of 128 GB")).toBeTruthy();
    expect(within(memory).getByText("Comfortable")).toBeTruthy();
    const chat = within(memory).getByTestId("stack-memory-segment-chat");
    expect(chat.getAttribute("style")).toContain("var(--chart-1)");
    expect(within(memory).getByTestId("stack-memory-segment-tts").getAttribute("style")).not.toBe(chat.getAttribute("style"));
    expect(within(memory).getByTestId("stack-memory-segment-free")).toBeTruthy();
    expect(within(memory).queryByTestId("stack-memory-segment-image")).toBeNull();
    expect(within(memory).getByText(/Nova 8B/)).toBeTruthy();
    expect(within(usage).getByText("1 running, 2 waiting")).toBeTruthy();
  });
  test("with the Stack stopped there is no usage panel", async () => {
    const view = open(makePerson("owner"), "/settings/stack", { stackGeneral: { where: "this_computer", reachable: false, version: null, problems: null, reason: "x" } });
    await view.findByText("The Stack is not answering");
    expect(view.queryByTestId("stack-usage")).toBeNull();
  });
});

describe("Styles", () => {
  test("with the adult lock closed the tab draws one locked tile and no adult-only name", async () => {
    loras = { loras: [{ locked: true }], trash_days: 30 };
    const view = open(makePerson("owner"), "/settings/stack?tab=styles");
    expect(await view.findByTestId("styles-tab")).toBeTruthy();
    expect(view.queryByText(/Zebraquill/)).toBeNull();
    expect(await view.findByText("Adult-only styles")).toBeTruthy();
  });
});

describe("the old addresses", () => {
  test.each([
    ["/settings/ai", "/settings/stack?tab=models"], ["/settings/ai?tab=overview", "/settings/stack?tab=models"], ["/settings/ai?tab=engines", "/settings/stack?tab=models"],
    ["/settings/ai?tab=advanced", "/settings/stack?tab=maintain"], ["/settings/ai?tab=coding", "/settings/stack?tab=maintain"], ["/settings/media?tab=styles", "/settings/stack?tab=styles"],
  ])("%s goes to %s", async (from, to) => {
    const view = open(makePerson("owner"), from);
    await waitFor(() => expect(where(view)).toBe(to));
  });
});
