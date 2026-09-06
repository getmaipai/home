// The smoke-test mechanism (docs/PACKAGES.md's bronze bar, platform plan
// 4.10): "a smoke entry that runs where the package will live, at
// install, at every update, and on a schedule. A failure leaves it
// installed but disabled with a Repairs item." No install/update flow
// exists yet (step 6 builds the store); until then, `runAllSmokeTests()`
// is called once at boot (index.ts) as the stand-in for "at install",
// and daily through the `packages.smoke` core job (scheduler.ts) for
// "on a schedule". A package's own `manifest.json.smoke` field says how
// to check it:
//
// - `{ "kind": "static" }`: no recipe, nothing to run against a host - a
//   `kind: "skill"` package (plain instructions) or any package with
//   nothing more to prove than "it loads." Confirms loadSkill()/
//   loadPackage() succeeds.
// - `{ "kind": "recipe_fixture", "fixture": "<path relative to the
//   package dir>" }`: a Tier 0 plugin. Runs the package's own recipe.json
//   through the exact same interpreter production uses
//   (spec/interpreters/ts/recipe-interpreter.ts), against a HostEmulator
//   seeded from the fixture - never the real host (packageHost.ts): a
//   smoke test must be deterministic and offline (the org testing
//   standard), so it proves the recipe's own logic is intact, not that
//   the third-party API is up right now. Same fixture shape as
//   spec/fixtures/recipes/*.json's conformance fixtures
//   (spec/tests/ts/recipe-conformance.test.ts), minus the embedded
//   `recipe` (the package's own recipe.json is already right there).
// - `{ "kind": "deno_test" }`: a Tier 1 package. Not implemented until
//   the Deno host lands (step 5); recorded as a failure with a clear
//   message rather than silently skipped, so a Tier 1 package can never
//   read as smoke-clean before the mechanism that would prove it exists.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { packageStatus } from "@/db/schema";
import { listPackageIds, loadPackage } from "@/lib/plugins";
import { loadSkill } from "@/lib/skills";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { isValidPackageId } from "@/lib/paths";
import { resolvePackageDir } from "@/lib/packageResolve";
import { HostEmulator } from "@maipai/spec/emulators/ts/host-emulator.js";
import { runRecipe } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";

const ISSUE_SOURCE = "packages";

export interface SmokeResult {
  ok: boolean;
  message: string;
}

interface SmokeFixture {
  description?: string;
  inputs: Record<string, unknown>;
  host_setup: {
    fetch?: Record<string, unknown>;
    config?: Record<string, unknown>;
    memory?: { text: string; category?: string; scope?: string; person?: string }[];
  };
  expected: {
    reply: { text: string; speech?: string } | null;
    actions: { kind: string; payload?: unknown }[];
    scheduled_jobs: { when: string; job: string }[];
    home_calls: { domain: string; service: string; target: unknown; data: unknown }[];
    memory_added: { text: string; category?: string; scope?: string }[];
  };
}

async function recordResult(id: string, result: SmokeResult): Promise<SmokeResult> {
  const now = new Date().toISOString();
  db.insert(packageStatus)
    .values({
      packageId: id,
      status: result.ok ? "enabled" : "disabled",
      lastSmokeAt: now,
      smokeOk: result.ok,
      smokeMessage: result.message,
    })
    .onConflictDoUpdate({
      target: packageStatus.packageId,
      set: { status: result.ok ? "enabled" : "disabled", lastSmokeAt: now, smokeOk: result.ok, smokeMessage: result.message },
    })
    .run();

  if (result.ok) {
    resolveIssue(ISSUE_SOURCE, id);
  } else {
    await raiseIssue({
      source: ISSUE_SOURCE,
      key: id,
      severity: "error",
      title: `${id} failed its smoke test`,
      detail: result.message,
    });
  }
  return result;
}

async function runRecipeFixtureSmoke(id: string, fixturePath: string): Promise<SmokeResult> {
  const loaded = loadPackage(id);
  if (!loaded.ok) return { ok: false, message: `package failed to load: ${loaded.error}` };

  let fixture: SmokeFixture;
  try {
    fixture = JSON.parse(readFileSync(join(resolvePackageDir(id), fixturePath), "utf-8"));
  } catch (err) {
    return { ok: false, message: `smoke fixture ${fixturePath} failed to load: ${(err as Error).message}` };
  }

  const host = new HostEmulator();
  for (const [url, body] of Object.entries(fixture.host_setup.fetch ?? {})) {
    host.setFetchResponse(url, body);
  }
  for (const [key, value] of Object.entries(fixture.host_setup.config ?? {})) {
    host.seedConfig(key, value);
  }
  if (fixture.host_setup.memory) host.seedMemory(fixture.host_setup.memory);

  let actualReply: { text: string; speech?: string } | null;
  try {
    const result = await runRecipe(loaded.value.recipe, fixture.inputs, host);
    actualReply = result.reply ?? null;
    const mismatches: string[] = [];
    if (JSON.stringify(actualReply) !== JSON.stringify(fixture.expected.reply)) {
      mismatches.push(`reply: expected ${JSON.stringify(fixture.expected.reply)}, got ${JSON.stringify(actualReply)}`);
    }
    if (JSON.stringify(result.actions) !== JSON.stringify(fixture.expected.actions)) {
      mismatches.push(`actions: expected ${JSON.stringify(fixture.expected.actions)}, got ${JSON.stringify(result.actions)}`);
    }
    const scheduled = host.scheduledJobs.map(({ when, job }) => ({ when, job }));
    if (JSON.stringify(scheduled) !== JSON.stringify(fixture.expected.scheduled_jobs)) {
      mismatches.push(`scheduled_jobs: expected ${JSON.stringify(fixture.expected.scheduled_jobs)}, got ${JSON.stringify(scheduled)}`);
    }
    if (JSON.stringify(host.homeCallsLog) !== JSON.stringify(fixture.expected.home_calls)) {
      mismatches.push(`home_calls: expected ${JSON.stringify(fixture.expected.home_calls)}, got ${JSON.stringify(host.homeCallsLog)}`);
    }
    const memoryAdded = host.memoryStore.map(({ text, category, scope }) => ({ text, category, scope }));
    if (JSON.stringify(memoryAdded) !== JSON.stringify(fixture.expected.memory_added)) {
      mismatches.push(`memory_added: expected ${JSON.stringify(fixture.expected.memory_added)}, got ${JSON.stringify(memoryAdded)}`);
    }
    if (mismatches.length > 0) return { ok: false, message: mismatches.join("; ") };
    return { ok: true, message: "smoke fixture matched" };
  } catch (err) {
    return { ok: false, message: `recipe threw: ${(err as Error).message}` };
  }
}

// A Tier 1 package's own `deno test`, run under the identical read
// permission its real sandbox gets (session-d-packages-and-store.md
// step 5, lib/denoHost.ts) - a package that writes tests only against
// its own pure logic (never the MCP round-trip itself, which needs the
// hub's real host.fetch bridge a bare `deno test` has no access to)
// never needs `--allow-write` or `--allow-net` here either. `--cached-
// only` matches denoHost.ts's own real spawn: a smoke check proves the
// package still works OFFLINE, against whatever's already cached, the
// same "deterministic and offline" standard every other smoke kind
// already holds to (`--no-remote` looked like the same guarantee but is
// actually stricter - it refuses a cached remote module too, not just a
// network fetch, which broke on this package's own jsr: import; a real
// finding while wiring this up). `--no-check`: `deno run` (denoHost.ts's
// own real spawn) never type-checks by default, only `deno test`/
// `deno check` do - matching that instead of holding smoke to a
// stricter bar production doesn't clear either, and sidesteps a real
// Deno resolver limitation with versioned npm subpath specifiers
// (`npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js`) that only
// affects the type-checking pass, not execution.
// COR-2 (code review, 2026-09-06): this had no timeout at all - a Tier 1
// package's own deno_test hanging (at boot, via runAllSmokeTests(), or on
// the daily packages.smoke core job) used to hang whichever caller
// awaited this forever, right along with it (the core job case doubles
// as scheduler.ts's own COR-2 fix - a timeout here means that job can
// itself eventually time out instead of wedging the scheduler). Bun's
// own `timeout` spawn option (ms) sends `killSignal` (SIGTERM, the
// default) once exceeded - exitCode is then non-zero, so this reports as
// an ordinary smoke failure, not a special case.
const DENO_TEST_TIMEOUT_MS = 60_000;

// Takes `dir` directly, not a package id (a review, 2026-09-06, needed
// this to write a real timeout test against a disposable temp directory
// - the exact same "never a real bundled package under PACKAGES_DIR"
// posture lib/denoHost.ts's own real-spawn permission tests already take,
// denoHost.test.ts's own header explains why).
export async function runDenoTestSmoke(dir: string, timeoutMs: number = DENO_TEST_TIMEOUT_MS): Promise<SmokeResult> {
  const proc = Bun.spawn(["deno", "test", "--no-check", `--allow-read=${dir}`, "--cached-only", dir], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode === 0) return { ok: true, message: "deno test passed" };
  if (proc.signalCode) {
    return { ok: false, message: `deno test timed out after ${timeoutMs}ms and was killed (${proc.signalCode})` };
  }
  return { ok: false, message: `deno test failed (exit ${exitCode}): ${(stderr || stdout).slice(0, 500)}` };
}

/** Runs one package's declared smoke check and records the result
 * (packageStatus row, plus raiseIssue/resolveIssue). Never throws: an
 * unrecognized or missing smoke declaration is itself a smoke failure,
 * not an exception a caller has to handle specially. */
export async function runSmoke(id: string): Promise<SmokeResult> {
  // SEC-2 (code review, 2026-09-06): POST /:id/smoke (routes/plugins.ts)
  // passes the raw route param straight here - without this, an
  // owner/admin could point a `deno test`/recipe-fixture run at any
  // directory the id resolves to via `..%2F` traversal, not just a real
  // bundled package's own.
  if (!isValidPackageId(id)) {
    return recordResult(id, { ok: false, message: `${id} is not a valid package id` });
  }
  let manifestJson: { kind?: string; smoke?: { kind?: string; fixture?: string } };
  try {
    manifestJson = JSON.parse(readFileSync(join(resolvePackageDir(id), "manifest.json"), "utf-8"));
  } catch (err) {
    return recordResult(id, { ok: false, message: `manifest.json failed to load: ${(err as Error).message}` });
  }

  const smoke = manifestJson.smoke;
  if (!smoke?.kind) {
    // Not disabled and no issue raised: a package with no `smoke` entry
    // yet (e.g. a package another session owns and hasn't reached bronze
    // for real yet, docs/PACKAGES.md) hasn't regressed, it just hasn't
    // been built out to the standard this file checks. Disabling it
    // anyway would be this session's own infrastructure reaching across
    // ownership lines to break a package it doesn't own. The bronze
    // *completeness* gate (every bundled package MUST declare one) is a
    // build-time check instead: spec/tests/ts/package-bronze.test.ts.
    return { ok: true, message: "no smoke entry declared yet (not bronze-complete, not treated as a runtime failure)" };
  }

  if (smoke.kind === "static") {
    if (manifestJson.kind === "skill") {
      const loadedSkill = loadSkill(id);
      return recordResult(id, loadedSkill ? { ok: true, message: "skill loads" } : { ok: false, message: "skill failed to load" });
    }
    const loaded = loadPackage(id);
    return recordResult(id, loaded.ok ? { ok: true, message: "package loads" } : { ok: false, message: loaded.error });
  }

  if (smoke.kind === "recipe_fixture") {
    if (!smoke.fixture) return recordResult(id, { ok: false, message: "smoke.fixture is required for kind: recipe_fixture" });
    return recordResult(id, await runRecipeFixtureSmoke(id, smoke.fixture));
  }

  if (smoke.kind === "deno_test") {
    return recordResult(id, await runDenoTestSmoke(resolvePackageDir(id)));
  }

  return recordResult(id, { ok: false, message: `unrecognized smoke.kind: ${smoke.kind}` });
}

/** Every bundled package's manifest-declared smoke check, in one pass -
 * the boot-time stand-in for "at install" and the body of the daily
 * `packages.smoke` core job (scheduler.ts). */
export async function runAllSmokeTests(): Promise<{ ran: number; failed: number }> {
  let ran = 0;
  let failed = 0;
  for (const id of listPackageIds()) {
    const result = await runSmoke(id);
    ran++;
    if (!result.ok) failed++;
  }
  return { ran, failed };
}

export interface PackageStatusRow {
  status: "enabled" | "disabled";
  lastSmokeAt: string | null;
  smokeOk: boolean | null;
  smokeMessage: string | null;
}

const DEFAULT_STATUS: PackageStatusRow = { status: "enabled", lastSmokeAt: null, smokeOk: null, smokeMessage: null };

/** A package with no row yet (never smoke-tested) reads as enabled with
 * no smoke history - the same "absence isn't failure" default a fresh
 * install would have before its first check ever runs. */
export function getPackageStatus(id: string): PackageStatusRow {
  const row = db.select().from(packageStatus).where(eq(packageStatus.packageId, id)).get();
  if (!row) return DEFAULT_STATUS;
  return {
    status: row.status as "enabled" | "disabled",
    lastSmokeAt: row.lastSmokeAt,
    smokeOk: row.smokeOk,
    smokeMessage: row.smokeMessage,
  };
}

export function allPackageStatuses(): Map<string, PackageStatusRow> {
  const rows = db.select().from(packageStatus).all();
  return new Map(
    rows.map((row) => [
      row.packageId,
      { status: row.status as "enabled" | "disabled", lastSmokeAt: row.lastSmokeAt, smokeOk: row.smokeOk, smokeMessage: row.smokeMessage },
    ]),
  );
}
