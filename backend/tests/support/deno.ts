// TEST-RED-01: Deno is optional in the product, so a test that spawns the real Deno sandbox
// (a Tier 1 package, the sandbox's own permission model) runs only where `deno` is on PATH.
// The "Deno is optional" tests in smoke.test.ts cover the machine without one.
//
// A `deno` on PATH is not enough. The sandbox runs every handler with --cached-only (lib/denoHost.ts), and a handler's npm: imports
// come from the install's own cache (DENO_DIR, filled by scripts/install.sh). A developer machine with a fresh `deno` and an empty cache
// failed almanacSky, minorQueryCheck and packageFallbackBoundary with "npm package not found in cache" (2026-10-22). So the check is the same
// load the sandbox does: can this deno, with the environment the sandbox gives it, import zod from the cache alone.
import { denoEnv } from "@/lib/denoHost";

function denoCanRunBundledHandlers(): boolean {
  const deno = Bun.which("deno");
  if (!deno) return false;
  try {
    const probe = Bun.spawnSync([deno, "eval", "--cached-only", 'import "npm:zod@4.6.5";'], {
      env: { ...denoEnv(), PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdout: "ignore",
      stderr: "ignore",
      timeout: 15_000,
    });
    return probe.exitCode === 0;
  } catch {
    return false;
  }
}

export const HAS_DENO = denoCanRunBundledHandlers();
