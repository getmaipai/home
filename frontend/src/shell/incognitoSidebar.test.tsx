import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@maipai/ui/src/dashboard/components/ui/sidebar";
import SidebarLayout from "@maipai/ui/src/dashboard/layouts/full/vertical/sidebar/Sidebar";
import { TooltipProvider } from "@maipai/ui/src/dashboard/components/ui/tooltip";

const sidebarTintRule = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")
  .match(/html\.incognito body\[class\*="style-"\] \[data-slot="sidebar-inner"\]\s*\{[^}]*\}/)?.[0];

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("light", "dark", "incognito");
  document.body.classList.remove("style-neutral");
  document.querySelector('[data-testid="incognito-sidebar-test-styles"]')?.remove();
});

test.each([
  ["light", "rgb(234, 240, 247)", "rgb(244, 247, 251)"],
  ["dark", "rgb(53, 28, 110)", "rgb(36, 23, 50)"],
] as const)("the rendered global sidebar uses the expected %s surface color", (theme, sidebarColor, canvasColor) => {
  expect(sidebarTintRule).toBeDefined();
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });

  const style = document.createElement("style");
  style.dataset.testid = "incognito-sidebar-test-styles";
  style.textContent = `
    html.incognito { --incognito-sidebar: ${sidebarColor}; --incognito-canvas-color: ${canvasColor}; }
    html.incognito body[class*="style-"] { --sidebar: var(--incognito-sidebar); --background: var(--incognito-canvas-color); }
    .bg-background { background-color: var(--background); }
    .bg-sidebar { background-color: var(--sidebar); }
    .sidebar-box [data-slot="sidebar-inner"] { background-color: var(--background); }
    ${sidebarTintRule ?? ""}
  `;
  document.head.append(style);
  document.documentElement.classList.add(theme, "incognito");
  document.body.classList.add("style-neutral");

  try {
    const view = render(
      <MemoryRouter initialEntries={["/next"]}>
        <TooltipProvider>
          <SidebarProvider defaultOpen>
            <SidebarLayout />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>,
    );

    const sidebarContainer = view.container.querySelector('[data-slot="sidebar-container"]');
    const sidebarInner = view.container.querySelector('[data-slot="sidebar-inner"]');
    expect(sidebarContainer).not.toBeNull();
    expect(sidebarContainer!.className).toContain("**:data-[slot=sidebar-inner]:bg-background");
    expect(sidebarInner).not.toBeNull();
    expect(getComputedStyle(sidebarInner!).backgroundColor).toBe(sidebarColor);
    expect(getComputedStyle(sidebarInner!).backgroundColor).not.toBe(canvasColor);
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  }
});
