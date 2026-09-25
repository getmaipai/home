import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NextPageHeaderTitle } from "@/next/nextPageHeaderTitle";

afterEach(cleanup);

// A review (2026-09-23): nothing in the suite exercised the route-to-
// icon lookup beyond the single "/next" case NextRoutes.test.tsx's own
// sign-in-redirect test happens to touch - a typo in a route key, or a
// route added to NextRoutes.tsx without a matching entry here, would
// silently render a blank header with nothing catching it. One row per
// route this component actually has to answer for, checking both the
// label text and the real lucide icon class (`lucide-<kebab-name>`,
// the class lucide-react itself emits on every icon's own <svg>) -
// proving the SidebarContent-derived entries and each Manage page's
// own exported icon constant both resolve to the icon a person would
// actually see, not just that something non-null rendered.
function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <NextPageHeaderTitle />
    </MemoryRouter>,
  );
}

describe("NextPageHeaderTitle", () => {
  const cases: Array<[pathname: string, label: string, iconClass: string]> = [
    ["/next", "Home", "lucide-house"],
    // Never actually mounted here in the real app (see the dedicated
    // test below) - included anyway since SidebarContent really does
    // answer for it, and a future regression there should fail a test,
    // not just look right by accident.
    ["/next/chat", "Chat", "lucide-message-circle"],
    ["/next/tools", "Tools", "lucide-layout-grid"],
    ["/next/people", "People", "lucide-users"],
    ["/next/settings", "Settings", "lucide-settings"],
    ["/next/engines", "Engines", "lucide-cpu"],
    ["/next/performance", "Performance", "lucide-gauge"],
    ["/next/updates", "Updates", "lucide-refresh-cw"],
    ["/next/repairs", "Repairs", "lucide-wrench"],
    ["/next/backups", "Backups", "lucide-archive"],
  ];

  for (const [pathname, label, iconClass] of cases) {
    test(`${pathname} shows the ${label} icon and label`, () => {
      const view = renderAt(pathname);
      expect(view.getByText(label)).toBeVisible();
      expect(view.container.querySelector(`svg.${iconClass}`)).not.toBeNull();
    });
  }

  // /next/chat itself IS in SidebarContent (it's the real "Chat" nav
  // entry) - this component would correctly answer for it too, it
  // just never actually mounts there in the real app (NextRoutes.tsx
  // keeps chat a true sibling route, never wrapped by
  // NextPageHeaderLayout; chatHeaderBar.tsx owns that page's header
  // instead). A path in neither table is the real defensive case.
  test("a path in neither table renders nothing rather than crashing", () => {
    const view = renderAt("/next/some-future-page-nobody-mapped-yet");
    expect(view.container).toBeEmptyDOMElement();
  });
});
