import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { __resetPairingForTests, __setLinkKeyCommandForTests, confirmHostKey, derivePairingLookup, getLinkKeyPaths, getPairingPublicKey, issuePairingCode, knownHostsName, revokeLinkKey, scanHostKey } from "@/lib/stack/linkKeys";
import { configuredLink } from "@/lib/remoteStackSettings";
import { setHouseholdSettingValue } from "@/lib/settings";
import { authenticateSshArgs, engineLinkKeyFiles, hostKeyPinned, runEngineLinkDoctor, sshAuthenticated, type EngineLinkDoctorDependencies } from "../scripts/engine-link-doctor";

function deps(failHop?: number, tailnet: "off" | "disconnected" | "connected" = "connected"): EngineLinkDoctorDependencies {
  return {
    settings: () => ({ selected: failHop !== 1, host: "engine.home", sshPort: 22, localPort: 8771, allowTailnet: tailnet !== "off" }),
    resolve: async () => failHop === 2 ? [] : [tailnet === "off" ? "100.70.0.2" : tailnet === "disconnected" ? "100.70.0.2" : "192.168.1.20"],
    portOpen: async () => failHop !== 3,
    allowed: async (address) => !address.startsWith("100.") || tailnet === "connected",
    tailscale: async () => tailnet === "connected",
    keyFiles: () => ({ privateKey: true, knownHosts: true }),
    hostKey: async () => failHop !== 4,
    authenticate: async () => failHop !== 5,
    forward: async () => failHop !== 6,
    health: async () => ({ ok: failHop !== 7, version: "1" }),
    roles: async () => [{ id: "chat", state: { state: failHop === 8 ? "offline" : "ready" } }],
    gpu: async () => failHop !== 9,
    completion: async () => { if (failHop === 10) throw new Error("scripted"); return 123; },
  };
}

describe("engine-link doctor hop 5 (STACK-LINK-ASKPASS-01)", () => {
  test("the doctor's ssh arguments do not use BatchMode and do not allow a password", () => {
    const args = authenticateSshArgs("engine.home", 22, "192.168.1.20", "/data/key", "/data/known_hosts");
    expect(args.join(" ")).not.toContain("BatchMode");
    expect(args).toContain("-v");
    expect(args).toContain("NumberOfPasswordPrompts=1");
    expect(args).toContain("PasswordAuthentication=no");
    expect(args).toContain("KbdInteractiveAuthentication=no");
    expect(args).toContain("HostKeyAlias=engine.home");
  });
  test("the classifier passes on a -v transcript that authenticated, even though the no-login shell then exited 1", () => {
    const transcript = [
      "debug1: Server accepts key: /data/keys/stack-link/id_ed25519 ED25519 SHA256:abc explicit",
      "Authenticated to engine.home ([192.168.1.20]:22) using \"publickey\".",
      "debug1: channel 0: new session [client-session]",
      "This account is currently not available.",
    ].join("\n");
    expect(sshAuthenticated(transcript)).toBe(true);
    expect(sshAuthenticated("debug1: Authentication succeeded (publickey).")).toBe(true);
  });
  test("the classifier fails on Permission denied (publickey,password) and on an empty transcript", () => {
    expect(sshAuthenticated("debug1: Authentications that can continue: publickey,password\nmaipai-stack@192.168.1.20: Permission denied (publickey,password).")).toBe(false);
    expect(sshAuthenticated("ssh_askpass: exec(/data/keys/stack-link/askpass.sh): Permission denied\nPermission denied (publickey,password).")).toBe(false);
    expect(sshAuthenticated("")).toBe(false);
  });
});

describe("engine-link doctor hop 5 (STACK-LINK-ASKPASS-01)", () => {
  test("its ssh arguments have no BatchMode and ask for one key prompt, no password", () => {
    const args = authenticateSshArgs("engine.home", 22, "192.168.1.20", "/data/key", "/data/known_hosts");
    expect(args.join(" ")).not.toContain("BatchMode");
    expect(args).toContain("-v");
    for (const option of ["NumberOfPasswordPrompts=1", "PasswordAuthentication=no", "KbdInteractiveAuthentication=no"]) expect(args).toContain(option);
    expect(args.at(-2)).toBe("maipai-stack@192.168.1.20");
  });
  test("passes on a -v transcript that says Authenticated to, even though the no-login shell then exits 1", () => {
    const transcript = [
      "debug1: Authentications that can continue: publickey,password",
      "debug1: Offering public key: /data/id_ed25519 ED25519 SHA256:abc explicit",
      "debug1: Server accepts key: /data/id_ed25519 ED25519 SHA256:abc explicit",
      "Authenticated to 192.168.1.20 ([192.168.1.20]:22) using \"publickey\".",
      "This account is currently not available.",
    ].join("\n");
    expect(sshAuthenticated(transcript)).toBe(true);
    expect(sshAuthenticated("debug1: Authentication succeeded (publickey).")).toBe(true);
  });
  test("fails on Permission denied (publickey,password) and on an empty transcript", () => {
    expect(sshAuthenticated("debug1: No more authentication methods to try.\nmaipai-stack@192.168.1.20: Permission denied (publickey,password).")).toBe(false);
    expect(sshAuthenticated("ssh_askpass: exec(/data/askpass.sh): Permission denied\nPermission denied (publickey,password).")).toBe(false);
    expect(sshAuthenticated("")).toBe(false);
  });
  test("a failed sign-in says what went wrong and what to do", async () => {
    const hop = (await runEngineLinkDoctor(deps(5)))[4]!;
    expect(hop.pass).toBe(false);
    expect(hop.fix).toContain("did not accept");
    expect(hop.fix).toContain("Pair this Home");
  });
});

describe("engine-link doctor", () => {
  test("reports each scripted failure with that hop's fix", async () => {
    for (const failed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const hops = await runEngineLinkDoctor(deps(failed));
      expect(hops).toHaveLength(10);
      expect(hops[failed - 1]!.pass).toBe(false);
      expect(hops[failed - 1]!.fix.length).toBeGreaterThan(0);
    }
  });

  test("hop 2 names the home path when it resolves", async () => {
    const hops = await runEngineLinkDoctor(deps());
    expect(hops[1]).toMatchObject({ pass: true, detail: "path home" });
  });

  test("hop 2 gives the tailnet flag fix when off", async () => {
    const hops = await runEngineLinkDoctor(deps(undefined, "off"));
    expect(hops[1]).toMatchObject({ pass: false, detail: "Turn on Reach the engine computer when away from home, or use the home address.", fix: "Enable away access or use the home address." });
  });

  test("hop 2 reports disconnected Tailscale when the flag is on", async () => {
    const hops = await runEngineLinkDoctor(deps(undefined, "disconnected"));
    expect(hops[1]).toMatchObject({ pass: false, detail: "Tailscale is not connected on this computer.", fix: "Connect Tailscale on this computer." });
  });

  test("hop 2 fails when a tailnet address is allowed but Tailscale is disconnected", async () => {
    const connected = deps();
    const hops = await runEngineLinkDoctor({
      ...connected,
      resolve: async () => ["100.70.0.2"],
      allowed: async () => true,
      tailscale: async () => false,
    });
    expect(hops[1]).toMatchObject({ pass: false, detail: "Tailscale is not connected on this computer.", fix: "Connect Tailscale on this computer." });
  });
});

describe("doctor hop 4 known_hosts lookup (DOCTOR-HOSTKEY-01)", () => {
  const keygen = Bun.spawnSync(["ssh-keygen", "-F", "x", "-f", "/dev/null"]);
  const haveKeygen = keygen.exitCode !== null && !String(keygen.stderr).includes("not found") && keygen.exitCode !== 127;
  // A well-formed ed25519 public key blob built here (not a literal), so no secret-shaped string sits in the file.
  const key = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from("ssh-ed25519"), Buffer.from([0, 0, 0, 32]), Buffer.alloc(32, 7)]).toString("base64");
  const file = () => {
    const scratch = join(import.meta.dir, "..", "..", "data-scratch", "tmp"); mkdirSync(scratch, { recursive: true });
    const dir = mkdtempSync(join(scratch, "hostkey-"));
    const path = join(dir, "known_hosts");
    writeFileSync(path, `192.0.2.52 ssh-ed25519 ${key}\n[192.0.2.53]:2222 ssh-ed25519 ${key}\n`);
    return { dir, path };
  };
  const t = haveKeygen ? test : test.skip;
  if (!haveKeygen) console.warn("ssh-keygen not found on PATH: skipping the real known_hosts lookup test");

  t("finds a port-22 key filed as the bare host and a [host]:2222 key, and misses an unpinned host", async () => {
    const { dir, path } = file();
    try {
      expect(await hostKeyPinned("192.0.2.52", 22, path)).toBe(true);
      expect(await hostKeyPinned("192.0.2.53", 2222, path)).toBe(true);
      expect(await hostKeyPinned("192.0.2.99", 22, path)).toBe(false);
      expect(await hostKeyPinned("192.0.2.99", 2222, path)).toBe(false);
      expect(await hostKeyPinned("192.0.2.52", 2222, path)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("knownHostsName files a host the way ssh does", () => {
    expect(knownHostsName("192.0.2.52", 22)).toBe("192.0.2.52");
    expect(knownHostsName("192.0.2.52", 2222)).toBe("[192.0.2.52]:2222");
    expect(knownHostsName("[::1]", 22)).toBe("::1");
    expect(knownHostsName("[::1]", 2222)).toBe("[::1]:2222");
  });

  test("a failed hop 4 names what was looked up and the port, and hands the real host name to the checks", async () => {
    const seen: unknown[][] = [];
    const base = deps();
    const hops = await runEngineLinkDoctor({ ...base, hostKey: async (...args) => { seen.push(args); return false; } });
    expect(seen).toEqual([["engine.home", 22]]);
    expect(hops[3]).toMatchObject({ pass: false, detail: "looked up engine.home on SSH port 22 and found no pinned key" });
    const auth: unknown[][] = [];
    await runEngineLinkDoctor({ ...base, authenticate: async (...args) => { auth.push(args); return true; } });
    expect(auth).toEqual([["engine.home", 22, "192.168.1.20"]]);
  });
});

describe("key files are looked for where the pairing writes them (STACK-LINK-KEYPATH-01)", () => {
  afterEach(() => { revokeLinkKey(); __resetPairingForTests(); __setLinkKeyCommandForTests(null); });
  const BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIPoISQD6sKkxbk5FD8YL6LuvYzhXACmFp4cr8oleBk1h";

  test("after a real pairing the doctor sees both files and the tunnel config points at them", async () => {
    expect(engineLinkKeyFiles()).toEqual({ privateKey: false, knownHosts: false });
    const issued = issuePairingCode();
    getPairingPublicKey(derivePairingLookup(issued.code), "household-1");
    __setLinkKeyCommandForTests(async () => ({ code: 0, stdout: `engine.local ssh-ed25519 ${BLOB} test\n` }));
    confirmHostKey((await scanHostKey("engine.local", 22)).check_code);

    const { privateKeyPath, knownHostsPath } = getLinkKeyPaths();
    expect(privateKeyPath).toBe(join(dataDir, "keys", "stack-link", "id_ed25519"));
    expect(knownHostsPath).toBe(join(dataDir, "keys", "stack-link", "known_hosts"));
    expect(existsSync(privateKeyPath)).toBe(true);
    expect(existsSync(knownHostsPath)).toBe(true);

    expect(engineLinkKeyFiles()).toEqual({ privateKey: true, knownHosts: true });
    setHouseholdSettingValue("engines.stack.remote.host", "engine.local");
    const config = configuredLink();
    expect(config?.privateKeyPath).toBe(privateKeyPath);
    expect(config?.knownHostsPath).toBe(knownHostsPath);
    expect(existsSync(config!.privateKeyPath)).toBe(true);
    expect(existsSync(config!.knownHostsPath)).toBe(true);
  });
});
