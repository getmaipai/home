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

  test("STACK-LINK-ASKPASS-01: the tunnel arguments never use BatchMode (it disables the askpass passphrase) and never fall back to a password", () => {
    const args = buildEngineLinkSshArgs({ host: "engine.example.com", sshPort: 22, localPort: 8771, privateKeyPath: "/data/key", knownHostsPath: "/data/known_hosts" }, "192.0.2.10");
    expect(args.join(" ")).not.toContain("BatchMode");
    expect(args).toContain("NumberOfPasswordPrompts=1");
    expect(args).toContain("PasswordAuthentication=no");
    expect(args).toContain("KbdInteractiveAuthentication=no");
    expect(args).toContain("IdentitiesOnly=yes");
  });

  // STACK-LINK-ASKPASS-01: BatchMode=yes disabled the askpass prompt, so the passphrase-protected key was never unlocked.
  test("the tunnel lets askpass unlock the key: no BatchMode, one prompt, no password fallback", () => {
    const args = buildEngineLinkSshArgs({ host: "engine.example.com", sshPort: 22, localPort: 8771, privateKeyPath: "/data/key", knownHostsPath: "/data/known_hosts" }, "192.0.2.10");
    expect(args.join(" ")).not.toContain("BatchMode");
    for (const option of ["NumberOfPasswordPrompts=1", "PasswordAuthentication=no", "KbdInteractiveAuthentication=no"]) expect(args).toContain(option);
  });
});
