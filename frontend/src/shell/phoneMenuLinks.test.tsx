import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { APP_CATALOG } from "@/shell/appCatalog";
import { coreAppsGroup, PhoneMenuLinks } from "@/shell/phoneMenuLinks";

afterEach(cleanup);

describe("phone menu links", () => {
  test("the phone drawer offers All apps and Companions", () => {
    const { getByRole } = render(<MemoryRouter><PhoneMenuLinks /></MemoryRouter>);
    expect(getByRole("link", { name: "All apps" }).getAttribute("href")).toBe("/all-apps");
    expect(getByRole("link", { name: "Companions" }).getAttribute("href")).toBe("/companions");
  });

  test("searching finds Companions among the core apps", () => {
    const group = coreAppsGroup("companion", APP_CATALOG);
    expect(group?.heading).toBe("Apps");
    expect(group?.results.map((r) => r.href)).toContain("/companions");
  });

  test("package apps are left to the hub's own results, and no match gives no group", () => {
    const apps = [...APP_CATALOG, { to: "/apps/weather", icon: "cloud-sun", label: "Weather", description: "Forecasts.", category: "Utilities", keywords: [] }];
    expect(coreAppsGroup("weather", apps)).toBeNull();
    expect(coreAppsGroup("zzzz", apps)).toBeNull();
  });
});
