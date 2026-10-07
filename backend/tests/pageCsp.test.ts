// PI-RENDER-01 (F1, C6.1 test 5): the app page response carries the CSP, the
// policy blocks every remote image, script, frame and connection, and an API
// route keeps its own headers.
import { describe, expect, test } from "bun:test";
import { app } from "@/app";
import { PAGE_CSP } from "@/middleware/pageCsp";

describe("page Content-Security-Policy", () => {
  test("the app page carries the policy", async () => {
    const res = await app.request("/some/client/route");
    expect(res.headers.get("Content-Security-Policy")).toBe(PAGE_CSP);
  });

  test("images may only come from the hub, data: or blob:", () => {
    const img = PAGE_CSP.split("; ").find((d) => d.startsWith("img-src "))!;
    expect(img).toBe("img-src 'self' data: blob:");
  });

  test("nothing is allowed from a remote host, and frames and forms are shut", () => {
    expect(PAGE_CSP).toContain("default-src 'self'");
    expect(PAGE_CSP).toContain("connect-src 'self'");
    expect(PAGE_CSP).toContain("frame-src 'none'");
    expect(PAGE_CSP).toContain("form-action 'self'");
    expect(PAGE_CSP).toContain("object-src 'none'");
    expect(PAGE_CSP).not.toMatch(/https?:|\*/);
    expect(PAGE_CSP).not.toContain("'unsafe-eval'");
  });

  test("the answer-image route keeps its own stricter policy", async () => {
    const res = await app.request("/api/answer-image/ai_00000000000000000000000000000000?v=tile");
    expect(res.headers.get("Content-Security-Policy")).not.toBe(PAGE_CSP);
  });
});
