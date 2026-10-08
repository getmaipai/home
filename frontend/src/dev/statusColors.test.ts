import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sidebarItemStatus } from "@/shell/statusApps";

// STATUS-COLORS-01: one status palette. The kit's --status-ok, --status-warning,
// --status-error and --status-unknown tokens are the only colors a status LED,
// badge, legend or banner may read. This enumerates every Home surface that
// draws one and fails on a raw palette class, a hue token, --destructive or a
// color literal. BASELINE only shrinks: it is empty and must stay empty.
const SRC = fileURLToPath(new URL("..", import.meta.url));
const statusCssDir = `${SRC}shell/pages/status/`;
const SURFACES = [
  ...readdirSync(statusCssDir).filter((f) => f.endsWith(".css")).map((f) => `${statusCssDir}${f}`),
  `${SRC}apps/chat/chatThreadSlots.tsx`,
  `${SRC}shell/StatusIndicator.tsx`,
  `${SRC}shell/RailProfile.tsx`,
  `${SRC}shell/pages/status/StatusComponents.tsx`,
];
const BASELINE: string[] = [];

const RAW = [
  /--hue-(green|yellow|blue|red|orange|teal)\b/,
  /var\(--destructive\)/,
  /\b(bg|text|border|ring)-(emerald|amber|red|sky|green|yellow|orange|blue)-\d{2,3}\b/,
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(hsl|rgb|oklch)\(/,
];

function findings(): string[] {
  const out: string[] = [];
  for (const file of SURFACES) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (RAW.some((re) => re.test(line))) out.push(`${file.slice(SRC.length)}:${i + 1}`);
    });
  }
  return out;
}

describe("STATUS-COLORS-01 status surfaces", () => {
  test("the surface list is real", () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(6);
    expect(SURFACES.some((f) => f.endsWith("statusLegend.css"))).toBe(true);
    expect(SURFACES.some((f) => f.endsWith("statusBanner.css"))).toBe(true);
  });
  test("no status surface carries a raw palette or hue literal", () => {
    expect(findings().filter((f) => !BASELINE.includes(f))).toEqual([]);
  });
  test("the baseline only shrinks", () => {
    expect(BASELINE.length).toBe(0);
  });
  test("the legend and banner read the --status-* tokens", () => {
    const css = SURFACES.filter((f) => f.endsWith(".css")).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const token of ["ok", "warning", "error"]) expect(css).toContain(`var(--status-${token})`);
  });
  test("the rail Chat LED is told the app's level, not a fixed color", () => {
    const apps = [{ name: "Chat", state: "down", reason: null }, { name: "Library", state: "degraded", reason: null }] as never;
    expect(sidebarItemStatus(apps, { name: "Chat" })?.level).toBe("offline");
    expect(sidebarItemStatus(apps, { name: "Library" })?.level).toBe("degraded");
  });
});
