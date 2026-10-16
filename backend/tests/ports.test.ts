import { describe, expect, test } from "bun:test";
import { DEFAULT_HOME_PORT, DEFAULT_STACK_PORT, defaultStackBaseUrl, homePort, stackPort } from "@/lib/ports";
import { createStackClient } from "@/lib/stack/client";

describe("the installed app's ports", () => {
  test("defaults are 3000 for Home and 8770 for the Stack", () => {
    expect(homePort({})).toBe(DEFAULT_HOME_PORT);
    expect(stackPort({})).toBe(DEFAULT_STACK_PORT);
    expect(DEFAULT_HOME_PORT).toBe(3000);
    expect(DEFAULT_STACK_PORT).toBe(8770);
  });

  test("PORT and MAIPAI_STACK_PORT move them; a bad value falls back to the default", () => {
    expect(homePort({ PORT: "3100" })).toBe(3100);
    expect(stackPort({ MAIPAI_STACK_PORT: "8801" })).toBe(8801);
    expect(stackPort({ MAIPAI_STACK_PORT: "abc" })).toBe(8770);
    expect(stackPort({ MAIPAI_STACK_PORT: "70000" })).toBe(8770);
    expect(homePort({ PORT: "" })).toBe(3000);
    expect(defaultStackBaseUrl({ MAIPAI_STACK_PORT: "8801" })).toBe("http://127.0.0.1:8801");
  });

  test("the Stack client with no base URL talks to the moved port", async () => {
    const before = process.env.MAIPAI_STACK_PORT;
    process.env.MAIPAI_STACK_PORT = "8801";
    try {
      const seen: string[] = [];
      const client = createStackClient({ fetch: (async (url: string) => { seen.push(String(url)); return Response.json({ ok: true }); }) as unknown as typeof fetch });
      await client.healthz().catch(() => {});
      expect(seen[0]).toContain("127.0.0.1:8801");
    } finally {
      if (before === undefined) delete process.env.MAIPAI_STACK_PORT; else process.env.MAIPAI_STACK_PORT = before;
    }
  });
});
