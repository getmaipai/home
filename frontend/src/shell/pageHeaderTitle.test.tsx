import { afterEach, describe, expect, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageHeaderActions, headerEntryFor } from "@/shell/pageHeaderTitle";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { makePerson } from "@/shell/pages/settings/settingsTestKit";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
const { PageHeaderTitle } = await import("@/shell/pageHeaderTitle");

afterEach(cleanup);

// A review (2026-09-23): nothing in the suite exercised the route-to-
// icon lookup beyond the single "/" case Routes.test.tsx's own
// sign-in-redirect test happens to touch - a typo in a route key, or a
// route added to Routes.tsx without a matching entry here, would
// silently render a blank header with nothing catching it. One row per
// route this component actually has to answer for, checking both the
// label text and the real lucide icon class (`lucide-<kebab-name>`,
// the class lucide-react itself emits on every icon's own <svg>) -
// proving the SidebarContent-derived entries and each Manage page's
// own exported icon constant both resolve to the icon a person would
// actually see, not just that something non-null rendered.
function renderAt(pathname: string) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[pathname]}>
      <PageHeaderTitle />
    </MemoryRouter>,
  );
}

describe("PageHeaderTitle", () => {
  const cases: Array<[pathname: string, label: string, iconClass: string]> = [
    ["/", "Home", "lucide-house"],
    // Never actually mounted here in the real app (see the dedicated
    // test below) - included anyway since SidebarContent really does
    // answer for it, and a future regression there should fail a test,
    // not just look right by accident.
    ["/chat", "Chat", "lucide-message-circle"],
    ["/people", "Family", "lucide-users"],
    ["/people/person-sage", "Family", "lucide-users"],
    ["/storage", "Storage", "lucide-database"],
    ["/status", "Status", "lucide-activity"],
    ["/performance", "Performance", "lucide-gauge"],
    ["/updates", "Updates", "lucide-refresh-cw"],
    ["/repairs", "Repairs", "lucide-wrench"],
    ["/backups", "Backups", "lucide-archive"],
    ["/users", "Users", "lucide-users"],
    ["/files", "Library", "lucide-folder"],
    ["/notifications", "Notifications", "lucide-bell"],
    // Pages that drew no title, or text without an icon, before the one standard: every route reads as an icon and a name.
    ["/companions", "Companions", "lucide-bot"],
    ["/companions/create", "Companions", "lucide-bot"],
    ["/all-apps", "All apps", "lucide-layout-grid"],
    ["/reference", "Reference", "lucide-book-open"],
    ["/media", "Media", "lucide-cast"],
    ["/settings/ai", "Settings", "lucide-settings"],
    ["/storage/trash", "Storage", "lucide-database"],
    // A page inside an app reads as the app (owner, 2026-10-29): never the page's own name.
    ["/chat/projects", "Chat", "lucide-message-circle"],
  ];

  for (const [pathname, label, iconClass] of cases) {
    test(`${pathname} shows the ${label} icon and label`, () => {
      const view = renderAt(pathname);
      expect(view.getAllByText(label).length).toBeGreaterThan(0);
      for (const node of view.getAllByText(label)) expect(node).toBeVisible();
      expect(view.container.querySelector(`svg.${iconClass}`)).not.toBeNull();
    });
  }

  // /chat itself IS in SidebarContent (it's the real "Chat" nav
  // entry) - this component would correctly answer for it too, it
  // just never actually mounts there in the real app (Routes.tsx
  // keeps chat a true sibling route, never wrapped by
  // PageHeaderLayout; chatHeaderBar.tsx owns that page's header
  // instead). A path in neither table is the real defensive case.
  // Installed package apps come from the hub at run time, so their routes resolve through the merged catalog the shell passes in.
  test("a package app and every page inside it read as the app's icon and name", () => {
    const apps = [{ to: "/apps/news", icon: "newspaper", label: "News", description: "", category: "Info", keywords: [] }];
    for (const path of ["/apps/news", "/apps/news/search", "/apps/news/discuss"]) expect(headerEntryFor(path, apps)?.label).toBe("News");
    expect(headerEntryFor("/apps/other", apps)).toBeUndefined();
  });

  test("a path in neither table renders nothing rather than crashing", () => {
    const view = renderAt("/some-future-page-nobody-mapped-yet");
    expect(view.container).toBeEmptyDOMElement();
  });
});

describe("PageHeaderActions", () => {
  function actionsAt(pathname: string, role: "owner" | "guest") {
    return renderWithQueryClient(<MemoryRouter initialEntries={[pathname]}><WakeWordPersonContext.Provider value={makePerson(role)}><PageHeaderActions /></WakeWordPersonContext.Provider></MemoryRouter>);
  }
  test("Home carries its layout gear in the header for everyone but a guest", () => {
    expect(actionsAt("/", "owner").getByRole("button", { name: "Home layout" })).toBeTruthy();
    cleanup();
    expect(actionsAt("/", "guest").queryByRole("button", { name: "Home layout" })).toBeNull();
  });
  test("a page with no settings draws no button", () => {
    expect(actionsAt("/people", "owner").container).toBeEmptyDOMElement();
  });
});
