import { describe, expect, test } from "bun:test";
import { createClientErrorReporter } from "./clientErrors";

describe("client error reports", () => {
  test("deduplicates the same report for five seconds", () => {
    let time = 1000;
    const sent: string[] = [];
    const report = createClientErrorReporter({ now: () => time, send: (body) => sent.push(body), route: () => "/music?tab=all" });
    report({ kind: "error", message: "decode failed" });
    report({ kind: "unhandledrejection", message: "decode failed" });
    time += 5001;
    report({ kind: "error", message: "decode failed" });
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[0]!).route).toBe("/music");
  });

  test("never throws when report building or sending fails", () => {
    const report = createClientErrorReporter({ now: () => { throw new Error("clock failed"); }, send: () => { throw new Error("send failed"); } });
    expect(() => report({ kind: "player", message: "play failed" })).not.toThrow();
    const safeSend = createClientErrorReporter({ now: () => 1, send: () => { throw new Error("send failed"); } });
    expect(() => safeSend({ kind: "error", message: "broken" })).not.toThrow();
  });
});
