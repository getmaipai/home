import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadManifestOnly } from "@/lib/plugins";
import {
  callTier1Handle,
  buildDenoRunArgs,
  __resetDenoHostForTests,
  __setTestFetchDelayMsForTests,
  __testCurrentActorId,
  type CallTier1Result,
} from "@/lib/denoHost";
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import { cachedFetch, __resetPackageCacheForTests, __clearPackageCacheDirForTests } from "@/lib/packageCache";
import { listIssues } from "@/lib/issues";

beforeEach(() => {
  resetDb();
  __resetDenoHostForTests();
  __resetPackageCacheForTests();
  __clearPackageCacheDirForTests("knowledge");
});

afterEach(() => {
  __resetDenoHostForTests();
  __setTestFetchDelayMsForTests(null);
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return row;
}

async function ownerAndChildRows() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const created = await client.post("/api/people", { displayName: "Bramble", role: "child" });
  const childId = ((await created.json()) as { id: string }).id;
  const childRow = db.select().from(people).where(eq(people.id, childId)).get()!;
  return { ownerRow, childRow };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fix B (docs/dev.md's "Chat reliability" B1/B2): callTier1Handle() now
// returns CallTier1Result, not a bare PluginResult - `ok: false` is the
// new typed-upstream-error path (denoHost.ts's upstreamFailure()); every
// test in this file still exercises the sandbox's OWN behavior (timeouts,
// fault-disable, concurrent calls), never that new error path, so each
// result here is always `ok: true`.
function unwrap(result: CallTier1Result): PluginResult {
  if (!result.ok) throw new Error(`expected callTier1Handle() to succeed, got upstream error: ${result.message}`);
  return result.value;
}

function knowledgeManifest() {
  const result = loadManifestOnly("knowledge");
  if (!result.ok) throw new Error(`knowledge package failed to load: ${result.error}`);
  return result.value;
}

const WIKIPEDIA_SEATTLE_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/Seattle";

describe("callTier1Handle (session-d-packages-and-store.md step 5)", () => {
  test("the real Deno sandbox answers end to end, from a cache-seeded response - no live network needed", async () => {
    const manifest = knowledgeManifest();
    await cachedFetch("knowledge", manifest.cache, WIKIPEDIA_SEATTLE_URL, undefined, async () => ({
      title: "Seattle",
      extract: "Seattle is a seaport city on the West Coast of the United States.",
      type: "standard",
    }));
    const actor = await owner();
    const result = await callTier1Handle("knowledge", manifest, actor, { topic: "Seattle" });
    expect(unwrap(result).reply?.text).toBe("Seattle: Seattle is a seaport city on the West Coast of the United States.");
  }, 15_000);

  // A code review (2026-09-06) caught a real race: two concurrent calls
  // for a not-yet-started package each used to see no process in the
  // map and spawn their own, orphaning whichever lost the race to set
  // the map slot last - unreachable to the idle sweep or the graceful-
  // exit hook, a permanently leaked child process. Fixed with a shared
  // in-flight-start map; this proves it by firing two calls at the
  // exact same moment and checking only one real `deno` child for this
  // package ever exists afterward.
  test("two concurrent calls for the same cold package share one process, not two", async () => {
    const manifest = knowledgeManifest();
    await cachedFetch("knowledge", manifest.cache, WIKIPEDIA_SEATTLE_URL, undefined, async () => ({
      title: "Seattle",
      extract: "Seattle is a seaport city on the West Coast of the United States.",
      type: "standard",
    }));
    const actor = await owner();
    const [first, second] = await Promise.all([
      callTier1Handle("knowledge", manifest, actor, { topic: "Seattle" }),
      callTier1Handle("knowledge", manifest, actor, { topic: "Seattle" }),
    ]);
    expect(unwrap(first).reply?.text).toBe("Seattle: Seattle is a seaport city on the West Coast of the United States.");
    expect(unwrap(second).reply?.text).toBe(unwrap(first).reply?.text);

    const psOutput = await new Response(Bun.spawn(["pgrep", "-f", "knowledge/handler.ts"], { stdout: "pipe" }).stdout).text();
    const pids = psOutput.split("\n").filter((line) => line.trim().length > 0);
    expect(pids.length).toBe(1);
  }, 15_000);

  // SEC-6 (code review, 2026-09-06): the host/fetch handler used to close
  // over whichever actor happened to be the FIRST caller to start this
  // package's process, and every later caller's host.* calls (a future
  // memory/config bridge, this file's own header names it) would have
  // silently run as that first actor forever. Fixed with a per-process
  // turn lock: one caller's actor is "current" at a time, and a second
  // caller queues behind the first rather than racing it.
  test("two concurrent callers with different actors never see each other's actor mid-flight", async () => {
    const manifest = knowledgeManifest();
    await cachedFetch("knowledge", manifest.cache, WIKIPEDIA_SEATTLE_URL, undefined, async () => ({
      title: "Seattle",
      extract: "Seattle is a seaport city on the West Coast of the United States.",
      type: "standard",
    }));
    const { ownerRow, childRow } = await ownerAndChildRows();

    // Warms the real Deno process first, outside the timed part of this
    // test - a cold `deno run` spawn + MCP connect can itself take longer
    // than the delay below, which would make the timing assertions below
    // meaningless.
    await callTier1Handle("knowledge", manifest, ownerRow, { topic: "Seattle" });

    __setTestFetchDelayMsForTests(300);
    const first = callTier1Handle("knowledge", manifest, ownerRow, { topic: "Seattle" });
    await sleep(50); // let the owner's call actually start and take the lock
    expect(__testCurrentActorId("knowledge")).toBe(ownerRow.id);

    const second = callTier1Handle("knowledge", manifest, childRow, { topic: "Seattle" });
    await sleep(50); // still well inside the owner's 300ms delay
    expect(__testCurrentActorId("knowledge")).toBe(ownerRow.id); // NOT clobbered by the queued second call

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(unwrap(firstResult).reply?.text).toContain("Seattle");
    expect(unwrap(secondResult).reply?.text).toContain("Seattle");
    expect(__testCurrentActorId("knowledge")).toBe(childRow.id);
  }, 15_000);

  test("a slow handle() past timeout_ms faults and answers with the manifest's own fallback_reply", async () => {
    const manifest = { ...knowledgeManifest(), timeout_ms: 200 };
    __setTestFetchDelayMsForTests(2000); // well past timeout_ms, well under the test's own timeout
    await cachedFetch("knowledge", manifest.cache, WIKIPEDIA_SEATTLE_URL, undefined, async () => ({
      title: "Seattle",
      extract: "irrelevant - the delay means this is never reached in time",
    }));
    const actor = await owner();
    const result = await callTier1Handle("knowledge", manifest, actor, { topic: "Seattle" });
    expect(unwrap(result).reply?.text).toBe(manifest.fallback_reply!.text);
  }, 15_000);

  test("three consecutive timeouts disable the package for the rest of this boot and raise a Repairs issue", async () => {
    const manifest = { ...knowledgeManifest(), timeout_ms: 200 };
    __setTestFetchDelayMsForTests(2000);
    const actor = await owner();
    for (let i = 0; i < 3; i++) {
      await callTier1Handle("knowledge", manifest, actor, { topic: "Seattle" });
    }
    const issue = listIssues().find((i) => i.source === "packages.deno" && i.key === "knowledge");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");

    // A 4th call, even with the delay lifted, still answers from
    // fallback_reply - disabled for the rest of this boot means exactly
    // that, not "until the next call happens to succeed."
    __setTestFetchDelayMsForTests(null);
    await cachedFetch("knowledge", manifest.cache, WIKIPEDIA_SEATTLE_URL, undefined, async () => ({
      title: "Seattle",
      extract: "should never be reached - the package is disabled",
    }));
    const result = await callTier1Handle("knowledge", manifest, actor, { topic: "Seattle" });
    expect(unwrap(result).reply?.text).toBe(manifest.fallback_reply!.text);
  }, 30_000);
});

describe("the sandbox's own permission model (real deno run, no MCP involved)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "maipai-denohost-sandbox-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("a script cannot read outside its own allowed directory", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "maipai-denohost-outside-"));
    const secretPath = join(outsideDir, "secret.txt");
    writeFileSync(secretPath, "should never be readable");
    const scriptPath = join(tempDir, "escape.ts");
    writeFileSync(
      scriptPath,
      `try {
         await Deno.readTextFile(${JSON.stringify(secretPath)});
         console.log("READ_SUCCEEDED");
       } catch (err) {
         console.log("READ_BLOCKED", err.name);
       }`,
    );
    const args = buildDenoRunArgs(tempDir, tempDir, scriptPath);
    const proc = Bun.spawn(["deno", ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    rmSync(outsideDir, { recursive: true, force: true });
    expect(stdout).toContain("READ_BLOCKED");
    expect(stdout).toContain("NotCapable");
  });

  test("a script has no net access at all - host.fetch is the only way out", async () => {
    const scriptPath = join(tempDir, "bypass.ts");
    writeFileSync(
      scriptPath,
      `try {
         await fetch("https://example.com");
         console.log("FETCH_SUCCEEDED");
       } catch (err) {
         console.log("FETCH_BLOCKED", err.name);
       }`,
    );
    const args = buildDenoRunArgs(tempDir, tempDir, scriptPath);
    const proc = Bun.spawn(["deno", ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(stdout).toContain("FETCH_BLOCKED");
    expect(stdout).toContain("NotCapable");
  });

  test("a script CAN read and write within its own allowed directory", async () => {
    const scriptPath = join(tempDir, "write-own.ts");
    const ownFile = join(tempDir, "state.txt");
    writeFileSync(
      scriptPath,
      `await Deno.writeTextFile(${JSON.stringify(ownFile)}, "hello");
       console.log("WROTE:" + await Deno.readTextFile(${JSON.stringify(ownFile)}));`,
    );
    const args = buildDenoRunArgs(tempDir, tempDir, scriptPath);
    const proc = Bun.spawn(["deno", ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(stdout).toContain("WROTE:hello");
  });

  // Every other test in this block passes the SAME directory for both
  // sourceDir and dataDir, which can never catch the real bug found by
  // code review: buildDenoRunArgs()'s own read/write split is correct,
  // but tier1PackageDataDir used to be `data/packages/<id>/` directly
  // while a store-installed package's source lived at
  // `data/packages/<id>/versions/<version>/` - a SUBDIRECTORY of that
  // same writable grant, silently defeating "can never write into its
  // own source tree" the moment a Tier 1 package was store-installed
  // rather than bundled. This test uses two genuinely SEPARATE
  // directories (the shape lib/paths.ts's own tier1PackageDataDir/
  // installedPackageVersionDir now guarantee, tests/paths.test.ts pins
  // the guarantee itself) and proves the sandbox actually enforces it at
  // the `deno run` level, not just in the argument list.
  test("a script cannot write into its own source directory, only its separate data directory", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "maipai-denohost-source-"));
    const dataDir = mkdtempSync(join(tmpdir(), "maipai-denohost-data-"));
    const scriptPath = join(sourceDir, "escape-write.ts");
    const targetInSource = join(sourceDir, "backdoor.ts");
    writeFileSync(
      scriptPath,
      `try {
         await Deno.writeTextFile(${JSON.stringify(targetInSource)}, "backdoor");
         console.log("WRITE_SUCCEEDED");
       } catch (err) {
         console.log("WRITE_BLOCKED", err.name);
       }`,
    );
    try {
      const args = buildDenoRunArgs(sourceDir, dataDir, scriptPath);
      const proc = Bun.spawn(["deno", ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(stdout).toContain("WRITE_BLOCKED");
      expect(stdout).toContain("NotCapable");
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
