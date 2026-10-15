import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { affected, captureId, coverageGaps, type Covers } from "./docsDrift";

const SITE = join(import.meta.dir, "../docs/site-fumadocs");
const covers = JSON.parse(readFileSync(join(SITE, "docs-covers.json"), "utf8")) as Covers;

function pageIds(): string[] {
  const base = join(SITE, "content/docs");
  const out: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((n) => {
    const f = join(d, n);
    if (statSync(f).isDirectory()) walk(f); else if (n.endsWith(".mdx")) out.push(relative(base, f).replace(/\.mdx$/, ""));
  });
  walk(base);
  return out;
}

describe("docs drift map", () => {
  test("every guide page and picture has a code-coverage entry, and none is stale", () => {
    const shots = Object.keys(JSON.parse(readFileSync(join(SITE, "screenshots.json"), "utf8")));
    expect(coverageGaps(covers, pageIds(), shots)).toEqual([]);
  });

  test("a notification code change lists the notifications page and picture only", () => {
    const changed = ["backend/src/lib/notifications.ts"];
    expect(affected(changed, covers, "pages").map((h) => h.id)).toEqual(["user/everyday-use/see-your-notifications", "admin/connect-and-extend/notifications-and-telegram"]);
    expect(affected(changed, covers, "shots").map((h) => h.id)).toEqual(["notifications", "notifications-history"]);
  });

  test("tests, docs and locales never mark a page as changed", () => {
    expect(affected(["backend/src/lib/notifications.test.ts", "docs/BACKLOG.md", "frontend/src/locales/en.po"], covers, "pages")).toEqual([]);
  });

  test("a docs picture file maps to its capture id, other files need the general run", () => {
    expect(captureId("docs-settings-notifications.png")).toBe("settings-notifications");
    expect(captureId("home-desktop-light.png")).toBeNull();
  });
});
