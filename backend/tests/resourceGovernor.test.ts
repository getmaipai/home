import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { getChatClient, getEngineStatus, restartChatBackend, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import {
  startResourceGovernor,
  __setGovernorTuningForTestsOnly,
  __resetGovernorTuningForTests,
  __stopAllGovernorsForTests,
} from "@/lib/resourceGovernor";
import { listIssues, __resetFixHandlersForTests } from "@/lib/issues";
import { resetDb } from "./reset-db";

// The tier-2 (developer override) spawn path is the only real, non-mocked
// way to get llmSupervisor.ts's private chatBackend state (and so
// getEngineStatus().pid) to point at a process these tests control - tier
// 3 needs a real downloaded GGUF + engine binary neither this suite nor
// llmSupervisor.test.ts's own tests have. See docs/dev.md's
// resource-governor entry for why trigger B (process-vs-baseline) is
// consequently only exercised here via startResourceGovernor() called
// directly against that same real, live pid - real process, real
// measurement, a deliberately chosen ceiling, never a mocked one.
const FAKE_BIN = join(import.meta.dir, "fixtures", "fakeLlamaServer.ts");

// tests/preload.ts's isolated chat port, captured so afterEach can put it
// BACK rather than delete it. The original `delete` here was the live
// bug behind "the chat engine dies silently" (docs/dev.md, "What was
// actually killing the chat engine", 2026-09-07): with the variable
// gone, a later test file's spawn resolved llmSupervisor.ts's default
// port 8788 and freePort() SIGKILLed the real dev hub's engine on this
// same machine. tests/isolation.ts now fails any test that leaves it
// unset; this is the fix at the source.
const ISOLATED_CHAT_PORT = process.env.MAIPAI_LLAMA_SERVER_PORT;

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
  __resetLlmSupervisorForTests();
  // Fast enough to reach a sustained breach in well under a second, and a
  // much smaller absolute overage floor than production's 500MB - a real
  // test fixture holding half a gigabyte of ballast just to cross that
  // floor would make these tests slow and heavy for no added confidence
  // over a smaller real allocation crossing a smaller real floor.
  __setGovernorTuningForTestsOnly({
    pollMs: 100,
    systemSustainedPolls: 2,
    processSustainedPolls: 2,
    processMinOverageBytes: 10_000_000, // 10MB
  });
});

afterEach(async () => {
  __stopAllGovernorsForTests();
  await __resetLlmSupervisorForTests();
  __resetGovernorTuningForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_BIN;
  delete process.env.MAIPAI_CHAT_MODEL_PATH;
  process.env.MAIPAI_LLAMA_SERVER_PORT = ISOLATED_CHAT_PORT;
  delete process.env.FAKE_LLAMA_INFLATE_MB;
});

async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitUntil() timed out");
}

describe("resourceGovernor: trigger B (process usage vs. its own baseline)", () => {
  test("sustained real RSS growth past baseline x1.3 raises a Repairs issue and restarts the backend", async () => {
    process.env.MAIPAI_LLAMA_SERVER_BIN = FAKE_BIN;
    process.env.MAIPAI_CHAT_MODEL_PATH = "/dev/null";
    process.env.MAIPAI_LLAMA_SERVER_PORT = "39302";
    process.env.FAKE_LLAMA_INFLATE_MB = "50"; // a real, resident ~50MB+ allocation

    const client = await getChatClient(); // real tier-2 spawn of the fixture
    expect(await client.health()).toBe(true);
    const pid = getEngineStatus().pid!;
    expect(pid).toBeGreaterThan(0);

    // Tier 2's own automatic governor (wired in llmSupervisor.ts) only
    // watches trigger A (no model metadata to size trigger B against) -
    // exercise trigger B directly against this same real, live pid with a
    // deliberately tiny baseline its real inflated RSS will genuinely
    // exceed.
    startResourceGovernor({ pid, hasCuda: false, ceilingBaselineBytes: 5_000_000 });

    await waitUntil(() => listIssues().some((i) => i.source === "resource-governor" && i.key === "chat"), 5_000);
    const issue = listIssues().find((i) => i.source === "resource-governor")!;
    expect(issue.severity).toBe("error");
    expect(issue.detail).toMatch(/exceeded its expected ceiling/);

    // restartChatBackend() actually ran: the backend is no longer the one
    // this test started.
    await waitUntil(() => getEngineStatus().pid !== pid, 5_000);
  }, 15_000);
});

describe("resourceGovernor: staleness guard against a racing manual restart", () => {
  test("a manual restart mid-breach-accumulation stops the stale governor from ever acting", async () => {
    process.env.MAIPAI_LLAMA_SERVER_BIN = FAKE_BIN;
    process.env.MAIPAI_CHAT_MODEL_PATH = "/dev/null";
    process.env.MAIPAI_LLAMA_SERVER_PORT = "39303";
    process.env.FAKE_LLAMA_INFLATE_MB = "50";

    await getChatClient();
    const oldPid = getEngineStatus().pid!;

    // Same tiny baseline as above - this WOULD trip after
    // processSustainedPolls (2) ticks at pollMs (100ms) if left alone.
    startResourceGovernor({ pid: oldPid, hasCuda: false, ceilingBaselineBytes: 5_000_000 });
    await new Promise((r) => setTimeout(r, 150)); // let exactly one tick land (1 breach so far)

    // Simulate a model swap / manual restart racing in before the second
    // sustained breach - the same scenario the design-review pass flagged.
    await restartChatBackend();

    // Well past when it would have tripped had the race not been guarded.
    await new Promise((r) => setTimeout(r, 1_000));

    expect(listIssues().some((i) => i.source === "resource-governor")).toBe(false);
    expect(getEngineStatus().pid).not.toBe(oldPid);
  }, 10_000);
});

describe("resourceGovernor: tier-2 override wiring", () => {
  test("a developer-override spawn starts a governor at all (trigger A only, no crash from a null baseline)", async () => {
    process.env.MAIPAI_LLAMA_SERVER_BIN = FAKE_BIN;
    process.env.MAIPAI_CHAT_MODEL_PATH = "/dev/null";
    process.env.MAIPAI_LLAMA_SERVER_PORT = "39304";

    const client = await getChatClient();
    expect(await client.health()).toBe(true);
    // Real system memory on a CI/dev box is not under pressure, so trigger
    // A should not fire in this short window - proves the wiring doesn't
    // spuriously restart a perfectly healthy override spawn.
    await new Promise((r) => setTimeout(r, 500));
    expect(getEngineStatus().pid).not.toBeNull();
    expect(listIssues().some((i) => i.source === "resource-governor")).toBe(false);
  }, 10_000);
});
