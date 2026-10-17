import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "@/lib/api";
import { HUB_DOWN_LINE, hubErrorMessage, isHubUnreachable, waitForHub } from "@/lib/hubReachability";

describe("isHubUnreachable", () => {
  test("a refused or dropped request, and a proxy's 502, 504 or bare 503, mean the hub did not answer", () => {
    expect(isHubUnreachable(new TypeError("Failed to fetch"))).toBe(true);
    expect(isHubUnreachable(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isHubUnreachable(new ApiError("Bad Gateway", 502))).toBe(true);
    expect(isHubUnreachable(new ApiError("Gateway Timeout", 504))).toBe(true);
    expect(isHubUnreachable(new ApiError("Service Unavailable", 503))).toBe(true);
  });

  test("an answer from the hub, even a refusal, is not the hub being down", () => {
    expect(isHubUnreachable(new ApiError("Chat is paused", 503, "chat_paused"))).toBe(false);
    expect(isHubUnreachable(new ApiError("Still downloading", 503, "ai_installing"))).toBe(false);
    expect(isHubUnreachable(new ApiError("No", 403))).toBe(false);
    expect(isHubUnreachable(new Error("boom"))).toBe(false);
  });
});

describe("hubErrorMessage", () => {
  test("says Home is restarting when the hub is down, and keeps the hub's own words when it answered", () => {
    expect(hubErrorMessage(new TypeError("Failed to fetch"))).toBe(HUB_DOWN_LINE);
    expect(hubErrorMessage(new ApiError("Wrong passcode", 401))).toBe("Wrong passcode");
    expect(HUB_DOWN_LINE).toBe("Home is restarting or updating. It will be back in a minute.");
  });
});

describe("waitForHub", () => {
  test("keeps asking until the hub answers, then resolves true", async () => {
    let calls = 0;
    const up = waitForHub(undefined, () => (++calls < 3 ? Promise.reject(new TypeError("down")) : Promise.resolve()));
    // The first ask is immediate; later ones wait 3 s, so wait for it with a patched timer.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as unknown as typeof setTimeout;
    try { expect(await up).toBe(true); } finally { globalThis.setTimeout = realSetTimeout; }
    expect(calls).toBe(3);
  });

  test("an answer of any kind counts, and an abort stops the wait", async () => {
    expect(await waitForHub(undefined, () => Promise.resolve(new Response("", { status: 401 })))).toBe(true);
    const controller = new AbortController();
    const waiting = waitForHub(controller.signal, () => Promise.reject(new TypeError("down")));
    controller.abort();
    expect(await waiting).toBe(false);
  });
});

describe("the offline page a hub-down navigation gets from the service worker", () => {
  const html = readFileSync(join(import.meta.dir, "../../public/offline.html"), "utf8");
  const script = readFileSync(join(import.meta.dir, "../../public/offline.js"), "utf8");

  test("says what is happening and loads the poller", () => {
    expect(html).toContain("Home is restarting or updating");
    expect(html).toContain("It will be back in a minute");
    expect(html).toContain('<script src="/offline.js"></script>');
  });

  test("asks the hub every 3 s, easing off, and reloads when it answers", () => {
    expect(script).toContain('fetch("/api/health"');
    expect(script).toContain("3000");
    expect(script).toContain("window.location.reload()");
  });
});
