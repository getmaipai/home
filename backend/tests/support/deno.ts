// TEST-RED-01: Deno is optional in the product, so a test that spawns the real Deno sandbox
// (a Tier 1 package, the sandbox's own permission model) runs only where `deno` is on PATH.
// The "Deno is optional" tests in smoke.test.ts cover the machine without one.
export const HAS_DENO = Boolean(Bun.which("deno"));
