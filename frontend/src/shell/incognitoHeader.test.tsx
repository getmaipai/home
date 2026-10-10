import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import { ThemeProvider } from "@maipai/ui/src/dashboard/context/shadcntheme/ThemeContext";
import { TooltipProvider } from "@maipai/ui/src/dashboard/components/ui/tooltip";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";

const tokensCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

const styleTestId = "incognito-header-test-styles";
const violetPill = "rgb(124, 58, 237)";
const white = "rgb(255, 255, 255)";

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

function HeaderFixtureTitle() {
  return <h1 data-testid="header-page-title">New Chat</h1>;
}

function HeaderFixturePage() {
  useHeaderExtra(HeaderFixtureTitle);
  return (
    <div>
      <div className="bg-card" data-testid="ordinary-card">Neutral card</div>
      <div className="bg-popover" data-testid="ordinary-pane">Neutral pane</div>
    </div>
  );
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("light", "dark", "incognito");
  document.body.classList.remove("style-neutral");
  document.querySelector(`[data-testid="${styleTestId}"]`)?.remove();
  localStorage.removeItem("vite-ui-theme");
});

test("tokens.css no longer paints the header band violet (redesigned 2026-09-26)", () => {
  expect(tokensCss).not.toMatch(/\[data-slot="sidebar-inset"\] > header\.sticky\s*\{/);
  expect(tokensCss).not.toContain("--incognito-header-background");
  expect(tokensCss).not.toContain("--incognito-header-foreground");
});

test.each([
  ["light", "rgb(244, 247, 251)", "rgb(11, 23, 48)"],
  ["dark", "rgb(7, 17, 31)", "rgb(244, 248, 255)"],
] as const)("%s Incognito leaves the header on the ordinary theme background and shows a violet pill badge instead", async (theme, headerBackground, headerForeground) => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });

  // This fixture deliberately does not inject the real
  // html.incognito/body[class*="style-"] rules from tokens.css: their
  // --background chain (--background -> --incognito-canvas-color ->
  // --surface-page) resolves to the exact same value with or without
  // Incognito active, and layering them here trips a happy-dom bug
  // (infinite recursion resolving chained var()/color-mix() custom
  // properties across elements - not reproducible in a real browser).
  // The neutral-surface cascade itself is covered by
  // incognitoActiveNav.test.tsx and incognitoSidebar.test.tsx.
  const style = document.createElement("style");
  style.dataset.testid = styleTestId;
  style.textContent = `
    :root {
      --hue-violet: rgb(164, 52, 255);
      --surface-page: rgb(244, 247, 251); --surface-card: white;
      --surface-pane: rgb(227, 234, 243); --surface-sidebar: rgb(234, 240, 247);
      --background: var(--surface-page); --card: var(--surface-card);
      --popover: var(--surface-pane); --muted: var(--surface-pane);
      --accent: var(--surface-pane); --sidebar: var(--surface-sidebar);
      --border: rgb(201, 214, 230); --input: rgb(201, 214, 230);
      --foreground: rgb(11, 23, 48);
    }
    .dark {
      --surface-page: rgb(7, 17, 31); --surface-card: rgb(16, 34, 56);
      --surface-pane: rgb(20, 42, 67); --surface-sidebar: rgb(10, 26, 46);
      --background: var(--surface-page); --card: var(--surface-card);
      --popover: var(--surface-pane); --muted: var(--surface-pane);
      --accent: var(--surface-pane); --sidebar: var(--surface-sidebar);
      --border: rgb(41, 69, 99); --input: rgb(41, 69, 99);
      --foreground: rgb(244, 248, 255);
    }
    .bg-background { background-color: var(--background); }
    .bg-card { background-color: var(--card); }
    .bg-popover { background-color: var(--popover); }
    .text-foreground { color: var(--foreground); }
    .border-border { border-color: var(--border); }
    .bg-violet-600 { background-color: ${violetPill}; }
    .text-white { color: ${white}; }
  `;
  document.head.append(style);
  document.documentElement.classList.add(theme, "incognito");
  document.body.classList.add("style-neutral");

  try {
    const view = render(
      <MemoryRouter initialEntries={["/"]}>
        <ThemeProvider defaultTheme={theme}>
          <TooltipProvider>
            <Routes>
              <Route path="/" element={<FullLayout profileDisplayName="Jesse" incognito onIncognitoChange={() => {}} />}>
                <Route index element={<HeaderFixturePage />} />
              </Route>
            </Routes>
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(view.getByTestId("header-page-title")).toBeTruthy());
    const header = view.container.querySelector('[data-slot="sidebar-inset"] > header.sticky');
    const title = view.getByTestId("header-page-title");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("bg-background");

    const headerStyle = getComputedStyle(header!);
    expect(headerStyle.backgroundColor).toBe(headerBackground);
    expect(getComputedStyle(title).color).not.toBe(white);

    const pill = header!.querySelector<HTMLButtonElement>('[aria-label="Incognito On"]');
    expect(pill).not.toBeNull();
    expect(pill!.className).toContain("rounded-full");
    expect(pill!.textContent).toContain("Incognito");
    const pillStyle = getComputedStyle(pill!);
    expect(pillStyle.backgroundColor).toBe(violetPill);
    expect(pillStyle.color).toBe(white);
    expect(contrast(pillStyle.color, pillStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(headerForeground, headerBackground)).toBeGreaterThanOrEqual(4.5);
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  }
});
