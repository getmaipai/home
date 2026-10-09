import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { __resetPairingForTests, __setLinkKeyCommandForTests, confirmHostKey, derivePairingLookup, getLinkKeyPaths, getPairingPublicKey, issuePairingCode, knownHostsName, revokeLinkKey, scanHostKey } from "@/lib/stack/linkKeys";
import { configuredLink } from "@/lib/remoteStackSettings";
import { setHouseholdSettingValue } from "@/lib/settings";
import { authenticateSshArgs, checkGpu, checkStackHealth, engineLinkKeyFiles, hasGpu, hostKeyPinned, runEngineLinkDoctor, sshAuthenticated, type EngineLinkDoctorDependencies } from "../scripts/engine-link-doctor";

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
    health: async () => ({ ok: failHop !== 7, version: "0.1.0", contract: 1 }),
    roles: async () => [{ id: "chat", state: { state: failHop === 8 ? "offline" : "ready" } }],
    gpu: async () => failHop !== 9,
    completion: async () => { if (failHop === 10) throw new Error("scripted"); return 123; },
  };
}

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

// DOCTOR-HOPS-01: the exact replies of the live box Stack (2026-10-09), as fixtures.
const REAL_HEALTHZ = '{"ok":true,"version":"0.1.0","contract":1,"uptimeSeconds":4242}';
const REAL_HARDWARE = '{"hardware":{"cudaDevices":[{"index":0,"name":"NVIDIA GeForce RTX 4090"},{"index":1,"name":"NVIDIA GeForce RTX 4090"}],"isAppleSilicon":false},"memory":{"totalBytes":68719476736}}';

/** A stand-in for the Stack behind the tunnel: answers the given text per path, on a free loopback port. */
function fakeStack(replies: Record<string, { status?: number; body: string }>): { port: number; stop: () => void } {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => {
    const reply = replies[new URL(request.url).pathname];
    return reply ? new Response(reply.body, { status: reply.status ?? 200, headers: { "content-type": "application/json" } }) : new Response("not found", { status: 404 });
  } });
  return { port: server.port!, stop: () => void server.stop(true) };
}

describe("doctor hop 7, the Stack health reply (DOCTOR-HOPS-01)", () => {
  test("the real healthz reply (version \"0.1.0\", contract 1) passes; it used to fail because Number(\"0.1.0\") is NaN", async () => {
    const stack = fakeStack({ "/healthz": { body: REAL_HEALTHZ } });
    try { expect(await checkStackHealth(stack.port)).toEqual({ ok: true, version: "0.1.0", contract: 1 }); } finally { stack.stop(); }
  });
  test("a contract outside the range this Home speaks fails, and says which contract it saw", async () => {
    const stack = fakeStack({ "/healthz": { body: '{"ok":true,"version":"0.2.0","contract":2,"uptimeSeconds":1}' } });
    try { expect(await checkStackHealth(stack.port)).toMatchObject({ ok: false, version: "0.2.0", contract: 2 }); } finally { stack.stop(); }
  });
  test("ok:false and a reply with no contract number fail", async () => {
    for (const body of ['{"ok":false,"version":"0.1.0","contract":1}', '{"ok":true,"version":"0.1.0"}']) {
      const stack = fakeStack({ "/healthz": { body } });
      try { expect((await checkStackHealth(stack.port)).ok).toBe(false); } finally { stack.stop(); }
    }
  });
  test("something that is not a Stack health reply (a 404, or a page) is a failed request, not a version problem", async () => {
    const missing = fakeStack({});
    try { await expect(checkStackHealth(missing.port)).rejects.toBeDefined(); } finally { missing.stop(); }
    const page = fakeStack({ "/healthz": { body: "<html>hello</html>" } });
    try { await expect(checkStackHealth(page.port)).rejects.toBeDefined(); } finally { page.stop(); }
  });
  test("the failure text depends on the failure: a failed request says the tunnel did not return a Stack health reply; only a contract mismatch says update", async () => {
    const failedRequest = await runEngineLinkDoctor({ ...deps(), health: async () => { throw new Error("health probe failed"); } });
    expect(failedRequest[6]).toMatchObject({ id: 7, pass: false });
    expect(failedRequest[6]!.fix).toContain("not a Stack health reply");
    expect(failedRequest[6]!.fix).not.toContain("Update the Stack");
    const mismatch = await runEngineLinkDoctor({ ...deps(), health: async () => ({ ok: false, version: "0.2.0", contract: 2 }) });
    expect(mismatch[6]!.pass).toBe(false);
    expect(mismatch[6]!.fix).toContain("Update the Stack on the engine computer");
    expect(mismatch[6]!.fix).toContain("contract 2");
    const unhealthy = await runEngineLinkDoctor({ ...deps(), health: async () => ({ ok: false, version: "0.1.0", contract: 1 }) });
    expect(unhealthy[6]!.fix).toContain("not healthy");
    expect(unhealthy[6]!.fix).not.toContain("Update the Stack");
    const good = await runEngineLinkDoctor(deps());
    expect(good[6]).toMatchObject({ id: 7, pass: true, fix: "No action needed." });
  });
});

describe("doctor hop 9, the engine computer's GPU (DOCTOR-HOPS-01)", () => {
  test("the real hardware reply (hardware.cudaDevices, two devices) is a GPU; it used to read body.gpus and fail", async () => {
    expect(hasGpu(JSON.parse(REAL_HARDWARE))).toBe(true);
    const stack = fakeStack({ "/stack/v1/hardware": { body: REAL_HARDWARE } });
    try { expect(await checkGpu(stack.port)).toBe(true); } finally { stack.stop(); }
  });
  test("no CUDA devices and not Apple silicon is no GPU", async () => {
    expect(hasGpu({ hardware: { cudaDevices: [], isAppleSilicon: false } })).toBe(false);
    expect(hasGpu({ hardware: {} })).toBe(false);
    expect(hasGpu({})).toBe(false);
    expect(hasGpu(null)).toBe(false);
    const stack = fakeStack({ "/stack/v1/hardware": { body: '{"hardware":{"cudaDevices":[],"isAppleSilicon":false}}' } });
    try { expect(await checkGpu(stack.port)).toBe(false); } finally { stack.stop(); }
    const gone = fakeStack({});
    try { expect(await checkGpu(gone.port)).toBe(false); } finally { gone.stop(); }
  });
  test("Apple silicon is the engine there, so it passes", () => {
    expect(hasGpu({ hardware: { cudaDevices: [], isAppleSilicon: true } })).toBe(true);
  });
  test("the old fields stay as fallbacks", () => {
    expect(hasGpu({ gpus: [{ name: "x" }] })).toBe(true);
    expect(hasGpu({ graphics: [{ name: "x" }] })).toBe(true);
    expect(hasGpu({ gpus: [] })).toBe(false);
  });
});

