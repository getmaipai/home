import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { PackageAppHeaderLeft, publishPackageAppHeader, sectionsBarEntries } from "./packageAppHeaderBar";

afterEach(() => { cleanup(); publishPackageAppHeader(null); });

test("detail page hides the center on a phone, ordinary pages retain it", () => {
  publishPackageAppHeader({ to: "/apps/audio", label: "Audio", detail: true });
  const detail = render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><PackageAppHeaderLeft /></MemoryRouter></QueryClientProvider>);
  expect(detail.getByTestId("app-header-center").className).toContain("max-sm:hidden");
  cleanup();
  publishPackageAppHeader({ to: "/apps/audio", label: "Audio" });
  const ordinary = render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><PackageAppHeaderLeft /></MemoryRouter></QueryClientProvider>);
  expect(ordinary.getByTestId("app-header-center").className).not.toContain("max-sm:hidden");
});

test("mode tabs are hidden below md", () => {
  publishPackageAppHeader({ to: "/apps/video", label: "Videos", header: { modes: [{ id: "browse", label: "Browse", icon: "play", page: "index" }, { id: "create", label: "Create", icon: "sparkles", page: "create" }] }, mode: "browse" });
  const header = render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><PackageAppHeaderLeft /></MemoryRouter></QueryClientProvider>);
  expect(header.container.querySelector("[data-slot='tabs']")?.className).toContain("max-md:hidden");
});

describe("sectionsBarEntries search", () => {
  const app = { to: "/apps/video", label: "Videos", icon: null, sections: [{ page: "library", label: "Library" }, { page: "search", label: "Search" }] };
  test("an app with a search page names it for the header and keeps it out of the bar", () => {
    const bar = sectionsBarEntries(app, "Videos", true);
    expect(bar.searchTo).toBe("/apps/video/search");
    expect(bar.entries.map((entry) => entry.label)).toEqual(["Videos", "Library"]);
    expect(sectionsBarEntries(app, "Videos", false).searchTo).toBeUndefined();
  });
  test("puts mode pages after the index while preserving section labels and icons", () => {
    const appWithCreate = { to: "/apps/video", label: "Videos", icon: null, sections: [{ page: "library", label: "Library", icon: "folder" }, { page: "create", label: "Make a video", icon: "film" }, { page: "search", label: "Search" }] };
    const bar = sectionsBarEntries(appWithCreate, "Videos", true, [{ page: "index" }, { page: "create" }]);
    expect(bar.entries.map((entry) => entry.to)).toEqual(["/apps/video", "/apps/video/create", "/apps/video/library"]);
    expect(bar.entries[1]).toMatchObject({ label: "Make a video", icon: "film" });
  });
  test("keeps manifest section order when no mode pages are given", () => {
    expect(sectionsBarEntries(app, "Videos", false).entries.map((entry) => entry.to)).toEqual(["/apps/video", "/apps/video/library"]);
  });
});
