import { expect, test } from "bun:test";
import { watchSocket } from "../public/reconnect.js";

test("the page says Reconnecting, retries until the server is back, then carries on with the same handlers", () => {
  const sockets: any[] = [], said: string[] = [], timers: Array<() => void> = [];
  let opened = 0; const first: any = { url: "ws://x/ws", onopen: () => { opened++; }, onmessage: () => {} }; sockets.push(first);
  let current = first;
  watchSocket(first, { make: () => { const s: any = { url: "ws://x/ws" }; sockets.push(s); return s; }, status: (t: string) => said.push(t), timer: (fn: () => void) => { timers.push(fn); return 0; }, onSwap: (n: any) => { current = n; } });
  first.onclose();                                  // server restarted
  expect(said.at(-1)).toBe("Reconnecting...");
  timers.shift()!(); expect(sockets.length).toBe(2); current.onclose();   // still down: tries again
  expect(said.filter((t) => t === "Reconnecting...").length).toBe(2);
  timers.shift()!(); expect(sockets.length).toBe(3);
  current.onopen({}); expect(said.at(-1)).toBe("Reconnected."); expect(opened).toBe(1); // the original open handler runs again: hello is re-sent
  expect(current.onmessage).toBe(first.onmessage);
});
