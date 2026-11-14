import { afterEach, describe, expect, test } from "bun:test";
import { __resetListenRequestsForTests, __setListenCommandIssuerForTests, requestListen, resolveListen } from "./listenRequests";

afterEach(() => { __resetListenRequestsForTests(); __setListenCommandIssuerForTests(null); });

describe("robot listen requests", () => {
  test("issues a short-lived command and resolves the matching request", async () => {
    let requestId = "";
    __setListenCommandIssuerForTests((_device, kind, payload, expiry) => {
      expect(kind).toBe("listen_song"); expect(expiry).toBe(60_000);
      requestId = String(payload.request_id);
      expect(requestId).toMatch(/^[A-Za-z0-9]{12}$/);
      return {} as never;
    });
    const pending = requestListen("robot-1", { seconds: 8 });
    resolveListen("robot-1", requestId, { status: "no_match" });
    expect(await pending).toEqual({ status: "no_match" });
  });
  test("ignores a reply from a different device", async () => {
    let requestId = "";
    __setListenCommandIssuerForTests((_device, _kind, payload) => { requestId = String(payload.request_id); return {} as never; });
    const pending = requestListen("robot-1", { timeoutMs: 15 });
    resolveListen("robot-2", requestId, { status: "no_match" });
    expect(await pending).toEqual({ status: "timeout" });
  });
  test("times out and permits a later waiter for the id space", async () => {
    __setListenCommandIssuerForTests(() => ({} as never));
    expect(await requestListen("robot-1", { timeoutMs: 10 })).toEqual({ status: "timeout" });
  });
});
