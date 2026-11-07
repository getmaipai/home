import { describe, expect, test } from "bun:test";
import { HAS_DENO } from "./support/deno";

// AUDIT-VERIFY-01: about 25 tests (package sandbox, actor isolation, almanac) skip silently when Deno cannot run the bundled
// handlers (tests/support/deno.ts). On the gate machine that would hide a whole safety surface, so a missing or empty-cache Deno
// fails here loudly. The sandboxed Codex run has no Deno by design; `scripts/wt.sh run` sets MAIPAI_ALLOW_NO_DENO=1 for it.
describe("Deno gate", () => {
  test("Deno runs the bundled handlers on this machine, or MAIPAI_ALLOW_NO_DENO=1 says it cannot", () => {
    if (process.env.MAIPAI_ALLOW_NO_DENO === "1") return;
    expect(
      HAS_DENO,
      "deno is missing or its npm cache is empty: ~25 sandbox, actor-isolation and almanac tests would skip silently. Install it (~/.local/bin/deno), run scripts/install.sh to fill the cache, or set MAIPAI_ALLOW_NO_DENO=1 in a sandbox that cannot run it.",
    ).toBe(true);
  });
});
