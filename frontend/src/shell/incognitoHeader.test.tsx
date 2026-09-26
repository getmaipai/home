import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import { ThemeProvider } from "@maipai/ui/src/dashboard/context/shadcntheme/ThemeContext";
import { TooltipProvider } from "@maipai/ui/src/dashboard/components/ui/tooltip";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";

const tokensCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function requiredRule(pattern: RegExp): string {
  const rule = tokensCss.match(pattern)?.[0];
  if (!rule) throw new Error(`Could not find Incognito rule matching ${pattern}`);
  return rule;
}

const lightPaletteRule = requiredRule(/html\.incognito\s*\{[^}]*\}/);
const sidebarSurfaceRule = requiredRule(/html\.incognito body\[class\*="style-"\] \[data-slot="sidebar-inner"\]\s*\{[^}]*\}/);
const headerBandRule = requiredRule(/html\.incognito:not\(\.dark\) body\[class\*="style-"\] \[data-slot="sidebar-inset"\] > header\.sticky\s*\{[^}]*\}/);
const incognitoControlRule = requiredRule(/html\.incognito:not\(\.dark\) body\[class\*="style-"\] \[data-slot="sidebar-inset"\] > header\.sticky \[aria-label\^="Incognito "\]:not\(:hover\)\s*\{[^}]*\}/);
const avatarRule = requiredRule(/html\.incognito:not\(\.dark\) body\[class\*="style-"\] \[data-slot="sidebar-inset"\] > header\.sticky \[data-slot="avatar-fallback"\]\s*\{[^}]*\}/);

const styleTestId = "incognito-header-test-styles";
const violet = "rgb(164, 52, 255)";
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

test("light Incognito uses one high-contrast violet header band and leaves the ordinary surfaces neutral", async () => {
  expect(lightPaletteRule).toContain("--incognito-background: none");
  expect(lightPaletteRule).toContain("--incognito-canvas-color: var(--surface-page)");
  expect(lightPaletteRule).toContain("--incognito-card: var(--surface-card)");
  expect(lightPaletteRule).toContain("--incognito-sidebar: var(--surface-sidebar)");

  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });

  const style = document.createElement("style");
  style.dataset.testid = styleTestId;
  style.textContent = `
    :root {
      --hue-violet: ${violet}; --hue-violet-deep: rgb(122, 31, 214);
      --surface-page: rgb(244, 247, 251); --surface-card: ${white};
      --surface-pane: rgb(227, 234, 243); --surface-sidebar: rgb(234, 240, 247);
      --background: var(--surface-page); --card: var(--surface-card);
      --popover: var(--surface-pane); --muted: var(--surface-pane);
      --accent: var(--surface-pane); --sidebar: var(--surface-sidebar);
      --border: rgb(201, 214, 230); --input: rgb(201, 214, 230);
      --foreground: rgb(11, 23, 48); --muted-foreground: rgb(74, 95, 122);
      --primary: rgb(33, 166, 255); --primary-foreground: rgb(7, 17, 31);
    }
    .bg-background { background-color: var(--background); }
    .bg-sidebar { background-color: var(--sidebar); }
    .bg-card { background-color: var(--card); }
    .bg-popover { background-color: var(--popover); }
    .text-foreground { color: var(--foreground); }
    .text-muted-foreground { color: var(--muted-foreground); }
    .text-violet-600 { color: rgb(124, 58, 237); }
    .border-border { border-color: var(--border); }
    .sidebar-box [data-slot="sidebar-inner"] { background-color: var(--background); }
    ${lightPaletteRule}
    html.incognito {
      --incognito-canvas-color: rgb(244, 247, 251);
      --incognito-card: ${white}; --incognito-pane: rgb(227, 234, 243);
      --incognito-muted: rgb(227, 234, 243); --incognito-accent: rgb(227, 234, 243);
      --incognito-sidebar: rgb(234, 240, 247); --incognito-border: rgb(201, 214, 230);
      --incognito-input-border: ${violet};
      --incognito-header-background: ${violet}; --incognito-header-foreground: ${white};
      --incognito-header-border: rgb(197, 123, 255);
      --incognito-header-hover: rgb(246, 235, 255);
    }
    html.incognito body[class*="style-"] {
      --background: rgb(244, 247, 251); --card: ${white}; --surface-card: ${white};
      --popover: rgb(227, 234, 243); --surface-pane: rgb(227, 234, 243);
      --secondary: rgb(227, 234, 243); --muted: rgb(227, 234, 243); --accent: rgb(227, 234, 243);
      --sidebar: rgb(234, 240, 247); --surface-sidebar: rgb(234, 240, 247);
      --sidebar-accent: rgb(227, 234, 243); --border: rgb(201, 214, 230);
      --sidebar-border: rgb(201, 214, 230); --input: ${violet};
    }
    ${sidebarSurfaceRule}
    ${headerBandRule}
    ${incognitoControlRule}
    ${avatarRule}
  `;
  document.head.append(style);
  document.documentElement.classList.add("light", "incognito");
  document.body.classList.add("style-neutral");

  try {
    const view = render(
      <MemoryRouter initialEntries={["/next"]}>
        <ThemeProvider defaultTheme="light">
          <TooltipProvider>
            <Routes>
              <Route path="/next" element={<FullLayout profileDisplayName="Jesse" incognito onIncognitoChange={() => {}} />}>
                <Route index element={<HeaderFixturePage />} />
              </Route>
            </Routes>
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(view.getByTestId("header-page-title")).toBeTruthy());
    const header = view.container.querySelector('[data-slot="sidebar-inset"] > header.sticky');
    const canvas = view.container.querySelector('[data-slot="sidebar-inset"]');
    const sidebar = view.container.querySelector('[data-slot="sidebar-inner"]');
    const card = view.getByTestId("ordinary-card");
    const pane = view.getByTestId("ordinary-pane");
    const title = view.getByTestId("header-page-title");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("bg-background");

    const headerStyle = getComputedStyle(header!);
    expect(headerStyle.backgroundColor).toBe(violet);
    expect(headerStyle.color).toBe(white);
    expect(contrast(headerStyle.color, headerStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(getComputedStyle(title).color).toBe(white);
    expect(contrast(getComputedStyle(title).color, headerStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);

    const incognitoButton = header!.querySelector<HTMLButtonElement>('[aria-label="Incognito On"]');
    expect(incognitoButton).not.toBeNull();
    const incognitoColor = getComputedStyle(incognitoButton!).color;
    const incognitoBacking = getComputedStyle(incognitoButton!).backgroundColor;
    expect(incognitoButton!.className).toContain("hover:bg-violet-500/10");
    expect(incognitoBacking).toBe("white");
    expect(contrast(incognitoColor, incognitoBacking)).toBeGreaterThanOrEqual(4.5);

    const headerButtons = Array.from(header!.querySelectorAll("button")).filter((button) => button !== incognitoButton);
    expect(headerButtons.length).toBeGreaterThanOrEqual(4);
    for (const button of headerButtons) {
      expect(contrast(getComputedStyle(button).color, headerStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    }

    const accountInitial = header!.querySelector<HTMLElement>('[data-slot="avatar-fallback"]');
    expect(accountInitial).not.toBeNull();
    expect(contrast(getComputedStyle(accountInitial!).color, getComputedStyle(accountInitial!).backgroundColor)).toBeGreaterThanOrEqual(4.5);

    expect(getComputedStyle(canvas!).backgroundColor).toBe("rgb(244, 247, 251)");
    expect(getComputedStyle(sidebar!).backgroundColor).toBe("rgb(234, 240, 247)");
    expect(getComputedStyle(card).backgroundColor).toBe(white);
    expect(getComputedStyle(pane).backgroundColor).toBe("rgb(227, 234, 243)");
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  }
});
