import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./ChatPage.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../../apps/chat/chatHeaderBar.tsx", import.meta.url), "utf8");

describe("SHELL-FOLD-01 phone chat header", () => {
  test("the history control and chat header share the phone top-bar row", () => {
    const row = source.match(/<div className="flex items-center gap-1 border-b border-border pb-2 lg:hidden">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(row).toContain('aria-label={sheetOpen ? "Hide threads" : "Show threads"}');
    expect(row).toContain("<ChatHeaderBar phoneRow />");
    expect(row).not.toContain("reserveEnd");
    expect(header).toContain('phoneRow ? "flex min-w-0 flex-1 items-center gap-1 overflow-hidden"');
    expect(header).toContain('"hidden min-w-0 flex-1 items-center gap-1 overflow-hidden lg:flex"');
    // S1: desktop rail expansion is independent of Chat's own phone row;
    // Chat keeps its own header beside its history control.
    const routes = readFileSync(new URL("../Routes.tsx", import.meta.url), "utf8");
    expect(routes).toContain("rail={{ items:");
    expect(routes).toContain("expanded: railExpanded");
    expect(source).toContain('data-slot="chat-header"');
  });

  test("continuous-mic voice barge-in is enabled for every age band", () => {
    expect(source).toContain("voiceBargeIn: true");
  });
});

describe("AUDIT-PERF-01 chat capabilities polling", () => {
  test("capabilities stay fresh for a minute and refetch when the chat model changes", () => {
    const query = source.match(/queryKey: CHAT_CAPABILITIES_QUERY_KEY,([\s\S]*?)\}\);/)?.[1] ?? "";
    expect(query).toContain("staleTime: 60_000");
    expect(query).not.toContain("staleTime: 0");
    expect(query).not.toContain("refetchInterval: 10_000");
    expect(source).toMatch(/invalidateQueries\(\{ queryKey: CHAT_CAPABILITIES_QUERY_KEY \}\)/);
  });
});
