import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { blockListsDir } from "@/lib/paths";
import { __setListsReadyForTests, emptyState, listFilePath, writeState } from "@/lib/blocklists/listStore";
import { blocklistStatusNote } from "@/lib/blocklists/status";

const NOW = Date.parse("2026-10-12T12:00:00Z");

beforeEach(() => {
  __setListsReadyForTests(null);
  resetDb();
  rmSync(blockListsDir, { recursive: true, force: true });
});

function loadAll(ids: string[], entries: number, lastGoodAt: string): void {
  const state = emptyState();
  state.lastGoodAt = lastGoodAt;
  for (const id of ids) {
    const text = `${id}.example.com\n`;
    const sha = createHash("sha256").update(text).digest("hex");
    const path = listFilePath(id, sha);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    state.lists[id] = { sha256: sha, entries, bytes: text.length, format: "domains", pinnedAt: "2026-10-12", loadedAt: lastGoodAt, previousSha256: null };
  }
  writeState(state);
}

describe("blocked-sites status note", () => {
  test("before any download it says search stays off", () => {
    expect(blocklistStatusNote("child", NOW)).toBe("Waiting for the first download. Web search for these controls stays off until it finishes.");
  });

  test("reports age, list count and a million-site total once every list loaded", () => {
    loadAll(["blp-porn", "blp-gambling", "blp-scam", "blp-phishing", "blp-malware", "blp-drugs"], 1_000_000, "2026-10-09T12:00:00Z");
    expect(blocklistStatusNote("child", NOW)).toBe("Updated 3 days ago, 6 lists, about 6 million sites blocked.");
  });

  test("a list still downloading is named, singular and plural wording hold", () => {
    loadAll(["blp-porn"], 500, "2026-10-12T08:00:00Z");
    expect(blocklistStatusNote("child", NOW)).toBe(
      "Updated today, 1 list, 500 sites blocked. 5 more lists are still downloading, and web search for these controls stays off until they finish.",
    );
    loadAll(["blp-porn", "blp-gambling", "blp-scam", "blp-phishing", "blp-malware", "blp-drugs"], 100_000, "2026-10-11T08:00:00Z");
    expect(blocklistStatusNote("child", NOW)).toBe("Updated 1 day ago, 6 lists, about 600 thousand sites blocked.");
  });

  test("an adult with nothing checked says no lists are checked", () => {
    expect(blocklistStatusNote("adult", NOW)).toBe("No lists are checked.");
  });

  test("the settings list carries the note on the child row and never names a site", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Marlow", secret: "1234" });
    const res = await client.get("/api/settings?scope=household");
    const rows = (await res.json()) as Array<{ key: string; state?: string; value: unknown }>;
    const child = rows.find((row) => row.key === "search.blocklists.child");
    expect(child?.state).toContain("Waiting for the first download");
    expect(Array.isArray(child?.value)).toBe(true);
  });
});
