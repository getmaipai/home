import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { PackageAppHeaderLeft, publishPackageAppHeader } from "./packageAppHeaderBar";

afterEach(() => { cleanup(); publishPackageAppHeader(null); });

test("detail page hides the center on a phone, ordinary pages retain it", () => {
  publishPackageAppHeader({ to: "/apps/music", label: "Music", detail: true });
  const detail = render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><PackageAppHeaderLeft /></MemoryRouter></QueryClientProvider>);
  expect(detail.getByTestId("app-header-center").className).toContain("max-sm:hidden");
  cleanup();
  publishPackageAppHeader({ to: "/apps/music", label: "Music" });
  const ordinary = render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><PackageAppHeaderLeft /></MemoryRouter></QueryClientProvider>);
  expect(ordinary.getByTestId("app-header-center").className).not.toContain("max-sm:hidden");
});
