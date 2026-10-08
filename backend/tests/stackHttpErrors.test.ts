import { describe, expect, test } from "bun:test";
import { StackError } from "@/lib/stack/errors";
import { classifyStackError } from "@/lib/stack/httpErrors";

describe("classifyStackError", () => {
  test("offline carries the reason the Stack stated", () => {
    expect(classifyStackError(new StackError("offline", "chat is down", { offline_reason: "no model loaded" }))).toEqual({
      status: 503,
      body: { error: "chat is down", reason: "no model loaded" },
    });
  });
  test("unreachable is a 503 with no reason", () => {
    const failure = classifyStackError(new StackError("unreachable", "no socket"));
    expect(failure.status).toBe(503);
    expect(failure.body.error).toBe("no socket");
    expect((failure.body as { reason?: string }).reason).toBeUndefined();
  });
  test("unverified is a 409", () => {
    expect(classifyStackError(new StackError("unverified", "not verified"))).toEqual({ status: 409, body: { error: "not verified" } });
  });
  test("unknown is a 400", () => {
    expect(classifyStackError(new StackError("unknown", "bad request"))).toEqual({ status: 400, body: { error: "bad request" } });
  });
  test("timeout is a 504", () => {
    expect(classifyStackError(new StackError("timeout", "too slow"))).toEqual({ status: 504, body: { error: "too slow" } });
  });
  test("cancelled and unexpected fall back to a 503", () => {
    expect(classifyStackError(new StackError("cancelled", "stopped"))).toEqual({ status: 503, body: { error: "stopped" } });
    expect(classifyStackError(new StackError("unexpected", "odd"))).toEqual({ status: 503, body: { error: "odd" } });
  });
  test("a plain Error and a non-error value are both a 503", () => {
    expect(classifyStackError(new Error("boom"))).toEqual({ status: 503, body: { error: "boom" } });
    expect(classifyStackError("just text")).toEqual({ status: 503, body: { error: "just text" } });
  });
});
