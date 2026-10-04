import { describe, expect, test, afterEach, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { Bonjour } from "bonjour-service";
import { resetDb } from "./reset-db";
import { __resetHubIdentityForTests, getHubInstanceId, setHubName } from "@/lib/hubIdentity";
import { listIssues, raiseIssue } from "@/lib/issues";
import { advertiseMdns, stopMdnsAdvertisement, isMdnsAdvertising, mdnsHostLabel } from "@/lib/mdns";

// bun test runs with NODE_ENV=test, where advertising is off by default
// (MDNS-HOST-01); these tests exercise the real responder, so force it on.
process.env.MAIPAI_MDNS = "on";

afterEach(async () => {
  await stopMdnsAdvertisement();
  resetDb();
  __resetHubIdentityForTests();
});

describe("advertiseMdns()/stopMdnsAdvertisement()", () => {
  test("isMdnsAdvertising() reflects a real start/stop cycle", async () => {
    expect(isMdnsAdvertising()).toBe(false);
    await advertiseMdns({ port: 48790, tls: false });
    expect(isMdnsAdvertising()).toBe(true);
    await stopMdnsAdvertisement();
    expect(isMdnsAdvertising()).toBe(false);
  });

  test("calling it twice restarts cleanly rather than erroring or leaking a second advertisement", async () => {
    await advertiseMdns({ port: 48791, tls: false });
    await advertiseMdns({ port: 48791, tls: true });
    expect(isMdnsAdvertising()).toBe(true);
  });

  // The real end-to-end proof: a separate mDNS browser (bonjour-service's
  // own `.find()`, the same API a real client would use) actually
  // discovers this hub on the network and reads back the TXT fields
  // this file's own header documents - not just "the library was called
  // with the right-looking arguments."
  test("a real mDNS browser discovers the advertised service with the documented TXT fields", async () => {
    setHubName("Marlow Hub");
    await advertiseMdns({ port: 48792, tls: true });

    const browser = new Bonjour();
    try {
      const found = await new Promise<{ txt?: Record<string, string>; port: number }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("mDNS discovery timed out")), 8_000);
        browser.find({ type: "maipai" }, (svc) => {
          if (svc.port !== 48792) return; // ignore anything else answering this type on this machine
          clearTimeout(timeout);
          resolve(svc as { txt?: Record<string, string>; port: number });
        });
      });
      expect(found.txt?.name).toBe("Marlow Hub");
      // The instance name is unique to this hub (display name plus the
      // first four characters of its id); clients read TXT `name`.
      expect((found as { name?: string }).name).toBe(`Marlow Hub-${getHubInstanceId().slice(0, 4)}`);
      expect(found.txt?.id).toBe(getHubInstanceId());
      expect(found.txt?.tls).toBe("1");
      expect(found.txt?.v).toBe("1");
      expect(typeof found.txt?.id).toBe("string");
      expect(found.txt?.id?.length).toBeGreaterThan(0);
    } finally {
      browser.destroy();
    }
  }, 15_000);

  // Two hubs (or a stale announcement) holding the same instance name
  // used to leave this hub silent: the library only console.log()s the
  // clash. A rival publishes the exact name this hub wants; the hub must
  // still end up discoverable, under a different instance name, with its
  // display name intact in TXT (#193).
  async function publishRival(rival: Bonjour, name: string, port: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const svc = rival.publish({ name, type: "maipai", port, txt: { id: "rival", name: "Rival Hub", tls: "0", v: "1" } });
      svc.on("up", () => resolve());
    });
  }

  async function discoverInstances(port: number): Promise<Array<{ name: string; txt?: Record<string, string> }>> {
    const browser = new Bonjour();
    try {
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("mDNS discovery timed out")), 8_000);
        browser.find({ type: "maipai" }, (svc) => {
          if (svc.port !== port) return;
          clearTimeout(timeout);
          resolve([svc as { name: string; txt?: Record<string, string> }]);
        });
      });
    } finally {
      browser.destroy();
    }
  }

  test("a hub whose instance name is already taken on the network still advertises, under a numbered name", async () => {
    setHubName("Marlow Hub");
    const base = `Marlow Hub-${getHubInstanceId().slice(0, 4)}`;
    const rival = new Bonjour();
    try {
      await publishRival(rival, base, 48793);
      await advertiseMdns({ port: 48794, tls: false });
      expect(isMdnsAdvertising()).toBe(true);
      const [found] = await discoverInstances(48794);
      expect(found!.name).toBe(`${base} (2)`);
      expect(found!.txt?.name).toBe("Marlow Hub");
      expect(listIssues().filter((i) => i.source === "mdns" && !i.resolved_at)).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => rival.unpublishAll(() => resolve()));
      rival.destroy();
    }
  }, 20_000);

  test("when every name it can try is taken, the hub raises a Repairs issue and boot is not failed", async () => {
    setHubName("Marlow Hub");
    const base = `Marlow Hub-${getHubInstanceId().slice(0, 4)}`;
    const rival = new Bonjour();
    try {
      await publishRival(rival, base, 48795);
      await publishRival(rival, `${base} (2)`, 48796);
      await advertiseMdns({ port: 48797, tls: false });
      expect(isMdnsAdvertising()).toBe(false);
      const open = listIssues().filter((i) => i.source === "mdns" && !i.resolved_at);
      expect(open).toHaveLength(1);
      expect(open[0]!.title).toContain("find this hub");
    } finally {
      await new Promise<void>((resolve) => rival.unpublishAll(() => resolve()));
      rival.destroy();
    }
  }, 30_000);
});

// MDNS-HOST-01: publish() without a `host` made bonjour-service announce A/AAAA
// records for os.hostname(), which macOS's mDNSResponder read as a clash on its
// own name and answered by renaming the computer ("... (2)", "-2").
describe("advertised host label (MDNS-HOST-01)", () => {
  test("mdnsHostLabel() is maipai-<first 8 of the instance id>.local, lowercase", () => {
    const label = mdnsHostLabel();
    expect(label).toBe(`maipai-${getHubInstanceId().slice(0, 8).toLowerCase()}.local`);
    expect(label).toMatch(/^[a-z0-9-]+\.local$/);
  });

  test("the published service carries the maipai host, never os.hostname(), and its address records are for that label only", async () => {
    const spy = spyOn(Bonjour.prototype, "publish");
    try {
      await advertiseMdns({ port: 48800, tls: false });
      expect(spy).toHaveBeenCalledTimes(1);
      const cfg = spy.mock.calls[0]![0] as { host?: string };
      expect(cfg.host).toBe(mdnsHostLabel());
      expect(cfg.host).not.toBe(hostname());
      const svc = spy.mock.results[0]!.value as { host: string; records(): Array<{ type: string; name: string }> };
      expect(svc.host).toBe(mdnsHostLabel());
      const names = svc.records().filter((r) => r.type === "A" || r.type === "AAAA" || r.type === "SRV").map((r) => r.name);
      for (const r of svc.records()) {
        if (r.type === "A" || r.type === "AAAA") expect(r.name).toBe(mdnsHostLabel());
      }
      expect(names.some((n) => n.toLowerCase() === hostname().toLowerCase() || n.toLowerCase() === `${hostname().toLowerCase()}.local`)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  test("it logs one line with the host label used", async () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await advertiseMdns({ port: 48801, tls: false });
      const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[mdns]") && l.includes(mdnsHostLabel()));
      expect(lines).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("MAIPAI_MDNS=off publishes nothing", async () => {
    const spy = spyOn(Bonjour.prototype, "publish");
    process.env.MAIPAI_MDNS = "off";
    try {
      await advertiseMdns({ port: 48802, tls: false });
      expect(spy).not.toHaveBeenCalled();
      expect(isMdnsAdvertising()).toBe(false);
    } finally {
      process.env.MAIPAI_MDNS = "on";
      spy.mockRestore();
    }
  });

  test("turning mDNS off resolves an advertise_failed Repairs issue left by an earlier boot", async () => {
    await raiseIssue({ source: "mdns", key: "advertise_failed", severity: "warning", title: "t", detail: "d" });
    expect(listIssues().filter((i) => i.source === "mdns" && !i.resolved_at)).toHaveLength(1);
    process.env.MAIPAI_MDNS = "off";
    try {
      await advertiseMdns({ port: 48805, tls: false });
      expect(listIssues().filter((i) => i.source === "mdns" && !i.resolved_at)).toHaveLength(0);
    } finally {
      process.env.MAIPAI_MDNS = "on";
    }
  });

  test("with MAIPAI_MDNS unset, NODE_ENV=test and a scratch Home (the one-hub opt-out) both mean off", async () => {
    const spy = spyOn(Bonjour.prototype, "publish");
    const keys = ["MAIPAI_MDNS", "NODE_ENV", "MAIPAI_TEST_ALLOW_MULTIPLE_HUBS"] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      delete process.env.MAIPAI_MDNS;
      process.env.NODE_ENV = "test";
      await advertiseMdns({ port: 48803, tls: false });
      process.env.NODE_ENV = "production";
      process.env.MAIPAI_TEST_ALLOW_MULTIPLE_HUBS = "1";
      await advertiseMdns({ port: 48804, tls: false });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      spy.mockRestore();
    }
  });
});

describe("scratch Home launchers turn mDNS off (MDNS-HOST-01)", () => {
  for (const file of ["scripts/smoke/chat.ts", "../scripts/screenshot.ts", "scripts/restore-drill.ts"]) {
    test(`${file} sets MAIPAI_MDNS=off in the spawn env`, () => {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(src).toMatch(/MAIPAI_MDNS:\s*"off"/);
    });
  }
});
