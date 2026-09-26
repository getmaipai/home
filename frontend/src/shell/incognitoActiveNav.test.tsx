import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@maipai/ui/src/dashboard/components/ui/sidebar";
import SidebarLayout from "@maipai/ui/src/dashboard/layouts/full/vertical/sidebar/Sidebar";
import { TooltipProvider } from "@maipai/ui/src/dashboard/components/ui/tooltip";

const tokensCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const activeNavRule = tokensCss.match(/html\.incognito body\[class\*="style-"\] \[data-slot="sidebar-inner"\] a > div\.bg-primary\.text-background\s*\{[^}]*\}/)?.[0];
const styleTestId = "incognito-active-nav-test-styles";
const violet = "rgb(164, 52, 255)";

function rgb(color: string): [number, number, number] {
  if (color === "white") return [255, 255, 255];
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) throw new Error(`Expected an RGB color, received ${color}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("light", "dark", "incognito");
  document.body.classList.remove("style-neutral");
  document.querySelector(`[data-testid="${styleTestId}"]`)?.remove();
});

test.each([
  ["light", "rgb(11, 23, 48)"],
  ["dark", "rgb(244, 248, 255)"],
] as const)("the active %s sidebar pill is violet and inactive items keep their theme colors", (theme, foreground) => {
  expect(activeNavRule).toBeDefined();

  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });

  const style = document.createElement("style");
  style.dataset.testid = styleTestId;
  style.textContent = `
    :root {
      --hue-violet: ${violet}; --primary: rgb(33, 166, 255);
      --background: rgb(244, 247, 251); --foreground: rgb(11, 23, 48);
      --sidebar: rgb(234, 240, 247); --surface-sidebar: rgb(234, 240, 247);
    }
    .dark {
      --background: rgb(7, 17, 31); --foreground: rgb(244, 248, 255);
      --sidebar: rgb(10, 26, 46); --surface-sidebar: rgb(10, 26, 46);
    }
    body { color: var(--foreground); }
    .bg-primary { background-color: var(--primary); }
    .text-background { color: var(--background); }
    .bg-sidebar { background-color: var(--sidebar); }
    .sidebar-box [data-slot="sidebar-inner"] { background-color: var(--background); }
    html.incognito body[class*="style-"] { --sidebar: var(--surface-sidebar); }
    ${activeNavRule ?? ""}
  `;
  document.head.append(style);
  document.documentElement.classList.add(theme, "incognito");
  document.body.classList.add("style-neutral");

  try {
    const view = render(
      <MemoryRouter initialEntries={["/next/chat"]}>
        <TooltipProvider>
          <SidebarProvider defaultOpen>
            <SidebarLayout />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>,
    );

    const activeLink = view.container.querySelector<HTMLAnchorElement>('a[href="/next/chat"]');
    const inactiveLink = view.container.querySelector<HTMLAnchorElement>('a[href="/next"]');
    expect(activeLink).not.toBeNull();
    expect(inactiveLink).not.toBeNull();
    const activePill = activeLink!.querySelector("div.bg-primary.text-background");
    const inactiveItem = inactiveLink!.querySelector("div");
    expect(activePill).not.toBeNull();
    expect(inactiveItem).not.toBeNull();

    const activeStyle = getComputedStyle(activePill!);
    expect(activeStyle.backgroundColor).toBe(violet);
    expect(activeStyle.color).toBe("white");
    expect(contrast(activeStyle.color, activeStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(activeStyle.backgroundColor).not.toBe("rgb(33, 166, 255)");

    const inactiveStyle = getComputedStyle(inactiveItem!);
    expect(inactiveStyle.backgroundColor).toBe("");
    expect(inactiveStyle.color).toBe(foreground);
    expect(inactiveStyle.backgroundColor).not.toBe(violet);
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  }
});
