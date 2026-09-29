import { describe, expect, test, afterEach } from "bun:test";
import { Bonjour } from "bonjour-service";
import { resetDb } from "./reset-db";
import { __resetHubIdentityForTests, getHubInstanceId, setHubName } from "@/lib/hubIdentity";
import { listIssues } from "@/lib/issues";
import { advertiseMdns, stopMdnsAdvertisement, isMdnsAdvertising } from "@/lib/mdns";

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
