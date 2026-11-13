// QUEUE-HOME: the Stack's admission rule counts a call as the household's only with `x-stack-caller: live`. Every Stack call path
// says live for the installed hub, dev for a dev hub (never live), and test under a test run.
import { afterEach, describe, expect, test } from "bun:test";
import { stackCaller, withStackCaller, STACK_CALLER_HEADER } from "@/lib/stack/caller";
import { createStackClient } from "@/lib/stack/client";
import { sendWithView } from "@/lib/stack/fullView";
import { stackFetch } from "@/lib/stack/stackFetch";

const live = {}; const workbench = { MAIPAI_WORKBENCH: "1" }; const own = { MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1" };

describe("which hub is calling the Stack", () => {
  test("the installed hub is live; a workbench or private dev hub is dev; a test run is test", () => {
    expect(stackCaller(live)).toBe("live");
    expect(stackCaller(workbench)).toBe("dev");
    expect(stackCaller(own)).toBe("dev");
    expect(stackCaller({ NODE_ENV: "test" })).toBe("test");
    expect(stackCaller({ NODE_ENV: "test", ...own })).toBe("test");
    expect(stackCaller({ NODE_ENV: "production", ...own })).toBe("dev");
    expect(withStackCaller(undefined, live).get(STACK_CALLER_HEADER)).toBe("live");
    expect(withStackCaller({ [STACK_CALLER_HEADER]: "dev" }, live).get(STACK_CALLER_HEADER)).toBe("dev");
  });
});

describe("every Stack call path carries the header", () => {
  const real = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real; });
  test("a bun test run sends test on the spec client, the view path, and the default fetch for reads and writes", async () => {
    const seen: Array<string | null> = [];
    const spy = (async (_input: unknown, init?: RequestInit) => { seen.push(new Headers(init?.headers).get(STACK_CALLER_HEADER)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const client = createStackClient({ baseUrl: "http://127.0.0.1:8770", fetch: spy });
    await client.health().catch(() => undefined);
    await sendWithView(spy, "http://127.0.0.1:8770", "/stack/v1/video", { method: "GET" });
    globalThis.fetch = spy;
    await stackFetch("http://127.0.0.1:8770/stack/v1/video", { method: "GET" });
    await stackFetch("http://127.0.0.1:8770/stack/v1/video", { method: "POST", body: "{}" }).catch(() => undefined);
    // The key probe (a health read with the priming token) is not a request the Stack admits, so it names no caller.
    const named = seen.filter((value) => value !== null);
    expect(named.length).toBeGreaterThanOrEqual(4);
    expect(named.every((value) => value === "test")).toBe(true);
    expect(seen).not.toContain("live");
  });
});
