import { describe, expect, test } from "bun:test";
import { buildEngineLinkSshArgs } from "@/lib/stack/link";

describe("engine link SSH forwards", () => {
  test("keeps the voice reverse forward loopback-only on the engine computer", () => {
    const priorPort = process.env.PORT;
    process.env.PORT = "8899";
    try {
      const args = buildEngineLinkSshArgs({
        host: "engine.example.com",
        sshPort: 22,
        localPort: 8771,
        privateKeyPath: "/data/key",
        knownHostsPath: "/data/known_hosts",
      }, "192.0.2.10");
      expect(args).toContain("127.0.0.1:8771:127.0.0.1:8770");
      expect(args).toContain("127.0.0.1:8772:127.0.0.1:8899");
    } finally {
      if (priorPort === undefined) delete process.env.PORT;
      else process.env.PORT = priorPort;
    }
  });
});
