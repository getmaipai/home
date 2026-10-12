import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resetDb } from "./reset-db";
import { blockListsDir } from "@/lib/paths";
import { blocklistIds } from "@/lib/blocklists/policy";
import { __setListsReadyForTests, emptyState, listFilePath, readState, writeState } from "@/lib/blocklists/listStore";
import { __resetHostIndexForTests, __resetListDropCountersForTests, checkHost, listDropCounters, LISTS_NOT_READY, normalizeHost, probeNames, urlAllowedFor } from "@/lib/blocklists/hostLists";
import { floorSearchResult } from "@/lib/packageHost";
import { effectiveMode, refuseWeb, LISTS_LOADING_NOTE } from "@/lib/retrieval/sourceMode";

/** Loads one list; every other list the policy knows is loaded with a placeholder so the band is ready. */
function load(id: string, text: string): void {
  for (const other of blocklistIds()) if (other !== id && !readState().lists[other]) put(other, "placeholder.invalid\n");
  put(id, text);
}

function put(id: string, text: string): void {
  const sha = createHash("sha256").update(text).digest("hex");
  const path = listFilePath(id, sha);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  const state = emptyState();
  const prior = (() => { try { return JSON.parse(readFileSync(join(blockListsDir, "state.json"), "utf-8")); } catch { return null; } })();
  if (prior) Object.assign(state, prior);
  state.lists[id] = { sha256: sha, entries: text.split("\n").filter(Boolean).length, bytes: text.length, format: "domains", pinnedAt: "2026-10-12", loadedAt: "2026-10-12T00:00:00Z", previousSha256: null };
  writeState(state);
  __resetHostIndexForTests();
}

beforeEach(() => {
  resetDb();
  rmSync(blockListsDir, { recursive: true, force: true });
  __setListsReadyForTests(null);
  __resetHostIndexForTests();
  __resetListDropCountersForTests();
});
afterEach(() => {
  __setListsReadyForTests(true);
});

const ALL_MINOR = ["blp-porn"];

describe("host matching", () => {
  test("a listed host and its subdomains are blocked for child and teen, a stranger is not", () => {
    for (const id of ["blp-porn"]) load(id, "bad.example.com\n");
    expect(checkHost("child", "https://bad.example.com/x")).toBe("blp-porn");
    expect(checkHost("teen", "https://www.sub.bad.example.com/")).toBe("blp-porn");
    expect(checkHost("child", "https://good.example.com/")).toBeNull();
    expect(checkHost("child", "https://example.com/")).toBeNull();
  });

  test("the walk stops at the registrable domain, so a list naming a public suffix blocks nothing else", () => {
    load("blp-porn", "com\nblogspot.com\n");
    expect(checkHost("child", "https://harmless.example.com/")).toBeNull();
    expect(checkHost("child", "https://harmless.blogspot.com/")).toBeNull();
    expect(probeNames("a.b.example.co.uk")).toEqual(["a.b.example.co.uk", "b.example.co.uk", "example.co.uk"]);
  });

  test("host forms are normalised: case, trailing dot, ports, userinfo, punycode", () => {
    load("blp-porn", "bad.example.com\nxn--bcher-kva.example\n");
    expect(normalizeHost("HTTPS://User@BAD.Example.com.:8443/p?q=1")).toBe("bad.example.com");
    expect(checkHost("child", "https://BAD.example.com./")).toBe("blp-porn");
    expect(checkHost("child", "https://bücher.example/")).toBe("blp-porn");
    expect(checkHost("child", "not a url at all")).toBeNull();
    expect(checkHost("child", undefined)).toBeNull();
  });

  test("the adult band is not held by the adult-locked list unless it enabled it", () => {
    load("blp-porn", "bad.example.com\n");
    expect(checkHost("adult", "https://bad.example.com/")).toBeNull();
  });

  test("each band reads only its own enabled lists (mask per band)", () => {
    load("blp-porn", "porn.example.com\n");
    load("blp-gambling", "bet.example.com\n");
    load("blp-drugs", "drugs.example.com\n");
    expect(checkHost("child", "https://bet.example.com/")).toBe("blp-gambling");
    expect(checkHost("teen", "https://bet.example.com/")).toBe("blp-gambling");
    expect(checkHost("child", "https://drugs.example.com/")).toBe("blp-drugs");
    expect(checkHost("teen", "https://drugs.example.com/")).toBeNull();
    expect(checkHost("adult", "https://bet.example.com/")).toBeNull();
  });
});

describe("fail closed", () => {
  test("a band with an enabled list that never loaded gets lists-not-ready and its web side offline", () => {
    expect(checkHost("child", "https://example.com/")).toBe(LISTS_NOT_READY);
    expect(effectiveMode("web", "child")).toBe("offline");
    expect(effectiveMode("web", "teen")).toBe("offline");
    expect(refuseWeb("child")).toBe(LISTS_LOADING_NOTE);
    expect(effectiveMode("web", "adult")).not.toBe("offline");
  });

  test("a vanished file reads as not loaded again", () => {
    load("blp-porn", "bad.example.com\n");
    const state = JSON.parse(readFileSync(join(blockListsDir, "state.json"), "utf-8"));
    rmSync(listFilePath("blp-porn", state.lists["blp-porn"].sha256));
    expect(checkHost("child", "https://example.com/")).toBe(LISTS_NOT_READY);
  });
});

describe("counter", () => {
  test("a drop is counted by list id and band, never by a site", () => {
    load("blp-porn", "bad.example.com\n");
    expect(urlAllowedFor("child", "https://bad.example.com/secret?q=1")).toBe(false);
    expect(urlAllowedFor("child", "https://fine.example.org/")).toBe(true);
    const counters = listDropCounters();
    expect(counters).toEqual({ "blocklist.dropped.blp-porn.child": 1 });
    expect(JSON.stringify(counters)).not.toContain("example");
  });
});

describe("unreadable addresses", () => {
  test("a minor's band drops an address with no readable host; an empty one has nothing to show", () => {
    load("blp-porn", "bad.example.com\n");
    expect(urlAllowedFor("child", "/relative/path.jpg")).toBe(false);
    expect(urlAllowedFor("teen", "data:image/png;base64,AAAA")).toBe(false);
    expect(urlAllowedFor("child", "")).toBe(true);
    expect(urlAllowedFor("child", undefined)).toBe(true);
    expect(urlAllowedFor("adult", "/relative/path.jpg")).toBe(true);
    expect(listDropCounters()["blocklist.dropped.unreadable-address.child"]).toBe(1);
  });
});

describe("producers", () => {
  test("floorSearchResult drops rows and pages on a blocked site and strips a blocked image", () => {
    load("blp-porn", "bad.example.com\ncdn.bad.example.net\n");
    const result = {
      text: "x",
      rows: [
        { title: "A", url: "https://bad.example.com/a", snippet: "ok" },
        { title: "B", url: "https://fine.example.org/b", snippet: "ok", image: "https://cdn.bad.example.net/i.jpg", thumbnail: "https://fine.example.org/t.jpg" },
        { title: "C", url: "https://fine.example.org/c", snippet: "ok" },
      ],
      pages: [
        { title: "A", url: "https://bad.example.com/a", text: "fine text" },
        { title: "C", url: "https://fine.example.org/c", text: "fine text" },
      ],
    } as never;
    const out = floorSearchResult(result, "child") as { rows: Array<{ title: string; image?: string; thumbnail?: string }>; pages?: Array<{ title: string }> };
    expect(out.rows.map((r) => r.title)).toEqual(["B", "C"]);
    expect(out.rows[0]!.image).toBeUndefined();
    expect(out.rows[0]!.thumbnail).toBe("https://fine.example.org/t.jpg");
    expect(out.pages?.map((p) => p.title)).toEqual(["C"]);
  });

  test("every producer of a link a minor can see is wired to the matcher (inventory guard)", () => {
    const root = join(import.meta.dir, "..", "src", "lib");
    const host = readFileSync(join(root, "packageHost.ts"), "utf-8");
    const select = readFileSync(join(root, "answerImages", "select.ts"), "utf-8");
    expect(host.match(/urlAllowedFor\(/g)!.length).toBeGreaterThanOrEqual(5);
    expect(host).toContain("blocked site is not fetched");
    expect(select).toContain("urlAllowedFor(input.band, c.url)");
  });
});

describe("microbench", () => {
  test("a lookup in a 1,000,000 host table stays well under a millisecond", () => {
    const lines: string[] = [];
    for (let i = 0; i < 1_000_000; i++) lines.push(`h${i}.example-${i % 997}.test`);
    load("blp-porn", lines.join("\n") + "\n");
    checkHost("child", "https://warm.example.org/");
    const t0 = performance.now();
    const n = 2000;
    for (let i = 0; i < n; i++) checkHost("child", `https://www.h${i * 7}.example-${(i * 7) % 997}.test/p`);
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(1);
  }, 60_000);
});
