import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./NextChatPage.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../../apps/chat/chatHeaderBar.tsx", import.meta.url), "utf8");

describe("SHELL-FOLD-01 phone chat header", () => {
  test("the history control and chat header share the phone top-bar row", () => {
    const row = source.match(/<div className="flex items-center gap-1 border-b border-border pb-2 lg:hidden">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(row).toContain('aria-label={sheetOpen ? "Hide threads" : "Show threads"}');
    expect(row).toContain("<ChatHeaderBar phoneRow />");
    expect(header).toContain('phoneRow ? "flex min-w-0 flex-1 items-center gap-1 overflow-hidden"');
    expect(header).toContain('"hidden min-w-0 flex-1 items-center gap-1 overflow-hidden lg:flex"');
    const routes = readFileSync(new URL("../NextRoutes.tsx", import.meta.url), "utf8");
    expect(routes).toContain("showSidebarTriggerInMenu showHeaderSidebarTrigger={false}");
  });
});
