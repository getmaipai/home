import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCENT_LABELS } from "@/apps/people/roles";
import { useAccent } from "@/shell/useAccent";

afterEach(() => {
  cleanup();
  document.body.removeAttribute("data-accent");
});

test("a person's accent is painted on the body so the shell tokens can follow it", () => {
  renderHook(() => useAccent("violet"));
  expect(document.body.getAttribute("data-accent")).toBe("violet");
});

test("changing the accent moves the body attribute and removing it clears it", () => {
  const view = renderHook(({ accent }) => useAccent(accent), { initialProps: { accent: "violet" as "violet" | "teal" | null } });
  view.rerender({ accent: "teal" });
  expect(document.body.getAttribute("data-accent")).toBe("teal");
  view.rerender({ accent: null });
  expect(document.body.hasAttribute("data-accent")).toBe(false);
});

test("leaving the shell clears the accent", () => {
  const view = renderHook(() => useAccent("pink"));
  view.unmount();
  expect(document.body.hasAttribute("data-accent")).toBe(false);
});

test("an unknown stored value paints nothing", () => {
  renderHook(() => useAccent("chartreuse" as never));
  expect(document.body.hasAttribute("data-accent")).toBe(false);
});

// The CSS half of the same promise: every named swatch the profile can
// pick has a rule that points the shell's accent tokens at the kit's own
// `--profile-accent-<name>` pair, and one shared rule that applies them.
// jsdom cannot compute Tailwind or cascaded custom properties, so the real
// computed-colour proof is scripts/screenshotAppearance.ts.
const css = readFileSync(join(import.meta.dir, "tokens.css"), "utf8");

test.each(Object.keys(ACCENT_LABELS))("tokens.css maps the %s accent to the kit's swatch and its foreground", (name) => {
  const rule = new RegExp(`body\\[data-accent="${name}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  expect(rule).not.toBeNull();
  expect(rule![1]).toContain(`--person-accent: var(--profile-accent-${name})`);
  expect(rule![1]).toContain(`--person-accent-foreground: var(--profile-accent-${name}-foreground)`);
});

test("one shared rule points the shell's accent tokens at the person's accent", () => {
  const rule = /body\[data-accent\]\s*\{([^}]*)\}/.exec(css);
  expect(rule).not.toBeNull();
  for (const token of ["--accent", "--accent-foreground", "--sidebar-accent", "--sidebar-accent-foreground"]) {
    expect(rule![1]).toContain(`${token}: var(--person-accent`);
  }
  const fill = /body\[data-accent\]\s*\{([^}]*--settings-fill[^}]*)\}/.exec(css);
  expect(fill).not.toBeNull();
  expect(fill![1]).toMatch(/--settings-fill: color-mix\([^;]*var\(--person-accent\)/);
});
