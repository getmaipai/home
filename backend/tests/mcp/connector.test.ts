import { describe, expect, test } from "bun:test";
import { createConnector } from "@/lib/mcp/connector";

const fixture = new URL("./fixtures-stdioServer.ts", import.meta.url).pathname;
function make(extra: Record<string, string> = {}, config: Record<string, unknown> = {}) {
  return createConnector({ id: "fixture", transport: { kind: "stdio", command: "bun", args: [fixture], env: { ...process.env as Record<string, string>, ...extra } }, toolAllowlist: ["allow", "error", "x".repeat(70)], ...config } as never);
}

describe("MCP connector", () => {
  test("filters tools by allowlist and re-lists each time", async () => {
    const c = make();
    expect((await c.listTools()).map((t) => t.id)).not.toContain("fixture__deny");
    await c.listTools();
    await c.close();
  });
  test("returns matching pins and disables a changed definition", async () => {
    const c = make({}, { pins: { allow: "wrong" } });
    const listed = await c.listTools();
    expect(listed.find((t) => t.id === "fixture__allow")).toMatchObject({ disabled: true, reason: "definition_changed" });
    expect(await c.callTool("fixture__allow", {})).toEqual({ ok: false, kind: "refused" });
    await c.close();
    const hashSource = make();
    const hash = (await hashSource.listTools()).find((t) => t.id === "fixture__allow")!.hash;
    await hashSource.close();
    const pinned = make({}, { pins: { allow: hash } });
    expect((await pinned.listTools()).find((t) => t.id === "fixture__allow")).not.toHaveProperty("disabled");
    await pinned.close();
  });
  test("refuses unknown tools and maps a long wire name back to the server name", async () => {
    const c = make();
    expect(await c.callTool("fixture__unknown", {})).toEqual({ ok: false, kind: "refused" });
    const listed = await c.listTools();
    const long = listed.find((t) => t.description === "Long name")!;
    expect(long.id.length).toBeLessThanOrEqual(64);
    expect(await c.callTool(long.id, {})).toMatchObject({ ok: true, text: `called:${"x".repeat(70)}` });
    await c.close();
  });
  test("maps server errors to refused and strips controls", async () => {
    const c = make();
    const tools = await c.listTools();
    const allow = tools.find((t) => t.id === "fixture__allow")!;
    expect(await c.callTool(allow.id, {})).toEqual({ ok: true, text: "called:allow", truncated: false });
    expect(await c.callTool("fixture__error", {})).toEqual({ ok: false, kind: "refused" });
    await c.close();
  });
  test("times out and cancels the request; caps oversize result with marker", async () => {
    const slow = make({ FIXTURE_DELAY_MS: "200" }, { callTimeoutMs: 30 });
    await slow.listTools();
    expect(await slow.callTool("fixture__allow", {})).toEqual({ ok: false, kind: "timeout" });
    await slow.close();
    const large = make({ FIXTURE_TEXT: "0123456789" }, { maxResultBytes: 5 });
    await large.listTools();
    expect(await large.callTool("fixture__allow", {})).toEqual({ ok: true, text: "\n[Result truncated]", truncated: true });
    await large.close();
  });
  test("failure state contains only a safe kind", async () => {
    const c = createConnector({ id: "x", transport: { kind: "stdio", command: "/definitely/missing", args: [] }, toolAllowlist: [] });
    await c.listTools();
    expect(c.state()).toEqual({ status: "failed", kind: "unreachable" });
    expect(JSON.stringify(c.state())).not.toContain("definitely");
    await c.close();
  });
});
