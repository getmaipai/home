import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { makeKeyPair, sign, type KeyPair } from "./support/tufFixtures";
import { blockListsDir } from "@/lib/paths";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __setListTrustKeysForTests, verifyListIndex, type ListIndexMetadata, type ListPin } from "@/lib/blocklists/listIndex";
import { __setListsReadyForTests, isListLoaded, listFilePath, listsReadyForBand, readState, reverifyStoredLists, writeState } from "@/lib/blocklists/listStore";
import { neededListIds, runListSync } from "@/lib/blocklists/listSync";
import { listIssues } from "@/lib/issues";

const COMMIT = "a".repeat(40);
const NOW = new Date("2026-10-12T12:00:00Z");
let key: KeyPair;

function pinFor(id: string, text: string, over: Partial<ListPin> = {}): ListPin {
  return {
    id,
    source_url: `https://raw.githubusercontent.com/example/lists/${COMMIT}/${id}.txt`,
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
    entries: text.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length,
    format: "domains",
    licence: "Unlicense",
    upstream: "Example",
    pinned_at: "2026-10-12",
    ...over,
  };
}

function envelope(lists: ListPin[], over: Partial<ListIndexMetadata> = {}) {
  return sign<ListIndexMetadata>(
    { type: "list-index", version: "1", expires: "2026-11-12T00:00:00Z", published: 1_000, lists, ...over },
    [key],
  );
}

function addPerson(id: string, role: string): void {
  const now = NOW.toISOString();
  db.insert(people)
    .values({ id, displayName: id, nickname: null, bio: null, accent: null, role, birthdate: null, avatarSeed: "a", source: "local", localOnly: false, createdAt: now, updatedAt: now, deletedAt: null, hlc: "1:0:abcdefgh", enabled: true, guestExpiresAt: null, memorializedAt: null } as never)
    .run();
}

function serve(files: Record<string, string>, env: ReturnType<typeof envelope>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("list-index.json")) return new Response(JSON.stringify(env), { status: 200, headers: { etag: '"e1"' } });
    for (const [id, text] of Object.entries(files)) if (url.endsWith(`/${id}.txt`)) return new Response(text, { status: 200 });
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
}

const PORN = "example-porn.test.com\nsecond-porn.test.com\n";

let realFetch: typeof fetch;
beforeEach(() => {
  __setListsReadyForTests(null);
  resetDb();
  rmSync(blockListsDir, { recursive: true, force: true });
  __resetRateLimiterForTests();
  key = makeKeyPair();
  __setListTrustKeysForTests([key.publicKeyPem]);
  realFetch = globalThis.fetch;
});
afterEach(() => {
  __setListTrustKeysForTests(null);
  globalThis.fetch = realFetch;
});

describe("verifyListIndex", () => {
  const pin = pinFor("blp-porn", PORN);
  test("a signed, current index verifies and ignores an id the spec does not declare", () => {
    const res = verifyListIndex(envelope([pin, pinFor("not-in-spec", PORN)]), { keys: [key.publicKeyPem], now: NOW.getTime() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pins.map((p) => p.id)).toEqual(["blp-porn"]);
      expect(res.ignored).toEqual(["not-in-spec"]);
    }
  });
  test("an index signed by another key is refused", () => {
    const res = verifyListIndex(envelope([pin]), { keys: [makeKeyPair().publicKeyPem], now: NOW.getTime() });
    expect(res.ok).toBe(false);
  });
  test("with no key pinned the index is refused with an explanation", () => {
    const res = verifyListIndex(envelope([pin]), { keys: [], now: NOW.getTime() });
    expect(!res.ok && res.error).toContain("no catalog signing key");
  });
  test("an expired index is refused", () => {
    const res = verifyListIndex(envelope([pin], { expires: "2026-01-01T00:00:00Z" }), { keys: [key.publicKeyPem], now: NOW.getTime() });
    expect(!res.ok && res.error).toContain("expired");
  });
  test("an older index than one already seen is refused as a rollback", () => {
    const res = verifyListIndex(envelope([pin], { published: 5 }), { keys: [key.publicKeyPem], now: NOW.getTime(), lastPublished: 6 });
    expect(!res.ok && res.error).toContain("rollback");
  });
  test("a pin that is not at an immutable commit is refused", () => {
    const bad = { ...pin, source_url: "https://raw.githubusercontent.com/example/lists/main/blp-porn.txt" };
    const res = verifyListIndex(envelope([bad]), { keys: [key.publicKeyPem], now: NOW.getTime() });
    expect(res.ok).toBe(false);
  });
  test("a pin from another host is refused", () => {
    const bad = { ...pin, source_url: `https://evil.example.com/x/y/${COMMIT}/blp-porn.txt` };
    expect(verifyListIndex(envelope([bad]), { keys: [key.publicKeyPem], now: NOW.getTime() }).ok).toBe(false);
  });
});

describe("lists.sync", () => {
  test("a home with only adults and no adult list makes no connection", async () => {
    addPerson("a1", "adult");
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response("", { status: 500 }); }) as unknown as typeof fetch;
    const out = await runListSync({ now: NOW });
    expect(out.status).toBe("idle");
    expect(called).toBe(false);
  });

  test("a child in the home needs the adult list; a good pass loads it and the band becomes ready", async () => {
    addPerson("c1", "child");
    expect(neededListIds(NOW)).toContain("blp-porn");
    expect(listsReadyForBand("child")).toBe(false);
    const files = { "blp-porn": PORN };
    const env = envelope([pinFor("blp-porn", PORN)]);
    globalThis.fetch = serve(files, env);
    // other default lists are not pinned yet: they stay unloaded, so the band is not ready, and a Repairs item says why
    const out = await runListSync({ now: NOW });
    expect(out.status).toBe("ok");
    const state = readState();
    expect(state.lists["blp-porn"]?.entries).toBe(2);
    expect(existsSync(listFilePath("blp-porn", state.lists["blp-porn"]!.sha256))).toBe(true);
    expect(state.publishedSeen).toBe(1_000);
    expect(listsReadyForBand("child")).toBe(false);
    expect(listIssues().some((i) => i.source === "block-lists")).toBe(true);
  });

  test("a download whose checksum is wrong is deleted, the last good copy stays, and a Repairs item is raised", async () => {
    addPerson("c1", "child");
    const good = pinFor("blp-porn", PORN);
    globalThis.fetch = serve({ "blp-porn": PORN }, envelope([good]));
    await runListSync({ now: NOW });
    const first = readState().lists["blp-porn"]!;

    const next = "changed-one.test.com\nchanged-two.test.com\nchanged-three.test.com\n";
    const badPin = pinFor("blp-porn", next);
    __resetRateLimiterForTests();
    globalThis.fetch = serve({ "blp-porn": "tampered.test.com\n" }, envelope([badPin], { published: 2_000 }));
    const out = await runListSync({ now: new Date(NOW.getTime() + 2 * 86_400_000), force: true });
    expect(out.status).toBe("failed");
    const state = readState();
    expect(state.lists["blp-porn"]?.sha256).toBe(first.sha256);
    expect(existsSync(listFilePath("blp-porn", badPin.sha256))).toBe(false);
    expect(state.backoffDays).toBe(1);
    expect(state.publishedSeen).toBe(1_000);
  });

  test("an entry count that differs from the pin is refused", async () => {
    addPerson("c1", "child");
    const pin = pinFor("blp-porn", PORN, { entries: 99 });
    globalThis.fetch = serve({ "blp-porn": PORN }, envelope([pin]));
    const out = await runListSync({ now: NOW });
    expect(out.status).toBe("failed");
    expect(readState().lists["blp-porn"]).toBeUndefined();
    expect(existsSync(listFilePath("blp-porn", pin.sha256))).toBe(false);
  });

  test("a rolled-back index is refused", async () => {
    addPerson("c1", "child");
    const s = readState();
    s.publishedSeen = 5_000;
    writeState(s);
    globalThis.fetch = serve({ "blp-porn": PORN }, envelope([pinFor("blp-porn", PORN)]));
    const out = await runListSync({ now: NOW });
    expect(out.status).toBe("failed");
    expect(!("error" in out) || out.error).toContain("rollback");
  });

  test("back-off doubles after each non-2xx up to 7 days and the schedule is respected", async () => {
    addPerson("c1", "child");
    globalThis.fetch = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    let now = NOW;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      __resetRateLimiterForTests();
      await runListSync({ now });
      seen.push(readState().backoffDays);
      now = new Date(Date.parse(readState().nextCheckAt!) + 1000);
    }
    expect(seen).toEqual([1, 2, 4, 7, 7]);
    __resetRateLimiterForTests();
    const idle = await runListSync({ now: new Date(now.getTime() - 2000) });
    expect(idle.status).toBe("idle");
  });

  test("an unreachable network does not back off for days", async () => {
    addPerson("c1", "child");
    globalThis.fetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await runListSync({ now: NOW });
    expect(readState().backoffDays).toBe(0);
    expect(Date.parse(readState().nextCheckAt!) - NOW.getTime()).toBe(3_600_000);
  });
});

describe("list file safety", () => {
  test("a pin path with dot segments is refused", () => {
    const pin = pinFor("blp-porn", PORN);
    const bad = { ...pin, source_url: `https://raw.githubusercontent.com/example/lists/${COMMIT}/../../../x/y/main/f.txt` };
    expect(verifyListIndex(envelope([bad]), { keys: [key.publicKeyPem], now: NOW.getTime() }).ok).toBe(false);
  });

  test("a tampered file already sitting at the pinned destination is replaced, never trusted", async () => {
    addPerson("c1", "child");
    const pin = pinFor("blp-porn", PORN);
    mkdirSync(join(blockListsDir, "blp-porn"), { recursive: true });
    writeFileSync(listFilePath("blp-porn", pin.sha256), "tampered.test.com\nother-tamper.test.com\n");
    globalThis.fetch = serve({ "blp-porn": PORN }, envelope([pin]));
    const out = await runListSync({ now: NOW });
    expect(out.status).toBe("ok");
    expect(readFileSync(listFilePath("blp-porn", pin.sha256), "utf-8")).toBe(PORN);
  });

  test("a newly needed list does not wait for the daily schedule", async () => {
    addPerson("a1", "adult");
    const s = readState();
    s.nextCheckAt = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
    writeState(s);
    addPerson("c1", "child");
    globalThis.fetch = serve({ "blp-porn": PORN }, envelope([pinFor("blp-porn", PORN)]));
    const out = await runListSync({ now: NOW });
    expect(out.status).toBe("ok");
    expect(readState().lists["blp-porn"]).toBeDefined();
  });

  test("a list file that vanishes while running reads as not loaded", async () => {
    addPerson("c1", "child");
    globalThis.fetch = serve({ "blp-porn": PORN }, envelope([pinFor("blp-porn", PORN)]));
    await runListSync({ now: NOW });
    expect(isListLoaded("blp-porn")).toBe(true);
    rmSync(listFilePath("blp-porn", readState().lists["blp-porn"]!.sha256));
    expect(isListLoaded("blp-porn")).toBe(false);
  });
});

describe("boot re-verify", () => {
  test("a corrupt current copy rolls back to the previous good copy", async () => {
    addPerson("c1", "child");
    globalThis.fetch = serve({ "blp-porn": PORN }, envelope([pinFor("blp-porn", PORN)]));
    await runListSync({ now: NOW });
    const first = readState().lists["blp-porn"]!;
    const next = "new-one.test.com\nnew-two.test.com\nnew-three.test.com\n";
    __resetRateLimiterForTests();
    globalThis.fetch = serve({ "blp-porn": next }, envelope([pinFor("blp-porn", next)], { published: 2_000 }));
    await runListSync({ now: NOW, force: true });
    const second = readState().lists["blp-porn"]!;
    expect(second.previousSha256).toBe(first.sha256);
    writeFileSync(listFilePath("blp-porn", second.sha256), "tampered.test.com\n");
    const report = await reverifyStoredLists();
    expect(report.rolledBack).toEqual(["blp-porn"]);
    const after = readState().lists["blp-porn"]!;
    expect(after.sha256).toBe(first.sha256);
    expect(after.entries).toBe(2);
  });

  test("a file changed on disk is dropped, and rolls back to a previous good copy when one verifies", async () => {
    addPerson("c1", "child");
    globalThis.fetch = serve({ "blp-porn": PORN }, envelope([pinFor("blp-porn", PORN)]));
    await runListSync({ now: NOW });
    const entry = readState().lists["blp-porn"]!;
    writeFileSync(listFilePath("blp-porn", entry.sha256), "tampered.test.com\n");
    const report = await reverifyStoredLists();
    expect(report.dropped).toEqual(["blp-porn"]);
    expect(readState().lists["blp-porn"]).toBeUndefined();
    expect(existsSync(listFilePath("blp-porn", entry.sha256))).toBe(false);
  });

  test("an intact file is left alone", async () => {
    addPerson("c1", "child");
    globalThis.fetch = serve({ "blp-porn": PORN }, envelope([pinFor("blp-porn", PORN)]));
    await runListSync({ now: NOW });
    const entry = readState().lists["blp-porn"]!;
    const report = await reverifyStoredLists();
    expect(report.dropped).toEqual([]);
    expect(readFileSync(listFilePath("blp-porn", entry.sha256), "utf-8")).toBe(PORN);
  });
});
