import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Brand } from "@/shell/AppShell";

afterEach(() => {
  cleanup();
});

// ui-v0.4.4 follow-up: app-sidebar.tsx (the kit) wraps `brand` in
// `<SidebarMenuButton asChild>`, a Radix Slot contract that clones its
// single child with the button's own className (and data-slot, data-
// active, and so on) merged in - a contract only a component that
// actually accepts and forwards its own props can honor. Brand used to
// be a bare `function Brand()` that ignored everything passed to it, so
// every className app-sidebar.tsx ever set on that wrapper - v0.4.1
// through v0.4.4's own padding fixes included - was silently dropped
// before it reached the real Link, and the brand tile was never
// actually receiving the rail's own inset in any shipped version. A
// live pixel measurement (getBoundingClientRect on a real capture)
// found the tile still clipped at x 0 after v0.4.4's fix supposedly
// landed, which is what surfaced this. This test renders Brand exactly
// the way Radix Slot would - passing extra className and a data
// attribute as a plain prop spread - and proves they land on the real
// anchor element, not just in the component's own hardcoded classes.
test("forwards an injected className and data attribute onto its own link, the way asChild's Slot clone relies on", () => {
  render(
    <MemoryRouter>
      <Brand className="pl-4! gap-1" data-slot="sidebar-menu-button" data-active="true" />
    </MemoryRouter>,
  );
  const link = document.querySelector("a")!;
  expect(link.className).toContain("pl-4!");
  expect(link.className).toContain("gap-1");
  // Brand's own base layout classes still apply too - the fix merges,
  // it doesn't replace.
  expect(link.className).toContain("min-h-12");
  expect(link.getAttribute("data-slot")).toBe("sidebar-menu-button");
  expect(link.getAttribute("data-active")).toBe("true");
  // Brand's own fixed identity isn't overridable by anything asChild
  // would ever pass (SidebarMenuButton never sets `to`/`aria-label`),
  // so these stay exactly what Brand itself declares.
  expect(link.getAttribute("href")).toBe("/");
  expect(link.getAttribute("aria-label")).toBe("MaiPai Home");
});
